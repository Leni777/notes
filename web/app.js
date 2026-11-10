// Appka Poznámky: společné dokumenty Lenky a Romana (plán dovolené, seznam dárků…). Bez sestavování (čisté ES moduly).
import {
  ago, api, avatar, byUpdated, closeSheet, confirmDlg, errorToast, folderById, folderPath, h, icon, loadMe, loadTree, LS,
  onTree, openMenu, plural, setUnauthorizedHandler, state, toast, userName, verb,
} from './lib.js';
import { docRow, folderListing, folderMenu, newDoc, newFolder, renderSidebar, sortToggle, targetFolder } from './tree.js';
import { viewDoc } from './doc.js';
import { viewHistory } from './history.js';
import { disablePush, enablePush, pushState, refreshPush } from './push.js';

const $app = document.getElementById('app');
const $side = document.getElementById('side');
const $fab = document.getElementById('fab');

// ---------- přihlášení ----------
function showLogin() {
  document.body.classList.add('logged-out');
  closeSheet();
  current.leave.splice(0).forEach((fn) => { try { fn(); } catch { /* nic */ } });
  const login = h('input', { type: 'text', autocomplete: 'username', required: true, value: LS.get('login', ''), autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Jméno' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Heslo' });
  const err = h('p', { class: 'small bad', role: 'alert' });
  const form = h('form', {
    class: 'card login',
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        await api('/api/login', { method: 'POST', body: { login: login.value.trim().toLowerCase(), password: pass.value } });
        LS.set('login', login.value.trim().toLowerCase());
        await start();
      } catch (x) { err.textContent = x.message; }
    },
  },
  h('div', { class: 'brand' }, h('img', { src: 'icon.svg', alt: '', width: 40, height: 40 }), h('h1', null, 'Poznámky')),
  h('label', { class: 'field' }, h('span', { class: 'label' }, 'Jméno'), login),
  h('label', { class: 'field' }, h('span', { class: 'label' }, 'Heslo'), pass),
  err,
  h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Přihlásit')));
  $app.replaceChildren(form);
  (login.value ? pass : login).focus();
}
setUnauthorizedHandler(showLogin);

// ---------- router ----------
// #/  přehled · #/f/12 složka · #/d/34 dokument · #/d/34/historie · #/hledat · #/kos · #/nastaveni
const parseHash = () => {
  const [, name = '', ...arg] = (location.hash || '#/').split('/');
  return { name: decodeURIComponent(name), arg: arg.map(decodeURIComponent) };
};
let token = 0;
let current = { leave: [] };

async function render() {
  const my = ++token;
  const route = parseHash();
  const sameRoute = state.route && state.route.name === route.name && state.route.arg.join('/') === route.arg.join('/');
  state.route = route;
  closeSheet();
  const ctx = { leave: [], mount: [], onLeave(fn) { this.leave.push(fn); }, onMount(fn) { this.mount.push(fn); }, isNew: false };
  let view;
  const { name, arg } = route;
  if (name === 'd' && arg[1] === 'historie') view = () => viewHistory(Number(arg[0]));
  else if (name === 'd') {
    ctx.isNew = state.newDocId === Number(arg[0]);
    state.newDocId = null;
    view = () => viewDoc(Number(arg[0]), ctx);
  } else if (name === 'f') view = () => viewFolder(Number(arg[0]));
  else if (name === 'hledat') view = () => viewSearch();
  else if (name === 'kos') view = () => viewTrash();
  else if (name === 'nastaveni') view = () => viewSettings();
  else view = () => viewHome();
  document.body.dataset.view = name || 'home';
  $fab.hidden = !(name === '' || name === 'f');
  renderSidebar($side);
  if (!sameRoute) $app.classList.add('loading');
  try {
    const content = await view();
    if (my !== token) { ctx.leave.forEach((fn) => fn()); return; }
    current.leave.splice(0).forEach((fn) => { try { fn(); } catch { /* nic */ } });
    current = ctx;
    $app.replaceChildren(...[content].flat(Infinity).filter((x) => x != null && x !== false));
    if (!sameRoute) window.scrollTo(0, 0);
    ctx.mount.forEach((fn) => fn());
    if (name !== 'd') document.title = 'Poznámky';
  } catch (e) {
    if (my !== token || e.status === 401) return;
    current.leave.splice(0).forEach((fn) => { try { fn(); } catch { /* nic */ } });
    $app.replaceChildren(h('div', { class: 'banner', role: 'alert' }, e.status === 404 ? e.message : `Nepodařilo se načíst: ${e.message}`,
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/' }, 'Na přehled'), h('button', { class: 'btn', onclick: () => render() }, 'Zkusit znovu'))));
  } finally {
    if (my === token) $app.classList.remove('loading');
  }
}
const refresh = () => { if (state.route?.name !== 'd') render(); };
window.addEventListener('notes:refresh', refresh);
$fab.addEventListener('click', () => openMenu(null, [
  { label: 'Nový dokument', icon: 'docPlus', run: () => newDoc(targetFolder()) },
  { label: 'Nová složka', icon: 'folderPlus', run: () => newFolder(targetFolder()) },
]));

// po návratu do appky načíst znovu (druhý mezitím mohl něco změnit)
let hiddenAt = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (!state.me || !hiddenAt || Date.now() - hiddenAt < 30000 || document.getElementById('sheet').open) return;
  try { await loadTree(); refresh(); } catch { /* offline */ }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); location.hash = '#/hledat'; }
});

