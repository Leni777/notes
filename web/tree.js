// Složky a dokumenty: postranní strom (počítač, jako ve VS Code), výpis složky (telefon i počítač),
// nabídky položek, přesouvání (i přetažením myší), nové dokumenty a složky.
import {
  ago, api, avatar, byName, byUpdated, closeSheet, confirmDlg, docById, errorToast, folderById, folderPath, h, icon, loadTree, LS,
  moreBtn, onContextMenu, openMenu, openSheet, plural, promptText, state, toast, userById, userName, verb,
} from './lib.js';

// ---------- akce ----------
export async function newDoc(folderId = null) {
  try {
    const r = await api('/api/docs', { method: 'POST', body: { folder_id: folderId } });
    state.newDocId = r.doc.id;
    await loadTree();
    location.hash = `#/d/${r.doc.id}`;
  } catch (e) { errorToast(e); }
}

export async function newFolder(parentId = null) {
  const name = await promptText({ title: parentId ? `Nová složka v „${folderById(parentId)?.name}“` : 'Nová složka', label: 'Název složky', ok: 'Vytvořit', placeholder: 'např. Dovolená' });
  if (!name) return;
  try {
    const r = await api('/api/folders', { method: 'POST', body: { name, parent_id: parentId } });
    const open = new Set(LS.get('open', []));
    if (parentId) open.add(parentId);
    LS.set('open', [...open]);
    await loadTree();
    location.hash = `#/f/${r.folder.id}`;
  } catch (e) { errorToast(e); }
}

/** Složka, do které se zakládá nové (aktuální složka, nebo složka otevřeného dokumentu). */
export function targetFolder() {
  const r = state.route || {};
  if (r.name === 'f') return folderById(Number(r.arg[0])) ? Number(r.arg[0]) : null;
  if (r.name === 'd') return docById(Number(r.arg[0]))?.folder_id ?? null;
  return null;
}

async function renameDoc(d) {
  const t = await promptText({ title: 'Přejmenovat dokument', label: 'Název', value: d.title });
  if (!t || t === d.title) return;
  try { await api(`/api/docs/${d.id}`, { method: 'PUT', body: { title: t } }); await loadTree(); } catch (e) { errorToast(e); }
}

async function renameFolder(f) {
  const n = await promptText({ title: 'Přejmenovat složku', label: 'Název složky', value: f.name });
  if (!n || n === f.name) return;
  try { await api(`/api/folders/${f.id}`, { method: 'PUT', body: { name: n } }); await loadTree(); } catch (e) { errorToast(e); }
}

async function deleteDoc(d) {
  if (!await confirmDlg({ title: `Smazat „${d.title}“?`, text: 'Dokument půjde do koše, odkud ho jde obnovit.' })) return;
  try {
    await api(`/api/docs/${d.id}`, { method: 'DELETE' });
    await loadTree();
    if (state.route?.name === 'd' && Number(state.route.arg[0]) === d.id) location.hash = d.folder_id ? `#/f/${d.folder_id}` : '#/';
    toast('Přesunuto do koše', { label: 'Vrátit', run: async () => { await api(`/api/docs/${d.id}/restore`, { method: 'POST' }); await loadTree(); } });
  } catch (e) { errorToast(e); }
}

async function deleteFolder(f) {
  const n = countIn(f.id);
  if (!await confirmDlg({ title: `Smazat složku „${f.name}“?`, text: n.docs || n.folders ? `Půjde do koše i se vším, co obsahuje (${describe(n)}). Z koše jde obnovit celá.` : 'Složka půjde do koše.' })) return;
  try {
    await api(`/api/folders/${f.id}`, { method: 'DELETE' });
    await loadTree();
    if (state.route?.name === 'f' && folderPath(Number(state.route.arg[0])).length === 0) location.hash = f.parent_id ? `#/f/${f.parent_id}` : '#/';
    toast('Složka je v koši', { label: 'Vrátit', run: async () => { await api(`/api/folders/${f.id}/restore`, { method: 'POST' }); await loadTree(); } });
  } catch (e) { errorToast(e); }
}

async function setPinned(d, pinned) {
  try { await api(`/api/docs/${d.id}`, { method: 'PUT', body: { pinned } }); await loadTree(); } catch (e) { errorToast(e); }
}

async function duplicate(d) {
  try { const r = await api(`/api/docs/${d.id}/duplicate`, { method: 'POST' }); await loadTree(); toast(`Vytvořena kopie „${r.doc.title}“`); } catch (e) { errorToast(e); }
}

