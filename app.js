(function () {
  var LS = 'media-faculdade-v1';
  var EPS = 1e-9;

  function uid() { return Math.random().toString(36).slice(2, 9); }
  function emptyM() { return { direct: '', acts: [] }; }
  var migrated = false;
  function defaults() {
    return { v: 4, target: '18', theme: 'auto', seenTutorial: false, targetSetupSeen: false, subjects: [] };
  }
  function normalize(d) {
    var old = !d.v || d.v < 2;
    var out = { v: 4, target: typeof d.target === 'string' ? d.target : '18', theme: ['auto','light','dark'].indexOf(d.theme) >= 0 ? d.theme : 'auto', seenTutorial: !!d.seenTutorial, targetSetupSeen: !!d.targetSetupSeen, subjects: [] };
    (d.subjects || []).forEach(function (s) {
      if (old && (s.name === 'Bioquímica' || s.name === 'Histologia e Embriologia')) { migrated = true; return; }
      var ms = [0, 1, 2].map(function (i) {
        var m = (s.ms && s.ms[i]) || {};
        return {
          direct: typeof m.direct === 'string' ? m.direct : '',
          acts: (m.acts || []).map(function (a) {
            return { id: a.id || uid(), name: a.name || '', grade: a.grade == null ? '' : String(a.grade), weight: a.weight == null ? '' : String(a.weight) };
          })
        };
      });
      out.subjects.push({ id: s.id || uid(), name: s.name || '', ms: ms });
    });
    return out;
  }

  var state;
  try {
    var raw = localStorage.getItem(LS);
    state = raw ? normalize(JSON.parse(raw)) : defaults();
  } catch (e) { state = defaults(); }

  function num(v) {
    if (v === '' || v == null) return null;
    var s = String(v).trim();
    if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(s)) return null;
    var n = Number(s.replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  function fmt(n) { return n.toFixed(2).replace('.', ','); }
  function fmtW(n) { return (Math.round(n * 100) / 100).toString().replace('.', ','); }
  function up2(x) { return Math.ceil(x * 100 - 1e-6) / 100; }
  function clamp(p) { return Math.max(0, Math.min(100, p)); }

  function calcM(m) {
    var d = num(m.direct);
    if (d !== null) return { state: 'closed', points: d, remaining: 0, totalW: 0, direct: true };
    var pts = 0, filled = 0, total = 0, invalidWeight = false;
    m.acts.forEach(function (a) {
      var w = num(a.weight), g = num(a.grade);
      if (a.weight !== '' && a.weight != null && (w === null || w < 0 || w > 10)) invalidWeight = true;
      w = w || 0;
      total += w;
      if (g !== null) { pts += g * w / 10; filled += w; }
    });
    var rem = Math.max(0, 10 - filled);
    return { state: rem <= EPS ? 'closed' : (filled > 0 ? 'partial' : 'empty'), points: pts, remaining: rem, totalW: total, invalidWeight: invalidWeight, direct: false };
  }

  function targetNum() { var t = num(state.target); return t === null ? 18 : t; }

  function calcSubject(s) {
    var target = targetNum();
    var ms = s.ms.map(calcM);
    var pts = ms.reduce(function (a, m) { return a + m.points; }, 0);
    var remW = ms.reduce(function (a, m) { return a + m.remaining; }, 0);
    var max = pts + remW;
    var open = [];
    ms.forEach(function (m, i) { if (m.remaining > EPS) open.push(i); });
    var status, verdict, avgNeeded = null;
    var invalidWeights = ms.some(function (m) { return m.invalidWeight || m.totalW > 10 + EPS; });
    if (invalidWeights) {
      status = 'open';
      verdict = 'A soma dos pesos de uma ou mais M passou de 10. Corrija os pesos para calcular corretamente.';
    } else if (pts >= target - EPS) {
      status = 'approved';
      verdict = 'Já passou. Soma ' + fmt(pts) + ', o mínimo é ' + fmt(target) + '.';
    } else if (remW <= EPS) {
      status = 'failed';
      verdict = 'Você já está reprovado(a). Sua soma final foi ' + fmt(pts) + ', abaixo do mínimo de ' + fmt(target) + '.';
    } else if (max < target - EPS) {
      status = 'failed';
      verdict = 'Você já está reprovado(a). Mesmo com 10 em tudo, sua soma final será ' + fmt(max) + ', abaixo do mínimo de ' + fmt(target) + '.';
    } else {
      status = 'open';
      avgNeeded = up2((target - pts) * 10 / remW);
      var a = fmt(avgNeeded);
      if (open.length === 1) {
        var i = open[0];
        verdict = ms[i].state === 'empty'
          ? 'Precisa de ' + a + ' na M' + (i + 1) + '.'
          : 'Precisa de média ' + a + ' no que falta da M' + (i + 1) + ' (peso ' + fmtW(ms[i].remaining) + ').';
      } else {
        verdict = 'Precisa de ' + a + ' em cada M que falta, individualmente (' + open.map(function (i) { return 'M' + (i + 1); }).join(' e ') + ').';
      }
    }
    return { ms: ms, pts: pts, max: max, status: status, verdict: verdict, target: target, avgNeeded: avgNeeded, invalidWeights: invalidWeights };
  }

  function h(tag, props) {
    var e = document.createElement(tag);
    props = props || {};
    for (var k in props) {
      var v = props[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'value') e.value = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(c));
    }
    return e;
  }

  var root = document.getElementById('app');
  var expanded = {};
  var pendingFocus = null;
  var dirty = false, dbDoc = null, writing = false, again = false, timer = null;

  function setStatus(t) { document.getElementById('savestate').textContent = t; }

  function persist() {
    var snap;
    try { snap = JSON.parse(JSON.stringify(state)); } catch (e) { return; }
    try { localStorage.setItem(LS, JSON.stringify(snap)); } catch (e) {}
    if (!dbDoc) { setStatus('Salvo neste navegador'); return; }
    if (writing) { again = true; return; }
    writing = true;
    dbDoc.set(snap).then(function () { setStatus('Salvo na sua conta'); },
      function () { setStatus('Salvo só neste navegador'); })
      .then(function () { writing = false; if (again) { again = false; persist(); } });
  }
  function saveSoon() {
    dirty = true;
    setStatus('Salvando…');
    clearTimeout(timer);
    timer = setTimeout(persist, 600);
  }

  function animateInvalid(el) {
    if (!el) return;
    el.classList.remove('invalid-pulse');
    void el.offsetWidth;
    el.classList.add('invalid-pulse');
  }
  function validate(input, kind) {
    var t = input.value.trim();
    var n = num(t);
    var bad = t !== '' && (n === null || n < 0 || n > 10);
    input.classList.toggle('bad', bad);
    input.setAttribute('aria-invalid', bad ? 'true' : 'false');
    if (bad) animateInvalid(input);
  }
  function focusInvalidM(subjectEl, subject) {
    var invalidIndex = subject.ms.findIndex(function (m) {
      var cm = calcM(m);
      return cm.invalidWeight || cm.totalW > 10 + EPS;
    });
    if (invalidIndex < 0) return;
    var target = subjectEl.querySelector('[data-m="' + invalidIndex + '"]');
    if (!target) return;
    var body = target.closest('.subj-body');
    var head = subjectEl.querySelector('.subj-head');
    if (body && body.hidden && head) head.click();
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    animateInvalid(target);
    target.querySelectorAll('input[aria-invalid="true"]').forEach(animateInvalid);
  }

  function applySubject(el, s) {
    var r = calcSubject(s);
    el.dataset.status = r.status;
    el.querySelector('.sname').textContent = s.name || 'Matéria sem nome';
    var subjectFailed = el.querySelector('.subject-failed');
    subjectFailed.hidden = r.status !== 'failed';
    subjectFailed.textContent = r.status === 'failed' ? r.verdict : '';
    el.querySelector('.pill').textContent = r.status === 'approved' ? 'Aprovada' : r.status === 'failed' ? 'Reprovada' : 'Em andamento';
    el.querySelector('.sum').firstChild.nodeValue = fmt(r.pts) + ' ';
    el.querySelector('.sum small').textContent = '/ ' + fmt(r.target);
    el.querySelector('.verdict').textContent = r.verdict;
    el.querySelector('.fill').style.width = clamp(r.pts / 30 * 100) + '%';
    el.querySelector('.fillmax').style.width = clamp(r.max / 30 * 100) + '%';
    var tl = clamp(r.target / 30 * 100) + '%';
    el.querySelector('.tick').style.left = tl;
    el.querySelector('.ticklabel').style.left = tl;
    el.querySelector('.ticklabel').textContent = fmt(r.target);
    el.querySelector('.meter').setAttribute('aria-label',
      'Soma atual ' + fmt(r.pts) + ', máximo possível ' + fmt(r.max) + ', mínimo para passar ' + fmt(r.target));
    r.ms.forEach(function (m, i) {
      var b = el.querySelector('[data-m="' + i + '"]');
      b.classList.toggle('invalid-m', m.invalidWeight || m.totalW > 10 + EPS);
      b.classList.toggle('incomplete-m', !m.direct && !m.invalidWeight && m.totalW < 10 - EPS);
      b.style.setProperty('--weight-progress', Math.max(0, Math.min(100, m.totalW / 10 * 100)) + '%');
      /* Qualquer matéria em estado "reprovada" já não tem pontos suficientes
         para alcançar o mínimo: mostra o aviso dentro de cada M. */
      var impossibleHere = r.status === 'failed';
      var mw = b.querySelector('.m-impossible');
      if (mw) {
        mw.hidden = false;
        mw.style.display = impossibleHere ? 'block' : 'none';
        mw.setAttribute('aria-hidden', impossibleHere ? 'false' : 'true');
        mw.textContent = impossibleHere
          ? 'Você já está reprovado(a). Mesmo com 10 em tudo, sua soma final será ' + fmt(r.max) + '.'
          : '';
      }
      b.querySelector('.mval').textContent = m.state === 'empty' ? '—' : fmt(m.points);
      b.querySelector('.mtag').textContent = m.direct ? 'nota da M lançada'
        : m.state === 'closed' ? 'fechada'
        : m.state === 'partial' ? 'parcial, faltam ' + fmtW(m.remaining) + ' de peso'
        : 'sem notas ainda';
      b.querySelector('.acts').classList.toggle('off', m.direct);
      var hinted = false;
      b.querySelectorAll('.arow[data-aid]').forEach(function (row) {
        var act = s.ms[i].acts.filter(function (x) { return x.id === row.getAttribute('data-aid'); })[0];
        var inp = row.children[1];
        var pe = row.querySelector('.pts');
        var w = act ? num(act.weight) : null;
        var g = act ? num(act.grade) : null;
        var need = null;
        if (act && !m.direct && w !== null && w > 0 && !r.invalidWeights) {
          if (r.status === 'approved') need = 0;
          else if (r.status === 'open') {
            /* Mesma nota em todas as atividades ainda sem nota. */
            need = r.avgNeeded;
          }
        }
        var show = !!act && !m.direct && need !== null && g === null && w > 0;
        inp.placeholder = show ? fmt(need) : 'Nota';
        inp.classList.toggle('hint', show);
        var txt = '';
        if (act && !m.direct && w !== null && w > 0) {
          if (g !== null) txt = 'Rendeu ' + fmt(g * w / 10) + ' de ' + fmt(w) + ' pts';
          else if (need !== null) txt = 'Precisa render ' + fmt(need * w / 10) + ' de ' + fmt(w) + ' pts';
          else txt = 'Vale ' + fmtW(w) + ' pts';
        }
        pe.textContent = txt;
        var weightInput = row.children[2];
        var totalWeightInvalid = m.invalidWeight || m.totalW > 10 + EPS;
        weightInput.classList.toggle('bad', totalWeightInvalid || (w !== null && (w < 0 || w > 10)));
        weightInput.setAttribute('aria-invalid', totalWeightInvalid || (w !== null && (w < 0 || w > 10)) ? 'true' : 'false');
        if (show) hinted = true;
      });
      var di = b.querySelector('.direct input');
      var needM = (!m.direct && m.remaining > EPS && r.status === 'open') ? m.points + r.avgNeeded * m.remaining / 10 : null;
      di.placeholder = needM !== null ? fmt(needM) : '—';
      di.classList.toggle('hint', needM !== null);
      b.querySelector('.hintline').hidden = !hinted;
      var ws = b.querySelector('.wsum');
      if (m.direct) { ws.textContent = 'Atividades ignoradas'; ws.classList.remove('warn','open-weight','complete-weight'); }
      else {
        ws.textContent = 'Peso lançado ' + fmtW(m.totalW) + ' de 10';
        ws.classList.toggle('warn', m.totalW > 10 + EPS || m.invalidWeight);
        ws.classList.toggle('open-weight', !m.invalidWeight && m.totalW < 10 - EPS);
        ws.classList.toggle('complete-weight', !m.invalidWeight && Math.abs(m.totalW - 10) <= EPS);
        if (m.totalW > 10 + EPS || m.invalidWeight) ws.textContent += ' · corrija os pesos';
      }
    });
  }

  function updateSummary() {
    var c = { approved: 0, open: 0, failed: 0 };
    state.subjects.forEach(function (s) { c[calcSubject(s).status]++; });
    var n = state.subjects.length;
    document.getElementById('summary').textContent = n === 0 ? '' :
      n + (n === 1 ? ' matéria' : ' matérias') + ' · ' + c.open + ' em andamento · ' + c.approved + ' aprovadas · ' + c.failed + ' reprovadas';
  }

  function refreshAll() {
    state.subjects.forEach(function (s) {
      var el = root.querySelector('[data-sid="' + s.id + '"]');
      if (el) applySubject(el, s);
    });
    updateSummary();
  }

  function onEdit() { refreshAll(); saveSoon(); }

  function field(value, cls, ph, label, kind, onchange) {
    var i = h('input', { class: 'f ' + cls, type: 'text', value: value, placeholder: ph, 'aria-label': label, autocomplete: 'off',
      inputmode: kind === 'text' ? 'text' : 'decimal' });
    if (kind !== 'text') validate(i, kind);
    i.addEventListener('input', function () {
      onchange(i.value);
      if (kind !== 'text') validate(i, kind);
      onEdit();
      if (kind === 'weight') {
        var owner = i.closest('.subj');
        var subject = owner && state.subjects.filter(function (s) { return s.id === owner.getAttribute('data-sid'); })[0];
        if (subject && subject.ms.some(function (m) { var cm = calcM(m); return cm.invalidWeight || cm.totalW > 10 + EPS; })) focusInvalidM(owner, subject);
      }
    });
    return i;
  }

  function buildActRow(m, a) {
    var row = h('div', { class: 'arow', 'data-aid': a.id });
    row.append(
      field(a.name, '', 'Atividade', 'Nome da atividade', 'text', function (v) { a.name = v; }),
      field(a.grade, 'num', 'Nota', 'Nota da atividade', 'grade', function (v) { a.grade = v; }),
      field(a.weight, 'num', 'Peso', 'Peso da atividade', 'weight', function (v) { a.weight = v; }),
      h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Remover atividade', text: '×', onclick: function () {
        m.acts = m.acts.filter(function (x) { return x !== a; });
        render(); saveSoon();
      } }),
      h('div', { class: 'pts' })
    );
    return row;
  }

  function buildM(s, m, i) {
    var acts = h('div', { class: 'acts' });
    if (m.acts.length) {
      acts.append(h('div', { class: 'arow lab' }, h('span', { text: 'Atividade' }), h('span', { text: 'Nota' }), h('span', { text: 'Peso' }), h('span')));
      m.acts.forEach(function (a) { acts.append(buildActRow(m, a)); });
    } else {
      acts.append(h('div', { class: 'none', role: 'note' },
        h('strong', { text: 'Esta M ainda está sem atividades.' }),
        h('span', { text: 'Adicione provas, trabalhos e seminários com seus pesos para calcular sua nota.' })));
    }
    return h('section', { class: 'm', 'data-m': String(i) },
      h('div', { class: 'mhead' },
        h('h3', { text: 'M' + (i + 1) }),
        h('span', { class: 'mtag' }),
        h('span', { class: 'mval' })),
      h('label', { class: 'direct' }, h('span', { text: 'Nota da M (se já saiu)' }),
        field(m.direct, 'num', '—', 'Nota da M' + (i + 1), 'grade', function (v) { m.direct = v; })),
      acts,
      h('div', { class: 'm-impossible', hidden: true, role: 'status' }),
      h('div', { class: 'hintline', hidden: true, text: 'Em verde: nota mínima em cada atividade que falta, tirando a mesma nota em todas. Embaixo, quantos pontos da M ela rende, pelo peso (regra de três).' }),
      h('div', { class: 'mfoot' },
        h('button', { class: 'btn', type: 'button', text: '+ Atividade', onclick: function () {
          var a = { id: uid(), name: '', grade: '', weight: '' };
          m.acts.push(a);
          pendingFocus = a.id;
          render(); saveSoon();
        } }),
        h('span', { class: 'wsum' })));
  }

  function buildSubject(s) {
    var isOpen = !!expanded[s.id];
    var body = h('div', { class: 'subj-body', hidden: !isOpen });
    var nameLabel = h('div');
    nameLabel.append(h('span', { class: 'field-label', text: 'Nome da matéria' }),
      field(s.name, '', 'Ex.: Anatomia', 'Nome da matéria', 'text', function (v) { s.name = v; }));
    body.append(nameLabel);
    s.ms.forEach(function (m, i) { body.append(buildM(s, m, i)); });
    var delBtn = h('button', { class: 'btn danger', type: 'button', text: 'Excluir matéria' });
    var armTimer;
    delBtn.addEventListener('click', function () {
      if (!delBtn.classList.contains('armed')) {
        delBtn.classList.add('armed');
        delBtn.textContent = 'Toque de novo para excluir';
        armTimer = setTimeout(function () { delBtn.classList.remove('armed'); delBtn.textContent = 'Excluir matéria'; }, 3500);
        return;
      }
      clearTimeout(armTimer);
      state.subjects = state.subjects.filter(function (x) { return x !== s; });
      render(); saveSoon();
    });
    body.append(h('div', { class: 'del' }, delBtn));

    var head = h('button', { class: 'subj-head', type: 'button', 'aria-expanded': isOpen ? 'true' : 'false' },
      h('div', { class: 'row1' },
        h('div', { class: 'name-stack' }, h('span', { class: 'sname' }), h('span', { class: 'subject-failed', hidden: true })),
        h('span', { class: 'right' }, h('span', { class: 'pill' }), h('span', { class: 'chev' }))),
      h('div', { class: 'meter' }, h('div', { class: 'fillmax' }), h('div', { class: 'fill' }), h('div', { class: 'tick' }), h('div', { class: 'ticklabel' })),
      h('div', { class: 'row3' }, h('span', { class: 'sum' }, '', h('small')), h('span', { class: 'verdict' })));
    head.addEventListener('click', function () {
      var now = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', now ? 'true' : 'false');
      body.hidden = !now;
      expanded[s.id] = now;
    });
    var el = h('article', { class: 'subj', 'data-sid': s.id }, head, body);
    applySubject(el, s);
    return el;
  }

  function render() {
    root.replaceChildren();
    if (!state.subjects.length) {
      root.append(h('div', { class: 'empty', text: 'Nenhuma matéria ainda. Toque em + Matéria para começar.' }));
    }
    state.subjects.forEach(function (s) { root.append(buildSubject(s)); });
    updateSummary();
    if (pendingFocus) {
      var found = null;
      root.querySelectorAll('.arow').forEach(function () {});
      state.subjects.forEach(function (s) { s.ms.forEach(function (m) {
        m.acts.forEach(function (a, idx) {
          if (a.id === pendingFocus) {
            var sec = root.querySelector('[data-sid="' + s.id + '"] [data-m="' + s.ms.indexOf(m) + '"]');
            var rows = sec && sec.querySelectorAll('.arow:not(.lab)');
            found = rows && rows[idx] && rows[idx].querySelector('input');
          }
        });
      }); });
      if (found) found.focus();
      pendingFocus = null;
    }
  }

  document.getElementById('addSubj').addEventListener('click', function () {
    var s = { id: uid(), name: '', ms: [emptyM(), emptyM(), emptyM()] };
    state.subjects.push(s);
    expanded[s.id] = true;
    render(); saveSoon();
    var el = root.querySelector('[data-sid="' + s.id + '"]');
    if (el) { var i = el.querySelector('.subj-body input'); if (i) i.focus(); el.scrollIntoView({ block: 'nearest' }); }
  });

  /* Configurações e tutorial */
  var ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';
  var tutEl = document.getElementById('tutorial');
  var setEl = document.getElementById('settings');
  var tutStep = 0;

  function mock(v, ph, cls, left) {
    return h('input', { class: 'f ' + (left ? '' : 'num ') + (cls || ''), type: 'text', readonly: true, tabindex: '-1', 'aria-hidden': 'true', value: v, placeholder: ph || '' });
  }
  function cap(t) { return h('span', { class: 'cap', text: t }); }
  function demoMs() {
    return h('div', { class: 'demo', 'aria-hidden': 'true' }, cap('Exemplo'),
      h('div', { class: 'demo-ms' },
        h('span', { class: 'chip', text: 'M1' }), h('span', { class: 'plus', text: '+' }),
        h('span', { class: 'chip', text: 'M2' }), h('span', { class: 'plus', text: '+' }),
        h('span', { class: 'chip', text: 'M3' }), h('span', { class: 'demo-eq', text: '≥ ' + fmt(targetNum()) })));
  }
  function demoAdd() {
    return h('div', { class: 'demo', 'aria-hidden': 'true' }, cap('No alto da tela'),
      h('div', { class: 'demo-ms' }, h('button', { class: 'btn primary', type: 'button', tabindex: '-1', text: '+ Matéria' })),
      cap('Depois, o nome'), mock('Anatomia', '', '', true));
  }
  function demoActs() {
    return h('div', { class: 'demo', 'aria-hidden': 'true' }, cap('Exemplo de uma M'),
      h('div', { class: 'arow lab' }, h('span', { text: 'Atividade' }), h('span', { text: 'Nota' }), h('span', { text: 'Peso' })),
      h('div', { class: 'arow' }, mock('Prova 1', '', '', true), mock('8,5', 'Nota'), mock('5', 'Peso')),
      h('div', { class: 'arow' }, mock('Seminário', '', '', true), mock('', 'Nota'), mock('5', 'Peso')),
      cap('Seminário ainda sem nota: só o peso'));
  }
  function demoDirect() {
    return h('div', { class: 'demo', 'aria-hidden': 'true' }, cap('Exemplo'),
      h('div', { class: 'direct' }, h('span', { text: 'Nota da M (se já saiu)' }), mock('7,5', '—')));
  }
  function demoResult() {
    return h('div', { class: 'demo', 'aria-hidden': 'true' }, cap('Exemplo'),
      h('div', { class: 'meter' },
        h('div', { class: 'fillmax', style: 'width:60%' }), h('div', { class: 'fill', style: 'width:34%' }),
        h('div', { class: 'tick', style: 'left:59%' }), h('div', { class: 'ticklabel', style: 'left:59%', text: fmt(targetNum()) })),
      h('div', { class: 'row3' }, h('span', { class: 'sum' }, '10,35 ', h('small', { text: '/ ' + fmt(targetNum()) })), h('span', { class: 'verdict', text: 'Precisa de 7,40 na M3.' })),
      h('div', { class: 'arow' }, mock('Prova 3', '', '', true), mock('', '7,40', 'hint'), mock('7', 'Peso')));
  }
  function demoGear() {
    var g = h('span', { class: 'gear' });
    g.innerHTML = ICON;
    return h('div', { class: 'demo', 'aria-hidden': 'true' },
      h('div', { class: 'demo-ms' }, g, h('span', { text: 'Configurações  →  Ver tutorial' })));
  }

  var STEPS = [
    { t: 'Como funciona', x: function () { return 'Cada matéria tem três notas: M1, M2 e M3. Para passar, a soma das três precisa chegar a ' + fmt(targetNum()) + '. O app faz a conta e mostra quanto falta.'; }, demo: demoMs },
    { t: '1. Adicione a matéria', x: 'Toque em + Matéria e escreva o nome. O cartão abre com M1, M2 e M3.', demo: demoAdd },
    { t: '2. Lance as atividades', x: 'Dentro de cada M, toque em + Atividade e preencha nome, nota e peso. Os pesos de uma M somam 10. Se a prova ainda não aconteceu, deixe a nota vazia e coloque só o peso.', demo: demoActs },
    { t: '3. A nota da M já saiu?', x: 'Digite em "Nota da M (se já saiu)". Ela vale no lugar das atividades daquela M.', demo: demoDirect },
    { t: '4. Veja quanto falta', x: 'O cartão mostra a soma atual, a barra com a marca do mínimo e o que você precisa tirar. Os campos de nota vazios aparecem em verde com a nota mínima de cada atividade que falta.', demo: demoResult },
    { t: 'Pronto', x: 'Para ver este tutorial de novo, toque no ícone de ajustes no alto da tela e em "Ver tutorial".', demo: demoGear }
  ];

  function writeLocal() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {} }

  function renderTut() {
    var st = STEPS[tutStep];
    var last = tutStep === STEPS.length - 1;
    var sheet = tutEl.querySelector('.sheet');
    sheet.replaceChildren();
    var dots = h('div', { class: 'dots', 'aria-hidden': 'true' });
    STEPS.forEach(function (_, i) { dots.append(h('span', { class: 'dot' + (i === tutStep ? ' on' : '') })); });
    var back = h('button', { class: 'btn', type: 'button', text: 'Voltar', onclick: function () { tutStep--; renderTut(); } });
    if (tutStep === 0) { back.disabled = true; back.style.visibility = 'hidden'; }
    var next = h('button', { class: 'btn primary', type: 'button', text: last ? 'Começar' : 'Próximo', onclick: function () {
      if (last) closeTut(); else { tutStep++; renderTut(); }
    } });
    sheet.append(
      h('div', { class: 'sheet-head' },
        h('span', { class: 'tut-step', text: 'Passo ' + (tutStep + 1) + ' de ' + STEPS.length }),
        last ? null : h('button', { class: 'link', type: 'button', text: 'Pular', onclick: closeTut })),
      h('h2', { id: 'tut-title', text: st.t }),
      h('p', { class: 'tut-text', text: typeof st.x === 'function' ? st.x() : st.x }),
      st.demo(), dots,
      h('div', { class: 'tut-nav' }, back, next));
    next.focus();
  }
  function openTutorial(step) { tutStep = step || 0; tutEl.hidden = false; renderTut(); }
  function closeTut() {
    tutEl.hidden = true;
    if (!state.seenTutorial) { state.seenTutorial = true; writeLocal(); }
    if (!state.targetSetupSeen) openTargetSetup();
  }
  var themeMode = document.getElementById('themeMode');
  function applyTheme(value, shouldSave) {
    var theme = ['auto','light','dark'].indexOf(value) >= 0 ? value : 'auto';
    state.theme = theme;
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    if (themeMode) themeMode.value = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
      if (theme === 'dark') meta.content = '#0c1412';
      else if (theme === 'light') meta.content = '#edf1ef';
      else if (meta.media.indexOf('dark') >= 0) meta.content = '#0c1412';
      else meta.content = '#edf1ef';
    });
    if (shouldSave) saveSoon();
  }
  applyTheme(state.theme || 'auto', false);
  if (themeMode) themeMode.addEventListener('change', function () { applyTheme(themeMode.value, true); });
  function openSettings() { setEl.hidden = false; document.getElementById('closeSettings').focus(); }
  function closeSettings() { setEl.hidden = true; }

  document.getElementById('openSettings').addEventListener('click', openSettings);
  document.getElementById('closeSettings').addEventListener('click', closeSettings);
  setEl.addEventListener('click', function (e) { if (e.target === setEl) closeSettings(); });
  document.getElementById('showTutorial').addEventListener('click', function () { closeSettings(); openTutorial(0); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!tutEl.hidden) closeTut(); else if (!setupEl.hidden) closeTargetSetup(); else if (!setEl.hidden) closeSettings();
  });

  var tgt = document.getElementById('target');
  var setupEl = document.getElementById('targetSetup');
  var setupTarget = document.getElementById('setupTarget');
  tgt.value = state.target;
  function validTarget(value) {
    var t = String(value).trim(), n = num(t);
    return t !== '' && n !== null && n > 0 && n <= 30;
  }
  function setTargetValue(value) {
    state.target = value; tgt.value = value; setupTarget.value = value;
    tgt.classList.toggle('bad', !validTarget(value));
    setupTarget.classList.toggle('bad', !validTarget(value));
    refreshAll(); saveSoon();
  }
  function closeTargetSetup() { setupEl.hidden = true; state.targetSetupSeen = true; saveSoon(); }
  function openTargetSetup() { setupTarget.value = state.target; setupEl.hidden = false; setupTarget.focus(); }
  document.getElementById('setupUse18').addEventListener('click', function () { setTargetValue('18'); closeTargetSetup(); });
  document.getElementById('setupUse1775').addEventListener('click', function () { setTargetValue('17,75'); closeTargetSetup(); });
  document.getElementById('setupSaveCustom').addEventListener('click', function () {
    if (!validTarget(setupTarget.value)) { setupTarget.classList.add('bad'); setupTarget.setAttribute('aria-invalid','true'); setupTarget.focus(); return; }
    setTargetValue(setupTarget.value.trim()); closeTargetSetup();
  });
  document.getElementById('use18').addEventListener('click', function () { setTargetValue('18'); });
  document.getElementById('use1775').addEventListener('click', function () { setTargetValue('17,75'); });
  tgt.addEventListener('input', function () {
    state.target = tgt.value;
    var bad = !validTarget(tgt.value);
    tgt.classList.toggle('bad', bad); tgt.setAttribute('aria-invalid', bad ? 'true' : 'false');
    if (!bad) onEdit(); else refreshAll();
  });
  setupTarget.addEventListener('input', function () {
    var bad = !validTarget(setupTarget.value);
    setupTarget.classList.toggle('bad', bad); setupTarget.setAttribute('aria-invalid', bad ? 'true' : 'false');
  });

  render();
  applyTheme(state.theme || 'auto', false);
  setStatus('Salvo neste navegador');
  migrated = false;
  if (!state.seenTutorial) openTutorial(0);
  else if (!state.targetSetupSeen) openTargetSetup();

  /* Registra o app para instalação e uso offline. */
  if ('serviceWorker' in navigator) {
    var hadController = !!navigator.serviceWorker.controller;
    var refreshingForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController && !refreshingForUpdate) {
        refreshingForUpdate = true;
        window.location.reload();
      }
      hadController = true;
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(function (registration) {
        registration.update().catch(function () {});
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) registration.update().catch(function () {});
        });
      }).catch(function () {});
    });
  }

  /* Guarda na conta do usuário quando o armazenamento do Claude está disponível. */
  (function connect() {
    try {
      var c = window.claude;
      if (!c || !c.use) return;
      Promise.all([c.use('user'), c.use('db')]).then(function (r) {
        var user = r[0], db = r[1];
        if (!user || !db) return null;
        return user.id().then(function (id) {
          if (!id) return null;
          var doc = db.doc('data/users/' + id + '/app');
          var timeout = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 10000); });
          return Promise.race([doc.get(), timeout]).then(function (snap) {
            dbDoc = doc;
            var d = snap.exists ? snap.data() : null;
            if (d && Array.isArray(d.subjects)) {
              var remote = normalize(d);
              if (dirty) {
                var ids = {};
                remote.subjects.forEach(function (x) { ids[x.id] = 1; });
                state.subjects.forEach(function (x) { if (!ids[x.id]) remote.subjects.push(x); });
                remote.seenTutorial = remote.seenTutorial || state.seenTutorial;
                state = remote;
                tgt.value = state.target;
                applyTheme(state.theme || 'auto', false);
                render();
                persist();
              } else {
                remote.seenTutorial = remote.seenTutorial || state.seenTutorial;
                state = remote;
                tgt.value = state.target;
                applyTheme(state.theme || 'auto', false);
                render();
                if (migrated) { migrated = false; saveSoon(); }
              }
              if (state.seenTutorial && !tutEl.hidden) tutEl.hidden = true;
            } else if (dirty) {
              persist();
            }
            if (!dirty) setStatus('Conectado à sua conta');
          });
        });
      }).catch(function () {});
    } catch (e) {}
  })();
})();
