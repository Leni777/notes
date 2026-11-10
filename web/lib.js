// Společné funkce: DOM, volání API, stav appky, formátování časů, oznámení, panely a nabídky.

// ---------- stav ----------
// Všechny appky na app.makuderovi.cz sdílí localStorage, proto klíče s předponou „notes:“.
export const LS = {
  get: (k, d = null) => { try { const v = localStorage.getItem('notes:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('notes:' + k, JSON.stringify(v)); } catch { /* soukromý režim nebo plno */ } },
  del: (k) => { try { localStorage.removeItem('notes:' + k); } catch { /* nic */ } },
};

export const state = {
  me: null,
  users: [],
  today: null,
  push: { key: null, devices: 0 },
  tree: { folders: [], docs: [] },
};

export const userById = (id) => state.users.find((u) => u.id === id) || null;
export const userName = (id) => userById(id)?.name || 'Někdo';
/** „upravila“ / „upravil“ podle uživatele. */
export const verb = (id, base) => base + (userById(id)?.female ? 'a' : '');
export const folderById = (id) => state.tree.folders.find((f) => f.id === id) || null;
export const docById = (id) => state.tree.docs.find((d) => d.id === id) || null;

/** Cesta ke složce od kořene: [složka, podsložka, …]. */
export function folderPath(id) {
  const out = [];
  const seen = new Set();
  for (let f = folderById(id); f && !seen.has(f.id); f = folderById(f.parent_id)) {
    seen.add(f.id);
    out.unshift(f);
  }
  return out;
}

const collator = new Intl.Collator('cs', { numeric: true, sensitivity: 'base' });
export const byName = (a, b) => collator.compare(a.name ?? a.title, b.name ?? b.title);
export const byUpdated = (a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0);

// ---------- DOM ----------
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'polyline', 'line']);
export function h(tag, attrs, ...children) {
  const el = SVG_TAGS.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), sv);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  doc: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6',
  docPlus: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 11v6M9 14h6',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7',
  pin: 'M12 17v5M9 10.8V4h6v6.8l3 3.2v2H6v-2z',
  x: 'M6 6l12 12M18 6L6 18',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 6l6 6-6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  copy: 'M9 9h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2zM5 15H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h9a1 1 0 0 1 1 1v1',
  move: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 13h6M13 10l3 3-3 3',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  restore: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  link: 'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1',
  image: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 16l5-5 4 4 3-3 6 6M15.5 8.5h.01',
  table: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
  hr: 'M3 12h18',
  quote: 'M7 7h4v5c0 3-2 5-4 5M14 7h4v5c0 3-2 5-4 5',
  ul: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  ol: 'M10 6h10M10 12h10M10 18h10M4 4h1v4M4 8h2M4 14.5a1.2 1.2 0 0 1 2 .8L4 18h2',
  task: 'M4 4h6v6H4zM5.5 7l1.2 1.2L9 5.5M4 14h6v6H4zM13 7h8M13 17h8',
  indent: 'M3 6h18M11 12h10M11 18h10M3 10l4 3-4 3',
  outdent: 'M3 6h18M11 12h10M11 18h10M7 10l-4 3 4 3',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  code: 'M8 8l-5 4 5 4M16 8l5 4-5 4',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  cloud: 'M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z',
  cloudOff: 'M3 3l18 18M8.5 8.5A5 5 0 0 0 7 18h11M21 16a4 4 0 0 0-3-6 6 6 0 0 0-8.5-3.5',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  split: 'M4 4h16v16H4zM12 4v16',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
};
export const icon = (name, cls = 'ic') => h('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: ICONS[name] }));

// ---------- časy ----------
export const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hm = (d) => `${d.getHours()}:${pad2(d.getMinutes())}`;
/** Den a měsíc (s rokem jen mimo letošek): „10. 11.“ */
export function fmtDay(iso) {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}.${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
/** „právě teď“, „před 5 min“, „před 2 h“, „včera 14:05“, „10. 11.“ */
export function ago(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 45) return 'právě teď';
  if (s < 3600) return `před ${Math.round(s / 60)} min`;
  const today = new Date();
  if (dayKey(d) === dayKey(today)) return `před ${Math.round(s / 3600)} h`;
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return `včera ${hm(d)}`;
  return fmtDay(iso);
}
/** „dnes 14:05“, „včera 9:30“, „10. 11. 14:05“ */
export function when(iso) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  const day = dayKey(d) === dayKey(today) ? 'dnes' : dayKey(d) === dayKey(y) ? 'včera' : fmtDay(iso);
  return `${day} ${hm(d)}`;
}
export const timeOnly = (iso) => hm(new Date(iso));