export function docMenu(d, pos) {
  openMenu(d.title, [
    { label: 'Otevřít', icon: 'doc', run: () => { location.hash = `#/d/${d.id}`; } },
    { label: 'Přejmenovat', icon: 'edit', run: () => renameDoc(d) },
    { label: d.pinned ? 'Odepnout' : 'Připnout nahoru', icon: 'pin', run: () => setPinned(d, !d.pinned) },
    { label: 'Přesunout do složky…', icon: 'move', run: () => moveDialog({ doc: d }) },
    { label: 'Duplikovat', icon: 'copy', run: () => duplicate(d) },
    { label: 'Historie verzí', icon: 'history', run: () => { location.hash = `#/d/${d.id}/historie`; } },
    'sep',
    { label: 'Smazat (do koše)', icon: 'trash', danger: true, run: () => deleteDoc(d) },
  ], pos);
}

export function folderMenu(f, pos) {
  openMenu(f.name, [
    { label: 'Otevřít', icon: 'folder', run: () => { location.hash = `#/f/${f.id}`; } },
    { label: 'Nový dokument zde', icon: 'docPlus', run: () => newDoc(f.id) },
    { label: 'Nová podsložka', icon: 'folderPlus', run: () => newFolder(f.id) },
    { label: 'Přejmenovat', icon: 'edit', run: () => renameFolder(f) },
    { label: 'Přesunout do…', icon: 'move', run: () => moveDialog({ folder: f }) },
    'sep',
    { label: 'Smazat (do koše)', icon: 'trash', danger: true, run: () => deleteFolder(f) },
  ], pos);
}

