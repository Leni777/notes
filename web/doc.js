// Stránka dokumentu: název, lišta s formátováním, přepínač Formát / Markdown, automatické ukládání,
// živé změny od druhého (sloučení, merge.js), kdo má dokument otevřený, neuložené změny bez signálu (koncept).
import {
  ago, api, avatar, closeSheet, confirmDlg, docById, download, errorToast, fileName, folderPath, h, icon, loadTree, LS,
  openMenu, openSheet, patchDoc, state, toast, userById, userName, verb,
} from './lib.js';
import { mdToHtml, safeUrl } from './md.js';
import { mergeText } from './merge.js';
import { createRich } from './rich.js';
import { createPlain } from './plain.js';
import { moveDialog } from './tree.js';

const TOOLS = [
  ['h1', 'Nadpis 1 (Ctrl+Alt+1)', 'H1'], ['h2', 'Nadpis 2 (Ctrl+Alt+2)', 'H2'], ['h3', 'Nadpis 3 (Ctrl+Alt+3)', 'H3'], '|',
  ['bold', 'Tučně (Ctrl+B)', 'B'], ['italic', 'Kurzíva (Ctrl+I)', 'I'], ['strike', 'Přeškrtnuté (Ctrl+Shift+X)', 'S'], '|',
  ['ul', 'Odrážky (Ctrl+Shift+8)', 'ul'], ['ol', 'Číslovaný seznam (Ctrl+Shift+7)', 'ol'], ['task', 'Zaškrtávací políčka (Ctrl+Shift+9)', 'task'],
  ['outdent', 'Zmenšit odsazení (Shift+Tab)', 'outdent'], ['indent', 'Odsadit (Tab)', 'indent'], '|',
  ['link', 'Odkaz (Ctrl+K)', 'link'], ['image', 'Obrázek nebo fotka', 'image'], ['table', 'Tabulka', 'table'], ['quote', 'Citace', 'quote'],
  ['code', 'Blok kódu', 'code'], ['hr', 'Vodorovná čára', 'hr'], '|',
  ['undo', 'Zpět (Ctrl+Z)', 'undo'], ['redo', 'Znovu (Ctrl+Y)', 'redo'],
];
const TABLE_TOOLS = [['row+', '+ řádek'], ['col+', '+ sloupec'], ['row-', '− řádek'], ['col-', '− sloupec'], ['table-', 'Smazat tabulku']];

/** Zmenší velkou fotku (max. 2000 px, JPEG), aby se rychle nahrála i z telefonu. */
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return file; }
  const big = Math.max(bmp.width, bmp.height);
  if (big <= 2000 && file.size <= 1.5e6) { bmp.close(); return file; }
  const k = Math.min(1, 2000 / big);
  const c = h('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  return out && out.size < file.size ? out : file;
}