// ---------- API ----------
export class ApiError extends Error {
  constructor(status, msg, data = null) { super(msg); this.status = status; this.data = data; }
}
// '/api/docs?x=1' → 'server/index.php?r=/api/docs&x=1' (na WEDOS musí API běžet přes skutečný soubor)
export const apiUrl = (path) => { const [p, q] = path.split('?'); return `server/index.php?r=${encodeURIComponent(p)}${q ? '&' + q : ''}`; };
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };
export async function api(path, { method = 'GET', body, raw = null, headers = {}, keepalive = false } = {}) {
  let r;
  try {
    r = await fetch(apiUrl(path), {
      method, credentials: 'same-origin', keepalive,
      headers: raw ? headers : body !== undefined ? { 'content-type': 'application/json' } : {},
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'Bez připojení k internetu');
  }
  let data = null;
  try { data = await r.json(); } catch { /* prázdná odpověď */ }
  if (r.status === 401 && path !== '/api/login' && path !== '/api/me/password') { onUnauthorized(); throw new ApiError(401, 'Nepřihlášeno'); }
  if (!r.ok) throw new ApiError(r.status, data?.error || `Chyba ${r.status}`, data);
  return data;
}

export async function loadMe() {
  const r = await api('/api/me');
  state.me = r.user;
  state.users = r.users;
  state.today = r.today;
  state.push = r.push;
  return r;
}

const treeListeners = new Set();
export const onTree = (fn) => { treeListeners.add(fn); return () => treeListeners.delete(fn); };
export async function loadTree() {
  state.tree = await api('/api/tree');
  for (const fn of treeListeners) fn();
  return state.tree;
}
/** Změna dokumentu ve stromu bez načítání (např. přejmenování během psaní). */
export function patchDoc(doc) {
  const i = state.tree.docs.findIndex((d) => d.id === doc.id);
  if (i < 0) return;
  state.tree.docs[i] = { ...state.tree.docs[i], ...doc };
  for (const fn of treeListeners) fn();
}

// ---------- oznámení dole ----------
let toastTimer;
export function toast(msg, action = null, ms = null) {
  let t = document.getElementById('toast');
  if (!t) {
    t = h('div', { id: 'toast', role: 'status' });
    document.body.append(t);
  }
  t.replaceChildren(h('span', null, msg));
  if (action) t.append(h('button', { type: 'button', onclick: () => { t.hidden = true; action.run(); } }, action.label));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms ?? (action ? 6000 : 2800));
}
export function errorToast(e) {
  if (e?.status === 401) return;
  toast(e?.message || 'Něco se nepovedlo');
}

// ---------- panel (dialog) ----------
const $sheet = document.getElementById('sheet');
let sheetOnDismiss = null;
/** Panel s obsahem. anchor {x, y} = malá nabídka u ukazatele myši místo panelu zespodu. */
export function openSheet(content, { onDismiss = null, label = '', anchor = null } = {}) {
  sheetOnDismiss = onDismiss;
  $sheet.setAttribute('aria-label', label);
  $sheet.replaceChildren(content);
  $sheet.classList.toggle('popover', !!anchor);
  $sheet.style.left = '';
  $sheet.style.top = '';
  if (!$sheet.open) $sheet.showModal();
  if (anchor) {
    const r = $sheet.getBoundingClientRect();
    $sheet.style.left = `${Math.max(8, Math.min(anchor.x, innerWidth - r.width - 8))}px`;
    $sheet.style.top = `${Math.max(8, Math.min(anchor.y, innerHeight - r.height - 8))}px`;
  }
}
export function closeSheet() {
  const fn = sheetOnDismiss;
  sheetOnDismiss = null;
  if ($sheet.open) $sheet.close();
  return fn;
}
export const sheetOpen = () => $sheet.open;
$sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet()?.(); });
$sheet.addEventListener('click', (e) => { if (e.target === $sheet) closeSheet()?.(); });

/** Dotaz na text (název dokumentu, složky…). Vrací text, nebo null při zrušení. */
export function promptText({ title, label, value = '', ok = 'Uložit', placeholder = '' }) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value, placeholder, 'aria-label': label, autocomplete: 'off', enterkeyhint: 'done' });
    const form = h('form', {
      class: 'dlg',
      onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) { input.focus(); return; } closeSheet(); resolve(v); },
    },
    h('h2', null, title),
    h('label', { class: 'field' }, h('span', { class: 'label' }, label), input),
    h('div', { class: 'actions end' },
      h('button', { type: 'button', class: 'btn', onclick: () => { closeSheet(); resolve(null); } }, 'Zrušit'),
      h('button', { type: 'submit', class: 'btn primary' }, ok)));
    openSheet(form, { label: title, onDismiss: () => resolve(null) });
    input.focus();
    input.select();
  });
}