const pageHead = (title, ...rest) => h('header', { class: 'pagehead' }, h('h1', null, title), ...rest);
const headIcons = () => [
  h('a', { class: 'iconbtn small push-right narrow-only', href: '#/hledat', 'aria-label': 'Hledat' }, icon('search')),
  h('a', { class: 'iconbtn small narrow-only', href: '#/nastaveni', 'aria-label': 'Nastavení' }, icon('gear')),
];

// ---------- přehled ----------
async function viewHome() {
  await loadTree();
  const docs = state.tree.docs;
  const pinned = docs.filter((d) => d.pinned).sort(byUpdated);
  const recent = [...docs].sort(byUpdated).slice(0, 6);
  return [
    pageHead('Poznámky', ...headIcons()),
    h('a', { class: 'searchbar', href: '#/hledat' }, icon('search'), h('span', { class: 'muted' }, 'Hledat v dokumentech…')),
    pinned.length ? h('section', { class: 'card' }, h('h2', null, 'Připnuté'), h('ul', { class: 'items' }, pinned.map((d) => docRow(d, { showFolder: true })))) : null,
    recent.length ? h('section', { class: 'card' }, h('h2', null, 'Naposledy upravené'), h('ul', { class: 'items' }, recent.map((d) => docRow(d, { showFolder: true })))) : null,
    h('section', { class: 'card' },
      h('div', { class: 'sec-head' }, h('h2', null, 'Všechny dokumenty'), sortToggle(refresh)),
      h('div', { class: 'actions top' },
        h('button', { type: 'button', class: 'btn small primary', onclick: () => newDoc(null) }, icon('docPlus', 'ic sm'), 'Nový dokument'),
        h('button', { type: 'button', class: 'btn small', onclick: () => newFolder(null) }, icon('folderPlus', 'ic sm'), 'Nová složka')),
      folderListing(null)),
    h('a', { class: 'linkcard narrow-only', href: '#/kos' }, icon('trash', 'ic sm'), 'Koš'),
  ];
}

// ---------- složka ----------
async function viewFolder(id) {
  await loadTree();
  const f = folderById(id);
  if (!f) throw Object.assign(new Error('Složka neexistuje (možná je v koši).'), { status: 404 });
  const path = folderPath(id);
  const up = f.parent_id ? `#/f/${f.parent_id}` : '#/';
  return [
    h('header', { class: 'pagehead' },
      h('a', { class: 'iconbtn small', href: up, 'aria-label': 'O úroveň výš' }, icon('back')),
      h('h1', null, icon('folder', 'ic h1ic'), f.name),
      h('button', { type: 'button', class: 'iconbtn small push-right', 'aria-label': 'Volby složky', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); folderMenu(f, { x: r.right - 240, y: r.bottom + 4, touch: matchMedia('(pointer: coarse)').matches }); } }, icon('more'))),
    h('nav', { class: 'crumbs small', 'aria-label': 'Cesta' }, h('a', { href: '#/' }, 'Dokumenty'), path.slice(0, -1).map((p) => [' › ', h('a', { href: `#/f/${p.id}` }, p.name)]), ' › ', h('span', null, f.name)),
    h('section', { class: 'card' },
      h('div', { class: 'sec-head' },
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn small primary', onclick: () => newDoc(id) }, icon('docPlus', 'ic sm'), 'Nový dokument'),
          h('button', { type: 'button', class: 'btn small', onclick: () => newFolder(id) }, icon('folderPlus', 'ic sm'), 'Podsložka')),
        sortToggle(refresh)),
      folderListing(id)),
  ];
}