export async function viewDoc(id, ctx) {
  const { doc } = await api(`/api/docs/${id}`);
  const s = {
    version: doc.version, base: doc.body, title: doc.title, folder: doc.folder_id, pinned: doc.pinned,
    updated_by: doc.updated_by, updated_at: doc.updated_at, created_by: doc.created_by, created_at: doc.created_at,
    dirty: false, saving: false, again: false, timer: null, pingTimer: null, retry: 0, lastInput: 0, firstDirty: 0,
    destroyed: false, others: doc.others || [], inTrash: doc.in_trash,
  };
  let mode = LS.get('mode', 'rich') === 'md' ? 'md' : 'rich';
  let engine = null;

  // ---------- hlavička ----------
  const backHref = s.folder ? `#/f/${s.folder}` : '#/';
  const titleInput = h('input', {
    class: 'doctitle', type: 'text', value: s.title, 'aria-label': 'Název dokumentu', maxlength: 200, autocomplete: 'off', enterkeyhint: 'next',
    oninput: () => { clearTimeout(s.titleTimer); s.titleTimer = setTimeout(saveTitle, 700); },
    onblur: () => { if (!titleInput.value.trim()) titleInput.value = 'Bez názvu'; saveTitle(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); engine.focusStart(); } },
  });
  const status = h('span', { class: 'savestate', 'aria-live': 'polite' });
  const presence = h('span', { class: 'presence' });
  const modeBtns = h('div', { class: 'modesw', role: 'group', 'aria-label': 'Režim psaní' },
    h('button', { type: 'button', 'data-mode': 'rich', title: 'Formátovaný text (jako Google Docs)', onclick: () => setMode('rich') }, 'Formát'),
    h('button', { type: 'button', 'data-mode': 'md', title: 'Markdown – čistý text se značkami (jako VS Code)', onclick: () => setMode('md') }, 'Markdown'));
  const previewBtn = h('button', {
    type: 'button', class: 'iconbtn small wide-only', title: 'Náhled vedle textu', 'aria-label': 'Náhled vedle textu',
    onclick: () => { LS.set('preview', !LS.get('preview', true)); layout(); },
  }, icon('split'));
  const menuBtn = h('button', { type: 'button', class: 'iconbtn small docmenu', 'aria-label': 'Další volby', title: 'Další volby', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); docMenu({ x: r.right - 240, y: r.bottom + 4, touch: matchMedia('(pointer: coarse)').matches }); } }, icon('more'));
  const meta = h('div', { class: 'docmeta small secondary' });
  const banner = h('div', { class: 'banner warn', hidden: true, role: 'alert' });
  const toolbar = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formátování' });
  const tableTools = h('div', { class: 'tabletools', hidden: true, role: 'toolbar', 'aria-label': 'Tabulka' });
  const preview = h('div', { class: 'prose preview', 'aria-label': 'Náhled' });
  const wrap = h('div', { class: 'editorwrap' });
  const picker = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: () => { uploadImages([...picker.files]); picker.value = ''; } });

  const printTitle = h('h1', { class: 'print-title' }, s.title);
  const page = h('div', { class: 'docpage' }, printTitle,
    h('header', { class: 'dochead' },
      h('a', { class: 'iconbtn small back', href: backHref, 'aria-label': 'Zpět na složku', title: 'Zpět' }, icon('back')),
      titleInput, presence, status, modeBtns, previewBtn, menuBtn),
    meta, banner, toolbar, tableTools, wrap, picker);

  // ---------- lišta ----------
  const keep = (e) => e.preventDefault();  // tlačítko nesmí vzít editoru kurzor
  for (const t of TOOLS) {
    if (t === '|') { toolbar.append(h('span', { class: 'tsep', 'aria-hidden': 'true' })); continue; }
    const [name, label, glyph] = t;
    const content = /^(H\d|B|I|S)$/.test(glyph) ? h('span', { class: `glyph g-${name}` }, glyph) : icon(glyph);
    toolbar.append(h('button', { type: 'button', class: 'tbtn', 'data-cmd': name, title: label, 'aria-label': label, onmousedown: keep, onclick: () => tool(name) }, content));
  }
  for (const [name, label] of TABLE_TOOLS) {
    tableTools.append(h('button', { type: 'button', class: `btn small${name === 'table-' ? ' danger' : ''}`, onmousedown: keep, onclick: () => tool(name) }, label));
  }
  function tool(name) {
    if (name === 'link') { linkDialog(); return; }
    if (name === 'image') { picker.click(); return; }
    engine.cmd(name);
  }
  function updateToolbar() {
    const st = engine.state();
    for (const b of toolbar.querySelectorAll('[data-cmd]')) {
      const k = b.dataset.cmd;
      if (k in st) b.setAttribute('aria-pressed', String(!!st[k])); else b.removeAttribute('aria-pressed');
    }
    tableTools.hidden = !st.inTable;
  }

  // ---------- editor ----------
  function makeEngine(m) {
    const opts = { onInput, onState: updateToolbar, onImageFiles: uploadImages, onLink: linkDialog };
    return m === 'md' ? createPlain(opts) : createRich(opts);
  }
  function layout() {
    for (const b of modeBtns.children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    const split = mode === 'md' && LS.get('preview', true);
    previewBtn.hidden = mode !== 'md';
    previewBtn.setAttribute('aria-pressed', String(split));
    wrap.classList.toggle('split', split);
    wrap.replaceChildren(engine.el, ...(split ? [preview] : []));
    document.body.classList.toggle('wide', split);
    page.dataset.mode = mode;
    renderPreview();
    updateToolbar();
  }
  function setMode(m) {
    if (m === mode) return;
    const md = engine.getMd();
    engine.destroy();
    mode = m;
    LS.set('mode', m);
    engine = makeEngine(m);
    engine.setMd(md);
    layout();
    if (s.inTrash) showTrash(true); else engine.focus();
  }
  let previewTimer = null;
  function renderPreview() {
    if (mode !== 'md' || !wrap.classList.contains('split')) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { preview.innerHTML = mdToHtml(engine.getMd()); }, 120);
  }

  // ---------- ukládání ----------
  const local = () => engine.getMd();
  function setStatus(kind, text = null) {
    const map = { saved: ['check', 'Uloženo'], saving: ['cloud', 'Ukládám…'], pending: ['cloud', 'Upravuje se…'], offline: ['cloudOff', 'Bez připojení – uložím později'], error: ['cloudOff', 'Neuloženo'] };
    const [ic, t] = map[kind];
    status.className = `savestate ${kind}`;
    status.replaceChildren(icon(ic, 'ic sm'), h('span', { class: 'st-text' }, text || t));
    status.title = text || t;
  }
  function saveDraft() {
    LS.set(`draft:${id}`, { v: s.version, base: s.base, body: local(), at: Date.now() });
  }
  function onInput() {
    if (s.destroyed || s.inTrash) return;
    s.lastInput = Date.now();
    if (!s.dirty) s.firstDirty = Date.now();
    s.dirty = true;
    setStatus('pending');
    renderPreview();
    clearTimeout(s.draftTimer);
    s.draftTimer = setTimeout(saveDraft, 300);
    schedule(Date.now() - s.firstDirty > 5000 ? 0 : 900);
  }
  function schedule(ms) {
    clearTimeout(s.timer);
    s.timer = setTimeout(save, ms);
  }
  async function save() {
    clearTimeout(s.timer);
    if (s.destroyed && !s.dirty) return;
    if (s.saving) { s.again = true; return; }
    const body = local();
    if (body === s.base) {
      s.dirty = false;
      LS.del(`draft:${id}`);
      setStatus('saved');
      return;
    }
    s.saving = true;
    setStatus('saving');
    try {
      const r = await api(`/api/docs/${id}`, { method: 'PUT', body: { body, base_version: s.version }, keepalive: document.hidden && body.length < 60000 });
      s.version = r.doc.version;
      s.base = body;
      s.retry = 0;
      Object.assign(s, { updated_by: r.doc.updated_by, updated_at: r.doc.updated_at });
      patchDoc(r.doc);
      renderMeta();
      if (local() === body) {
        s.dirty = false;
        LS.del(`draft:${id}`);
        setStatus('saved');
      } else {
        s.again = true;
      }
    } catch (e) {
      if (e.status === 409 && e.data?.doc) {
        applyRemote(e.data.doc);
        s.again = true;
      } else if (e.status === 404) {
        setStatus('error', 'Dokument už neexistuje');
        showTrash(true);
      } else if (e.status === 401) {
        setStatus('error');
      } else {
        setStatus(e.status === 0 ? 'offline' : 'error', e.status === 0 ? null : `Neuloženo: ${e.message}`);
        s.retry++;
        if (!s.destroyed) s.timer = setTimeout(save, Math.min(30000, 2000 * 2 ** Math.min(s.retry, 4)));
      }
    } finally {
      s.saving = false;
      if (s.again && !s.destroyed) { s.again = false; schedule(0); }
    }
  }

  /** Změna od někoho jiného: bez vlastních úprav ji jen převzít, jinak sloučit s mými. */
  function applyRemote(d) {
    const theirs = d.body;
    if (!s.dirty && !s.saving) {
      if (theirs !== local()) engine.setMd(theirs, { keepCaret: true });
      s.base = theirs;
    } else {
      const mine = local();
      const m = mergeText(s.base, mine, theirs);
      s.base = theirs;
      if (m.text !== mine) engine.setMd(m.text, { keepCaret: true });
      if (m.conflicts) toast(`${userName(d.updated_by)} mezitím ${verb(d.updated_by, 'změnil')} stejné místo – nechal jsem obě verze, zkontroluj to.`, null, 9000);
      s.dirty = m.text !== theirs;
      if (s.dirty) saveDraft();
    }
    s.version = d.version;
    Object.assign(s, { updated_by: d.updated_by, updated_at: d.updated_at });
    if (d.title !== s.title && document.activeElement !== titleInput) { s.title = d.title; titleInput.value = d.title; }
    renderPreview();
    renderMeta();
  }

  async function saveTitle() {
    clearTimeout(s.titleTimer);
    const t = titleInput.value.trim();
    if (!t || t === s.title) return;
    s.title = t;
    try {
      const r = await api(`/api/docs/${id}`, { method: 'PUT', body: { title: t } });
      patchDoc(r.doc);
      printTitle.textContent = t;
      document.title = `${t} – Poznámky`;
    } catch (e) { errorToast(e); }
  }

  // ---------- přítomnost a změny od druhého ----------
  async function ping() {
    clearTimeout(s.pingTimer);
    if (s.destroyed) return;
    if (!document.hidden) {
      try {
        const r = await api(`/api/docs/${id}/ping`, { method: 'POST', body: { editing: Date.now() - s.lastInput < 15000 } });
        s.others = r.doc.others;
        renderPresence();
        if (r.doc.title !== s.title && document.activeElement !== titleInput) { s.title = r.doc.title; titleInput.value = r.doc.title; patchDoc(r.doc); }
        if (r.doc.in_trash !== s.inTrash) showTrash(r.doc.in_trash);
        if (r.doc.version > s.version && !s.saving) {
          const { doc: fresh } = await api(`/api/docs/${id}`);
          if (fresh.version > s.version && !s.saving && !s.destroyed) applyRemote(fresh);
        }
      } catch { /* bez připojení – zkusí se znovu */ }
    }
    if (!s.destroyed) s.pingTimer = setTimeout(ping, s.others.length ? 2500 : 8000);
  }
  function renderPresence() {
    presence.replaceChildren(...s.others.map((o) => {
      const u = userById(o.user_id);
      return h('span', { class: `pres${o.editing ? ' typing' : ''}`, title: `${u?.name || 'Někdo'} ${o.editing ? 'právě píše' : 'má dokument otevřený'}` },
        avatar(u), h('span', { class: 'pres-text' }, o.editing ? 'píše…' : 'je tu'));
    }));
  }
  function renderMeta() {
    const path = s.folder ? folderPath(s.folder) : [];
    const sep = () => h('span', { class: 'msep', 'aria-hidden': 'true' }, '·');
    meta.replaceChildren(
      h('span', { class: 'crumbs' }, h('a', { href: '#/' }, 'Dokumenty'), path.map((f) => [' › ', h('a', { href: `#/f/${f.id}` }, f.name)])),
      sep(),
      h('span', { title: `Vytvořil(a) ${userName(s.created_by)} ${new Date(s.created_at).toLocaleString('cs-CZ')}` },
        `${verb(s.updated_by, 'upravil')} ${userName(s.updated_by)} ${ago(s.updated_at)}`),
      ...(s.pinned ? [sep(), h('span', { class: 'pinmark', title: 'Připnuto' }, icon('pin', 'ic sm'), 'připnuto')] : []));
  }
  function showTrash(on) {
    s.inTrash = on;
    banner.hidden = !on;
    if (engine.kind === 'md') engine.el.readOnly = on; else engine.el.contentEditable = on ? 'false' : 'true';
    toolbar.classList.toggle('disabled', on);
    if (on) {
      banner.replaceChildren(h('span', null, 'Dokument je v koši – upravit ho jde až po obnovení.'),
        h('button', { type: 'button', class: 'btn small', onclick: async () => { try { await api(`/api/docs/${id}/restore`, { method: 'POST' }); await loadTree(); showTrash(false); toast('Obnoveno'); } catch (e) { errorToast(e); } } }, 'Obnovit'));
    }
  }

  // ---------- obrázky a odkazy ----------
  async function uploadImages(files) {
    for (const f of files) {
      setStatus('saving', 'Nahrávám obrázek…');
      try {
        const blob = await shrink(f);
        const name = (f.name || '').replace(/\.[^.]+$/, '');
        const alt = /^(image|img|screenshot|snímek|photo)[\s_-]*\d*$/i.test(name) || !name ? '' : name;
        const r = await api(`/api/images?doc=${id}&name=${encodeURIComponent(name)}`, { method: 'POST', raw: blob, headers: { 'content-type': blob.type || 'application/octet-stream' } });
        engine.insertImage(r.src, alt);
      } catch (e) { errorToast(e); setStatus('error', 'Obrázek se nenahrál'); }
    }
  }

  function linkDialog() {
    const info = engine.linkInfo();
    const url = h('input', { type: 'text', value: info.href, placeholder: 'https://… nebo název dokumentu', inputmode: 'url', autocomplete: 'off', 'aria-label': 'Adresa nebo dokument' });
    const text = h('input', { type: 'text', value: info.text, 'aria-label': 'Text odkazu' });
    const err = h('p', { class: 'small bad', role: 'alert' });
    const sugg = h('ul', { class: 'plain sugg' });
    const fill = () => {
      const q = url.value.trim().toLowerCase();
      const docs = q && !/^(https?:|www\.|#\/|mailto:|tel:)/i.test(q)
        ? state.tree.docs.filter((d) => d.id !== id && d.title.toLowerCase().includes(q)).slice(0, 6) : [];
      sugg.replaceChildren(...docs.map((d) => h('li', null, h('button', {
        type: 'button', class: 'suggbtn', onclick: () => { url.value = `#/d/${d.id}`; if (!text.value.trim()) text.value = d.title; sugg.replaceChildren(); text.focus(); },
      }, icon('doc', 'ic sm'), d.title))));
    };
    url.addEventListener('input', fill);
    const form = h('form', {
      class: 'dlg',
      onsubmit: (e) => {
        e.preventDefault();
        let href = url.value.trim();
        if (href && !/^(https?:|mailto:|tel:|#\/)/i.test(href)) href = /^[^\s/]+\.[a-z]{2,}([/?#].*)?$/i.test(href) ? `https://${href}` : href;
        if (href && !safeUrl(href)) { err.textContent = 'Tohle není webová adresa ani dokument.'; return; }
        closeSheet();
        engine.setLink(safeUrl(href) || '', text.value.trim());
        engine.focus();
      },
    },
    h('h2', null, info.existing ? 'Upravit odkaz' : 'Vložit odkaz'),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Adresa (nebo začni psát název dokumentu)'), url), sugg,
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Text'), text), err,
    h('div', { class: 'actions end' },
      info.existing ? h('button', { type: 'button', class: 'btn danger', onclick: () => { closeSheet(); engine.setLink('', ''); } }, 'Odebrat odkaz') : null,
      h('button', { type: 'button', class: 'btn', onclick: () => { closeSheet(); engine.focus(); } }, 'Zrušit'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Uložit')));
    openSheet(form, { label: 'Odkaz', onDismiss: () => engine.focus() });
    url.focus();
  }

  // ---------- nabídka dokumentu ----------
  function docMenu(pos) {
    openMenu(s.title, [
      { label: s.pinned ? 'Odepnout' : 'Připnout nahoru', icon: 'pin', run: async () => {
        try { const r = await api(`/api/docs/${id}`, { method: 'PUT', body: { pinned: !s.pinned } }); s.pinned = r.doc.pinned; patchDoc(r.doc); renderMeta(); } catch (e) { errorToast(e); }
      } },
      { label: 'Přesunout do složky…', icon: 'move', run: () => moveDialog({ doc: docById(id) || { id, title: s.title, folder_id: s.folder } }, (fid) => { s.folder = fid; renderMeta(); }) },
      { label: 'Duplikovat', icon: 'copy', run: async () => {
        await save();
        try { const r = await api(`/api/docs/${id}/duplicate`, { method: 'POST' }); await loadTree(); location.hash = `#/d/${r.doc.id}`; toast('Vytvořena kopie'); } catch (e) { errorToast(e); }
      } },
      { label: 'Historie verzí', icon: 'history', run: async () => { await save(); location.hash = `#/d/${id}/historie`; } },
      { label: 'Stáhnout jako Markdown (.md)', icon: 'download', run: () => download(`${fileName(s.title)}.md`, `# ${s.title}\n\n${local()}\n`) },
      { label: 'Vytisknout', icon: 'doc', run: () => window.print() },
      'sep',
      { label: 'Smazat (do koše)', icon: 'trash', danger: true, run: async () => {
        if (!await confirmDlg({ title: `Smazat „${s.title}“?`, text: 'Dokument půjde do koše, odkud ho jde obnovit.' })) return;
        await save();
        try {
          await api(`/api/docs/${id}`, { method: 'DELETE' });
          s.dirty = false;
          await loadTree();
          location.hash = s.folder ? `#/f/${s.folder}` : '#/';
          toast('Přesunuto do koše', { label: 'Vrátit', run: async () => { await api(`/api/docs/${id}/restore`, { method: 'POST' }); await loadTree(); location.hash = `#/d/${id}`; } });
        } catch (e) { errorToast(e); }
      } },
    ], pos);
  }

  // ---------- start ----------
  engine = makeEngine(mode);
  let initial = doc.body;
  const draft = LS.get(`draft:${id}`);
  if (draft && typeof draft.body === 'string' && draft.body !== draft.base) {
    initial = draft.v === doc.version ? draft.body : mergeText(draft.base, draft.body, doc.body).text;
    if (initial !== doc.body) toast('Obnoveny neuložené změny z minula');
  } else if (draft) {
    LS.del(`draft:${id}`);
  }
  engine.setMd(initial);
  layout();
  renderMeta();
  renderPresence();
  setStatus('saved');
  if (s.inTrash) showTrash(true);
  if (initial !== doc.body) { s.dirty = true; s.firstDirty = Date.now(); schedule(300); }
  document.title = `${s.title} – Poznámky`;
  s.pingTimer = setTimeout(ping, 1500);

  const onVis = () => {
    if (document.hidden) { if (s.dirty) save(); } else { ping(); }
  };
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
  document.addEventListener('visibilitychange', onVis);
  document.addEventListener('keydown', onKey);
  window.addEventListener('online', ping);

  ctx.onLeave(() => {
    s.destroyed = true;
    clearTimeout(s.pingTimer);
    clearTimeout(previewTimer);
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('online', ping);
    document.body.classList.remove('wide');
    if (titleInput.value.trim() && titleInput.value.trim() !== s.title) saveTitle();
    if (s.dirty) save();
    api(`/api/docs/${id}/leave`, { method: 'POST', keepalive: true }).catch(() => {});
    engine.destroy();
  });
  ctx.onMount(() => { if (ctx.isNew) { titleInput.focus(); titleInput.select(); } });
  return page;
}