/** Potvrzení (smazání apod.). */
export function confirmDlg({ title, text = '', ok = 'Smazat', danger = true }) {
  return new Promise((resolve) => {
    const done = (v) => { closeSheet(); resolve(v); };
    const okBtn = h('button', { type: 'button', class: `btn ${danger ? 'danger-fill' : 'primary'}`, onclick: () => done(true) }, ok);
    openSheet(h('div', { class: 'dlg' },
      h('h2', null, title),
      text ? h('p', { class: 'secondary' }, text) : null,
      h('div', { class: 'actions end' }, h('button', { type: 'button', class: 'btn', onclick: () => done(false) }, 'Zrušit'), okBtn)),
    { label: title, onDismiss: () => resolve(false) });
    okBtn.focus();
  });
}

// ---------- nabídka (⋯, pravé tlačítko, dlouhé podržení) ----------
/** items: [{label, icon, run, danger}] nebo 'sep'. pos {x, y, touch} – na dotyk panel zespodu. */
export function openMenu(title, items, pos = null) {
  const touch = !pos || pos.touch;
  const menu = h('div', { class: `tmenu${touch ? ' touch' : ''}`, role: 'menu' },
    title ? h('div', { class: 'tm-title' }, title) : null,
    items.filter(Boolean).map((it) => (it === 'sep' ? h('hr', { class: 'tm-sep' }) : h('button', {
      type: 'button', role: 'menuitem', class: `tm-item${it.danger ? ' danger' : ''}`,
      onclick: () => { closeSheet(); it.run(); },
    }, it.icon ? icon(it.icon) : null, it.label))));
  openSheet(menu, { label: title || 'Nabídka', anchor: touch ? null : pos });
  menu.querySelector('.tm-item')?.focus();
}

const LONG_PRESS_MS = 500;
/** Dlouhé podržení prstem / pravé tlačítko / klávesa nabídky → fn({x, y, touch}). */
export function onContextMenu(el, fn) {
  let timer = null;
  let sx = 0;
  let sy = 0;
  let fired = false;
  let pointer = 'mouse';
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    pointer = e.pointerType || 'mouse';
    fired = false;
    if (pointer === 'mouse' || e.target.closest('.more')) return;
    sx = e.clientX;
    sy = e.clientY;
    cancel();
    timer = setTimeout(() => { timer = null; fired = true; navigator.vibrate?.(12); fn({ x: sx, y: sy, touch: true }); }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  el.addEventListener('pointerup', () => { cancel(); if (fired) swallowNextClick(); });
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (fired || pointer === 'touch' || pointer === 'pen') {
      if (!fired && timer) { cancel(); fired = true; fn({ x: sx, y: sy, touch: true }); }
      return;
    }
    let { clientX: x, clientY: y } = e;
    if (!x && !y) { const r = el.getBoundingClientRect(); x = r.left + 24; y = r.bottom - 4; }
    fn({ x, y, touch: false });
  });
}
function swallowNextClick() {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); window.removeEventListener('click', stop, true); };
  window.addEventListener('click', stop, true);
  setTimeout(() => window.removeEventListener('click', stop, true), 700);
}

/** Tlačítko ⋯ (nabídka položky). */
export const moreBtn = (label, fn) => h('button', {
  type: 'button', class: 'iconbtn small more', 'aria-label': label, title: label,
  onclick: (e) => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); fn({ x: r.right - 240, y: r.bottom + 4, touch: e.pointerType === 'touch' || matchMedia('(pointer: coarse)').matches }); },
}, icon('more'));

/** Avatar uživatele (kolečko s počátečním písmenem v jeho barvě). */
export const avatar = (u, extra = '') => h('span', { class: `avatar${extra ? ' ' + extra : ''}`, style: { '--u': u?.color || 'var(--muted)' }, title: u?.name || '', 'aria-hidden': 'true' }, (u?.name || '?').charAt(0));

/** Textové pole, které roste s obsahem. */
export function autoGrow(el) {
  const fit = () => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; };
  el.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return Object.assign(el, { fit });
}

/** Stažení textu jako souboru. */
export function download(name, text, type = 'text/markdown') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export const fileName = (title) => (title || 'dokument').replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 100) || 'dokument';