// ---------- hledání ----------
async function viewSearch() {
  const q0 = sessionStorage.getItem('notes:q') || '';
  const input = h('input', { type: 'search', value: q0, placeholder: 'Hledat v názvech a textu…', 'aria-label': 'Hledat', enterkeyhint: 'search', autocomplete: 'off' });
  const results = h('div', { class: 'card' });
  let timer = null;
  let seq = 0;
  const run = async () => {
    const q = input.value.trim();
    sessionStorage.setItem('notes:q', q);
    const my = ++seq;
    if (q.length < 2) { results.replaceChildren(h('p', { class: 'empty' }, 'Napiš aspoň dvě písmena. Hledá se bez ohledu na diakritiku a velká písmena.')); return; }
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (my !== seq) return;
      const words = q.split(/\s+/).filter(Boolean);
      results.replaceChildren(r.results.length
        ? h('ul', { class: 'items' }, r.results.map((d) => docRow(d, { showFolder: true, snippet: h('span', { class: 'item-preview' }, highlight(d.snippet, words)) })))
        : h('p', { class: 'empty' }, `Nic nenalezeno pro „${q}“.`));
    } catch (e) { errorToast(e); }
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  run();
  setTimeout(() => input.focus(), 0);
  return [pageHead('Hledat', ...headIcons()), h('label', { class: 'searchbar' }, icon('search'), input), results];
}

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
/** Zvýraznění hledaných slov (bez ohledu na diakritiku). */
function highlight(text, words) {
  const f = [...text].map((c) => fold(c)).join('');
  if (f.length !== text.length) return text;
  const marks = new Array(text.length).fill(false);
  for (const w of words.map(fold)) for (let i = f.indexOf(w); w && i >= 0; i = f.indexOf(w, i + 1)) for (let k = 0; k < w.length; k++) marks[i + k] = true;
  const out = [];
  let k = 0;
  while (k < text.length) {
    let e = k;
    while (e < text.length && marks[e] === marks[k]) e++;
    out.push(marks[k] ? h('mark', null, text.slice(k, e)) : text.slice(k, e));
    k = e;
  }
  return out;
}

