// Historie verzí dokumentu: úpravy jednoho člověka v rámci 10 minut tvoří jednu verzi. Náhled verze,
// co se v ní změnilo (proti předchozí) a obnovení (aktuální stav v historii zůstane).
import { api, avatar, confirmDlg, errorToast, h, icon, loadTree, plural, timeOnly, toast, userById, userName, when } from './lib.js';
import { mdToHtml } from './md.js';
import { diffLines } from './merge.js';

export async function viewHistory(id) {
  const [{ doc }, { revisions }] = await Promise.all([api(`/api/docs/${id}`), api(`/api/docs/${id}/revisions`)]);
  document.title = `Historie – ${doc.title} – Poznámky`;
  const list = h('ul', { class: 'revlist', role: 'listbox', 'aria-label': 'Verze' });
  const detail = h('div', { class: 'revdetail card' });
  let showDiff = true;
  let current = null;

  async function select(rev, btn) {
    for (const b of list.querySelectorAll('[aria-selected]')) b.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-selected', 'true');
    detail.replaceChildren(h('p', { class: 'muted' }, 'Načítám…'));
    try {
      current = (await api(`/api/revisions/${rev.id}`)).revision;
      renderDetail(rev);
    } catch (e) { errorToast(e); }
  }

  function renderDetail(rev) {
    const r = current;
    const latest = rev.id === revisions[0].id;
    const body = showDiff
      ? diffView(r.prev_body ?? '', r.body)
      : h('div', { class: 'prose' }, ...(() => { const d = h('div'); d.innerHTML = mdToHtml(r.body); return [...d.childNodes]; })());
    detail.replaceChildren(
      h('div', { class: 'revhead' },
        h('div', null, h('strong', null, revLabel(rev)), h('div', { class: 'small secondary' }, r.title !== doc.title ? `Název tehdy: ${r.title}` : '')),
        h('div', { class: 'seg small', role: 'group', 'aria-label': 'Zobrazení' },
          h('button', { type: 'button', 'aria-pressed': String(showDiff), onclick: () => { showDiff = true; renderDetail(rev); } }, 'Co se změnilo'),
          h('button', { type: 'button', 'aria-pressed': String(!showDiff), onclick: () => { showDiff = false; renderDetail(rev); } }, 'Celý text')),
        latest ? h('span', { class: 'badge' }, 'aktuální') : h('button', {
          type: 'button', class: 'btn small primary',
          onclick: async () => {
            if (!await confirmDlg({ title: 'Obnovit tuto verzi?', text: 'Text dokumentu se vrátí do této podoby. Současný stav zůstane v historii, takže jde vrátit zpátky.', ok: 'Obnovit', danger: false })) return;
            try {
              await api(`/api/revisions/${rev.id}/restore`, { method: 'POST' });
              await loadTree();
              toast('Verze obnovena');
              location.hash = `#/d/${id}`;
            } catch (e) { errorToast(e); }
          },
        }, icon('restore', 'ic sm'), 'Obnovit tuto verzi')),
      body);
  }

  const revLabel = (rev) => {
    const a = when(rev.started_at);
    const b = timeOnly(rev.saved_at);
    return `${a.endsWith(b) ? a : `${a}–${b}`}`;
  };

  revisions.forEach((rev, k) => {
    const u = userById(rev.user_id);
    const prev = revisions[k + 1];
    const delta = prev ? rev.len - prev.len : rev.len;
    const btn = h('button', { type: 'button', class: 'revitem', role: 'option', 'aria-selected': 'false', onclick: () => select(rev, btn) },
      avatar(u),
      h('span', { class: 'rev-main' }, h('span', null, userName(rev.user_id)), h('span', { class: 'small secondary' }, revLabel(rev))),
      h('span', { class: `small num ${delta >= 0 ? 'plus' : 'minus'}` }, k === revisions.length - 1 ? 'vytvořeno' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} ${plural(Math.abs(delta), 'znak', 'znaky', 'znaků')}`));
    list.append(h('li', null, btn));
  });

  const page = h('div', { class: 'historypage' },
    h('header', { class: 'pagehead' },
      h('a', { class: 'iconbtn small', href: `#/d/${id}`, 'aria-label': 'Zpět do dokumentu' }, icon('back')),
      h('h1', null, 'Historie verzí'), h('span', { class: 'secondary' }, doc.title)),
    revisions.length ? h('div', { class: 'revlayout' }, h('div', { class: 'card revside' }, list), detail) : h('p', { class: 'empty' }, 'Zatím žádné verze.'));
  if (revisions.length) setTimeout(() => list.querySelector('.revitem')?.click(), 0);
  return page;
}

/** Řádky s vyznačením, co přibylo (+) a co ubylo (−); dlouhé beze změny se zkrátí. */
function diffView(before, after) {
  const ops = diffLines(before, after);
  if (!ops.some((o) => o.t !== '=')) return h('p', { class: 'muted' }, before === after ? 'V této verzi se text nezměnil (jen název).' : 'Beze změn.');
  const out = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t !== '=') { out.push(line(ops[k])); k++; continue; }
    let e = k;
    while (e < ops.length && ops[e].t === '=') e++;
    const run = ops.slice(k, e);
    if (run.length > 6) {
      if (k > 0) out.push(...run.slice(0, 2).map(line));
      out.push(h('div', { class: 'dl skip' }, `… ${run.length - (k > 0 ? 2 : 0) - (e < ops.length ? 2 : 0)} řádků beze změny …`));
      if (e < ops.length) out.push(...run.slice(-2).map(line));
    } else {
      out.push(...run.map(line));
    }
    k = e;
  }
  return h('div', { class: 'diff' }, out);
}
const line = (o) => h('div', { class: `dl ${o.t === '+' ? 'add' : o.t === '-' ? 'del' : ''}` }, h('span', { class: 'dm', 'aria-hidden': 'true' }, o.t === '=' ? ' ' : o.t === '+' ? '+' : '−'), h('span', { class: 'dt' }, o.line || ' '));