/** Podsložky (všech úrovní) – kam se složka přesunout nesmí. */
function descendants(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of state.tree.folders) if (f.parent_id != null && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

async function move(item, folderId) {
  try {
    if (item.doc) await api(`/api/docs/${item.doc.id}`, { method: 'PUT', body: { folder_id: folderId } });
    else await api(`/api/folders/${item.folder.id}`, { method: 'PUT', body: { parent_id: folderId } });
    if (folderId) { const open = new Set(LS.get('open', [])); open.add(folderId); LS.set('open', [...open]); }
    await loadTree();
    toast(`Přesunuto do ${folderId ? `„${folderById(folderId)?.name}“` : 'Dokumentů'}`);
  } catch (e) { errorToast(e); }
}

/** Výběr složky, kam položku přesunout. item = {doc} nebo {folder}. */
export function moveDialog(item, onDone = () => {}) {
  const cur = item.doc ? item.doc.folder_id ?? null : item.folder.parent_id ?? null;
  const banned = item.folder ? descendants(item.folder.id) : new Set();
  const pick = async (fid) => { closeSheet(); await move(item, fid); onDone(fid); };
  const row = (f, depth) => {
    const disabled = (f ? f.id : null) === cur || (f && banned.has(f.id));
    return h('li', null, h('button', {
      type: 'button', class: 'pickrow', style: { '--d': depth }, disabled, onclick: () => pick(f ? f.id : null),
    }, icon(f ? 'folder' : 'doc', 'ic'), f ? f.name : 'Dokumenty (bez složky)', (f ? f.id : null) === cur ? h('span', { class: 'small muted' }, ' – teď tady') : null));
  };
  const walk = (parent, depth) => state.tree.folders.filter((f) => f.parent_id === parent).sort(byName)
    .flatMap((f) => (banned.has(f.id) ? [row(f, depth)] : [row(f, depth), ...walk(f.id, depth + 1)]));
  openSheet(h('div', { class: 'dlg' },
    h('h2', null, `Přesunout „${item.doc ? item.doc.title : item.folder.name}“`),
    h('ul', { class: 'plain picklist' }, row(null, 0), walk(null, 1)),
    h('div', { class: 'actions end' }, h('button', { type: 'button', class: 'btn', onclick: () => closeSheet() }, 'Zrušit'))), { label: 'Přesunout' });
}

// ---------- počty, řazení ----------
function countIn(fid) {
  const ids = descendants(fid);
  return { docs: state.tree.docs.filter((d) => ids.has(d.folder_id)).length, folders: ids.size - 1 };
}
const describe = (n) => [n.docs ? `${n.docs} ${plural(n.docs, 'dokument', 'dokumenty', 'dokumentů')}` : null,
  n.folders ? `${n.folders} ${plural(n.folders, 'složka', 'složky', 'složek')}` : null].filter(Boolean).join(', ') || 'prázdná';

export const sortMode = () => (LS.get('sort', 'name') === 'updated' ? 'updated' : 'name');
const docSort = () => (sortMode() === 'updated' ? byUpdated : byName);
export const childFolders = (pid) => state.tree.folders.filter((f) => f.parent_id === pid).sort(byName);
export const childDocs = (fid) => state.tree.docs.filter((d) => d.folder_id === fid).sort(docSort());

// ---------- přetažení myší (počítač) ----------
let dragItem = null;
function draggable(el, item) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => { dragItem = item; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.doc ? item.doc.title : item.folder.name); el.classList.add('drag-src'); });
  el.addEventListener('dragend', () => { dragItem = null; el.classList.remove('drag-src'); document.querySelectorAll('.drop-over').forEach((x) => x.classList.remove('drop-over')); });
}
function dropTarget(el, folderId) {
  const ok = () => dragItem && (dragItem.doc ? dragItem.doc.folder_id !== folderId : dragItem.folder.parent_id !== folderId && !(folderId && descendants(dragItem.folder.id).has(folderId)));
  el.addEventListener('dragover', (e) => { if (ok()) { e.preventDefault(); el.classList.add('drop-over'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop-over'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop-over');
    if (!ok()) return;
    e.preventDefault();
    const item = dragItem;
    dragItem = null;
    move(item, folderId);
  });
}

// ---------- postranní strom (počítač) ----------
export function renderSidebar(side) {
  const r = state.route || {};
  const curDoc = r.name === 'd' ? Number(r.arg[0]) : null;
  const curFolder = r.name === 'f' ? Number(r.arg[0]) : null;
  const open = new Set(LS.get('open', []));
  const ctxFolder = curFolder ?? (curDoc ? docById(curDoc)?.folder_id : null);
  for (const f of folderPath(ctxFolder)) open.add(f.id);  // cesta k otevřenému dokumentu je vždy rozbalená

  const toggle = (id) => {
    const o = new Set(LS.get('open', []));
    if (o.has(id)) o.delete(id); else o.add(id);
    LS.set('open', [...o]);
    renderSidebar(side);
  };
  const docItem = (d, depth) => {
    const a = h('a', {
      class: 'trow doc', href: `#/d/${d.id}`, style: { '--d': depth }, 'aria-current': d.id === curDoc ? 'page' : null,
      title: `${d.title}\n${verb(d.updated_by, 'Upravil')} ${userName(d.updated_by)} ${ago(d.updated_at)}`,
    }, h('span', { class: 'tw' }), icon('doc', 'ic sm'), h('span', { class: 'tname' }, d.title), d.pinned ? icon('pin', 'ic sm pin') : null);
    draggable(a, { doc: d });
    onContextMenu(a, (pos) => docMenu(d, pos));
    return h('li', { role: 'treeitem' }, a);
  };
  const folderItem = (f, depth) => {
    const isOpen = open.has(f.id);
    const row = h('div', { class: 'trow folder', style: { '--d': depth }, 'aria-current': f.id === curFolder ? 'page' : null },
      h('button', { type: 'button', class: 'tw', 'aria-label': isOpen ? `Sbalit ${f.name}` : `Rozbalit ${f.name}`, 'aria-expanded': String(isOpen), onclick: () => toggle(f.id) }, icon('chevron', `ic sm chev${isOpen ? ' open' : ''}`)),
      h('a', { href: `#/f/${f.id}`, class: 'tlink', onclick: () => { if (!isOpen) { open.add(f.id); LS.set('open', [...open]); } } }, icon('folder', 'ic sm'), h('span', { class: 'tname' }, f.name)),
      h('button', { type: 'button', class: 'tadd', title: `Nový dokument v „${f.name}“`, 'aria-label': `Nový dokument v ${f.name}`, onclick: () => newDoc(f.id) }, icon('plus', 'ic sm')));
    draggable(row, { folder: f });
    dropTarget(row, f.id);
    onContextMenu(row, (pos) => folderMenu(f, pos));
    return h('li', { role: 'treeitem', 'aria-expanded': String(isOpen) }, row, isOpen ? h('ul', { class: 'tree', role: 'group' }, branch(f.id, depth + 1)) : null);
  };
  const branch = (pid, depth) => [...childFolders(pid).map((f) => folderItem(f, depth)), ...childDocs(pid).map((d) => docItem(d, depth))];

  const pinned = state.tree.docs.filter((d) => d.pinned).sort(byName);
  const rootHead = h('div', { class: 'side-label droproot' }, h('a', { href: '#/' }, 'Dokumenty'),
    h('button', {
      type: 'button', class: 'iconbtn tiny', title: sortMode() === 'name' ? 'Řazeno podle názvu – přepnout na naposledy upravené' : 'Řazeno podle úprav – přepnout na název', 'aria-label': 'Řazení',
      onclick: () => { LS.set('sort', sortMode() === 'name' ? 'updated' : 'name'); renderSidebar(side); if (state.route?.name === 'f' || !state.route?.name) window.dispatchEvent(new Event('notes:refresh')); },
    }, icon('sort', 'ic sm'), h('span', { class: 'small' }, sortMode() === 'name' ? 'A–Z' : 'nové')));
  dropTarget(rootHead, null);
  const scroll = side.querySelector('.side-scroll')?.scrollTop || 0;
  side.replaceChildren(
    h('div', { class: 'side-head' },
      h('a', { href: '#/', class: 'brand' }, h('img', { src: 'icon.svg', alt: '', width: 26, height: 26 }), 'Poznámky'),
      h('a', { class: 'iconbtn small', href: '#/hledat', title: 'Hledat (Ctrl+Shift+F)', 'aria-label': 'Hledat' }, icon('search')),
      h('a', { class: 'iconbtn small', href: '#/nastaveni', title: 'Nastavení', 'aria-label': 'Nastavení' }, icon('gear'))),
    h('div', { class: 'side-actions' },
      h('button', { type: 'button', class: 'btn small primary', onclick: () => newDoc(targetFolder()) }, icon('docPlus', 'ic sm'), 'Nový dokument'),
      h('button', { type: 'button', class: 'btn small', title: 'Nová složka', onclick: () => newFolder(targetFolder()) }, icon('folderPlus', 'ic sm'), 'Složka')),
    h('div', { class: 'side-scroll' },
      pinned.length ? [h('div', { class: 'side-label' }, 'Připnuté'), h('ul', { class: 'tree', role: 'tree', 'aria-label': 'Připnuté' }, pinned.map((d) => docItem(d, 0)))] : null,
      rootHead,
      h('ul', { class: 'tree', role: 'tree', 'aria-label': 'Dokumenty' }, branch(null, 0)),
      !state.tree.docs.length && !state.tree.folders.length ? h('p', { class: 'small muted pad' }, 'Zatím prázdno.') : null),
    h('a', { class: 'side-foot', href: '#/kos', 'aria-current': r.name === 'kos' ? 'page' : null }, icon('trash', 'ic sm'), 'Koš'));
  side.querySelector('.side-scroll').scrollTop = scroll;
}

// ---------- výpis složky ----------
export function docRow(d, { snippet = null, showFolder = false } = {}) {
  const u = userById(d.updated_by);
  const path = showFolder && d.folder_id ? folderPath(d.folder_id).map((f) => f.name).join(' › ') : null;
  const a = h('a', { class: 'item', href: `#/d/${d.id}` },
    icon('doc', 'ic item-ic'),
    h('span', { class: 'item-main' },
      h('span', { class: 'item-title' }, d.title, d.pinned ? icon('pin', 'ic sm pin') : null),
      snippet ?? (d.preview ? h('span', { class: 'item-preview' }, d.preview) : null),
      h('span', { class: 'item-meta' }, avatar(u, 'sm'), `${userName(d.updated_by)} · ${ago(d.updated_at)}`, path ? h('span', { class: 'item-path' }, ` · ${path}`) : null)),
    moreBtn(`Volby: ${d.title}`, (pos) => docMenu(d, pos)));
  onContextMenu(a, (pos) => docMenu(d, pos));
  return h('li', null, a);
}

export function folderRow(f) {
  const a = h('a', { class: 'item folder', href: `#/f/${f.id}` },
    icon('folder', 'ic item-ic'),
    h('span', { class: 'item-main' }, h('span', { class: 'item-title' }, f.name), h('span', { class: 'item-meta' }, describe(countIn(f.id)))),
    moreBtn(`Volby: ${f.name}`, (pos) => folderMenu(f, pos)));
  onContextMenu(a, (pos) => folderMenu(f, pos));
  return h('li', null, a);
}

/** Obsah složky (null = kořen): složky, pak dokumenty. */
export function folderListing(fid) {
  const folders = childFolders(fid);
  const docs = childDocs(fid);
  if (!folders.length && !docs.length) return h('p', { class: 'empty' }, fid ? 'Prázdná složka. Přidej dokument nebo podsložku.' : 'Zatím tu nic není. Vytvoř první dokument – třeba plán dovolené nebo seznam dárků.');
  return h('ul', { class: 'items' }, folders.map(folderRow), docs.map((d) => docRow(d)));
}

export function sortToggle(onChange) {
  return h('div', { class: 'seg small', role: 'group', 'aria-label': 'Řazení dokumentů' },
    ['name', 'updated'].map((m) => h('button', {
      type: 'button', 'aria-pressed': String(sortMode() === m),
      onclick: () => { LS.set('sort', m); onChange(); },
    }, m === 'name' ? 'Podle názvu' : 'Naposledy upravené')));
}