// ---------- koš ----------
async function viewTrash() {
  const t = await api('/api/trash');
  const act = async (fn, msg) => { try { await fn(); await loadTree(); toast(msg); render(); } catch (e) { errorToast(e); } };
  const row = (kind, item) => h('li', { class: 'trashrow' },
    icon(kind === 'folder' ? 'folder' : 'doc', 'ic item-ic'),
    h('span', { class: 'item-main' },
      h('span', { class: 'item-title' }, kind === 'folder' ? item.name : item.title),
      h('span', { class: 'item-meta' }, `${verb(item.deleted_by, 'Smazal')} ${userName(item.deleted_by)} ${ago(item.deleted_at)}`,
        kind === 'folder' && item.docs ? ` · ${item.docs} ${plural(item.docs, 'dokument', 'dokumenty', 'dokumentů')}` : '')),
    h('span', { class: 'trash-actions' },
      h('button', { type: 'button', class: 'btn small', onclick: () => act(() => api(`/api/${kind === 'folder' ? 'folders' : 'docs'}/${item.id}/restore`, { method: 'POST' }), 'Obnoveno') }, icon('restore', 'ic sm'), 'Obnovit'),
      h('button', {
        type: 'button', class: 'btn small danger', 'aria-label': `Smazat natrvalo: ${kind === 'folder' ? item.name : item.title}`,
        onclick: async () => {
          if (!await confirmDlg({ title: 'Smazat natrvalo?', text: 'Tohle už nepůjde vrátit (ani z historie verzí).', ok: 'Smazat natrvalo' })) return;
          act(() => api(`/api/trash/${kind === 'folder' ? 'folders' : 'docs'}/${item.id}`, { method: 'DELETE' }), 'Smazáno natrvalo');
        },
      }, icon('trash', 'ic sm'))));
  const empty = !t.folders.length && !t.docs.length;
  return [
    pageHead('Koš', empty ? null : h('button', {
      type: 'button', class: 'btn small danger push-right',
      onclick: async () => {
        if (!await confirmDlg({ title: 'Vysypat koš?', text: 'Všechno v koši se smaže natrvalo.', ok: 'Vysypat' })) return;
        act(() => api('/api/trash', { method: 'DELETE' }), 'Koš je prázdný');
      },
    }, 'Vysypat koš')),
    h('p', { class: 'small secondary' }, 'Smazané dokumenty a složky. Obnovený dokument se vrátí do své složky (když už neexistuje, do Dokumentů).'),
    h('section', { class: 'card' }, empty ? h('p', { class: 'empty' }, 'Koš je prázdný.')
      : h('ul', { class: 'items' }, t.folders.map((f) => row('folder', f)), t.docs.map((d) => row('doc', d)))),
  ];
}

// ---------- nastavení ----------
async function viewSettings() {
  const out = [pageHead('Nastavení', ...headIcons())];

  out.push(h('section', { class: 'card' },
    h('h2', null, 'Účet'),
    h('p', { class: 'userline' }, avatar(state.me), `Přihlášen${state.me.female ? 'a' : ''} jako `, h('strong', null, state.me.name),
      h('button', { type: 'button', class: 'btn small push-right', onclick: async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); state.me = null; showLogin(); } }, icon('logout', 'ic sm'), 'Odhlásit')),
    passwordForm()));

  const mode = LS.get('mode', 'rich');
  out.push(h('section', { class: 'card' },
    h('h2', null, 'Psaní'),
    h('p', { class: 'small secondary' }, 'Přepínat jde kdykoli přímo v dokumentu. Dokument je uložený jako Markdown, takže oba režimy ukazují totéž.'),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Výchozí režim' },
      ['rich', 'md'].map((m) => h('button', { type: 'button', 'aria-pressed': String(mode === m), onclick: () => { LS.set('mode', m); render(); } },
        m === 'rich' ? 'Formát (jako Google Docs)' : 'Markdown (jako VS Code)'))),
    h('details', { class: 'help' }, h('summary', null, 'Zkratky při psaní'),
      h('ul', { class: 'small' },
        h('li', null, h('code', null, '# '), ', ', h('code', null, '## '), ', ', h('code', null, '### '), ' na začátku řádku = nadpis (Ctrl+Alt+1/2/3)'),
        h('li', null, h('code', null, '- '), ' = odrážky, ', h('code', null, '1. '), ' = číslovaný seznam, ', h('code', null, '[] '), ' = zaškrtávací políčko'),
        h('li', null, h('code', null, '**tučně**'), ' (Ctrl+B), ', h('code', null, '_kurzíva_'), ' (Ctrl+I), ', h('code', null, '~~škrtnuté~~'), ', ', h('code', null, '`kód`')),
        h('li', null, h('code', null, '> '), ' = citace, ', h('code', null, '---'), ' + Enter = čára, Ctrl+K = odkaz'),
        h('li', null, 'Tab / Shift+Tab odsadí položku seznamu, v tabulce skočí na další buňku'),
        h('li', null, 'Políčko se odškrtne klepnutím na čtvereček; obrázek jde vložit i ze schránky nebo přetažením')))));

  out.push(await pushCard());

  out.push(h('section', { class: 'card' },
    h('h2', null, 'Data'),
    h('p', { class: 'small secondary' }, 'Záloha všech dokumentů a složek (i z koše) v jednom souboru JSON. Obrázky v ní nejsou.'),
    h('a', { class: 'btn', href: 'server/index.php?r=/api/backup', download: '' }, icon('download', 'ic sm'), 'Stáhnout zálohu'),
    h('a', { class: 'btn', href: '#/kos', style: { marginLeft: '8px' } }, icon('trash', 'ic sm'), 'Koš')));
  return out;
}

function passwordForm() {
  const old = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const nw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 6 });
  const nw2 = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const msg = h('p', { class: 'small', role: 'status' });
  return h('details', { class: 'help' }, h('summary', null, 'Změnit heslo'),
    h('form', {
      class: 'pwform',
      onsubmit: async (e) => {
        e.preventDefault();
        msg.className = 'small bad';
        if (nw.value !== nw2.value) { msg.textContent = 'Nová hesla se neshodují.'; return; }
        try {
          await api('/api/me/password', { method: 'PUT', body: { old: old.value, new: nw.value } });
          msg.className = 'small good';
          msg.textContent = 'Heslo je změněné. Na ostatních zařízeních se bude potřeba přihlásit znovu.';
          old.value = nw.value = nw2.value = '';
        } catch (x) { msg.textContent = x.message; }
      },
    },
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Současné heslo'), old),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Nové heslo (aspoň 6 znaků)'), nw),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Nové heslo znovu'), nw2),
    msg, h('button', { type: 'submit', class: 'btn primary' }, 'Změnit heslo')));
}

async function pushCard() {
  const st = await pushState();
  const other = state.users.filter((u) => u.id !== state.me.id).map((u) => u.name).join(' nebo ') || 'druhý';
  const info = {
    on: 'Na tomto zařízení zapnuto.', off: 'Na tomto zařízení vypnuto.',
    denied: 'Prohlížeč upozornění zakázal – povol je v nastavení prohlížeče pro tuto stránku.',
    unsupported: 'Tento prohlížeč upozornění neumí.', 'ios-install': 'Na iPhonu je potřeba appku nejdřív přidat na plochu (Sdílet → Přidat na plochu).',
  }[st];
  const busy = async (fn) => { try { await fn(); } catch (e) { errorToast(e); } render(); };
  return h('section', { class: 'card' },
    h('h2', null, 'Upozornění'),
    h('p', { class: 'small secondary' }, `Přijde, když ${other} vytvoří nebo upraví dokument – pár minut po dokončení úprav, se shrnutím, co přibylo. Když máš dokument zrovna otevřený, upozornění nechodí.`),
    h('p', null, info, state.push.devices ? h('span', { class: 'small muted' }, ` (zapnuto na ${state.push.devices} ${plural(state.push.devices, 'zařízení', 'zařízeních', 'zařízeních')})`) : null),
    h('div', { class: 'actions' },
      st === 'off' ? h('button', { type: 'button', class: 'btn primary', onclick: () => busy(async () => { await enablePush(); toast('Upozornění zapnuta'); }) }, 'Zapnout upozornění') : null,
      st === 'on' ? h('button', { type: 'button', class: 'btn', onclick: () => busy(async () => { const r = await api('/api/push/test', { method: 'POST' }); toast(r.results.some((x) => x.code >= 200 && x.code < 300) ? 'Zkušební upozornění odesláno' : 'Odeslání se nepovedlo'); }) }, 'Poslat zkušební') : null,
      st === 'on' ? h('button', { type: 'button', class: 'btn', onclick: () => busy(async () => { await disablePush(); toast('Upozornění vypnuta'); }) }, 'Vypnout') : null));
}

// ---------- start ----------
async function start() {
  try {
    await loadMe();
  } catch (e) {
    if (e.status === 401) { showLogin(); return; }
    $app.replaceChildren(h('div', { class: 'banner', role: 'alert' }, `Nepodařilo se připojit: ${e.message}`,
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => start() }, 'Zkusit znovu'))));
    return;
  }
  document.body.classList.remove('logged-out');
  await loadTree().catch(() => {});
  if (!start.done) {
    start.done = true;
    onTree(() => renderSidebar($side));
    window.addEventListener('hashchange', render);
  }
  render();
  refreshPush();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  // klepnutí na upozornění, když je appka otevřená
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && e.data.url) { const u = new URL(e.data.url); if (u.hash) location.hash = u.hash; }
  });
}
start();
