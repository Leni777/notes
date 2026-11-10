// Formátovaný režim (jako Google Docs): upravitelné HTML z md.js. Při ukládání se převádí zpátky na Markdown.
// Zkratky při psaní: „# “ nadpis, „- “ odrážka, „1. “ číslovaný seznam, „[] “ políčko, „> “ citace, „---“ + Enter čára,
// **tučně**, _kurzíva_, ~~škrtnuté~~, `kód`. Klávesy: Ctrl+B/I, Ctrl+K odkaz, Ctrl+Alt+1–3 nadpisy, Tab odsazení / další buňka.
import { htmlToMd, imgSrc, mdToHtml } from './md.js';
import { h, icon } from './lib.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BLOCK_RE = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TD|TH)$/;

export function createRich({ onInput, onState = () => {}, onImageFiles = () => {}, onLink = () => {} }) {
  const el = h('div', {
    class: 'prose rich', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true',
    'aria-label': 'Text dokumentu', translate: 'no', autocapitalize: 'sentences',
  });
  const bubble = h('div', { class: 'linkbubble', hidden: true });
  document.body.append(bubble);
  let savedRange = null;

  const sel = () => window.getSelection();
  const range = () => { const s = sel(); return s.rangeCount && el.contains(s.getRangeAt(0).startContainer) ? s.getRangeAt(0) : null; };
  const exec = (cmd, val = null) => document.execCommand(cmd, false, val);
  const setCaret = (node, off) => { const r = document.createRange(); r.setStart(node, off); r.collapse(true); sel().removeAllRanges(); sel().addRange(r); };
  const closest = (selector) => {
    const r = range();
    if (!r) return null;
    let n = r.startContainer;
    if (n.nodeType === 3) n = n.parentNode;
    const x = n.closest?.(selector);
    return x && el.contains(x) ? x : null;
  };
  const blockOf = (node) => {
    for (let n = node; n && n !== el; n = n.parentNode) if (n.nodeType === 1 && BLOCK_RE.test(n.tagName)) return n;
    return null;
  };
  const topBlock = (n) => { while (n && n.parentNode !== el) n = n.parentNode; return n; };
  const textBefore = (block, r) => {
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(r.startContainer, r.startOffset);
    return { text: pre.toString(), img: !!pre.cloneContents().querySelector?.('img') };
  };
  const atStart = (block, r) => { const t = textBefore(block, r); return t.text === '' && !t.img; };

  function ensureStructure() {
    if (!el.firstElementChild && !el.textContent) el.innerHTML = '<p><br></p>';
    const last = el.lastElementChild;
    if (!last || !/^(P|DIV|H[1-6])$/.test(last.tagName)) el.append(h('p', null, h('br')));  // za tabulkou / seznamem jde psát dál
  }

  // ---------- obsah ----------
  function setMd(md, { keepCaret = false } = {}) {
    const caret = keepCaret && document.activeElement === el ? saveCaret() : null;
    el.innerHTML = mdToHtml(md);
    ensureStructure();
    if (caret) restoreCaret(caret);
  }
  const getMd = () => htmlToMd(el);

  /** Pozice kurzoru jako počet znaků od začátku + kousek textu před ním (po změně obsahu se podle něj najde). */
  function saveCaret() {
    const r = range();
    if (!r) return null;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(r.startContainer, r.startOffset);
    const before = pre.toString();
    return { offset: before.length, ctx: before.slice(-30) };
  }
  function restoreCaret(c) {
    const full = el.textContent;
    let pos = Math.min(c.offset, full.length);
    if (c.ctx) {
      let best = -1;
      let bestD = Infinity;
      for (let i = full.indexOf(c.ctx); i >= 0; i = full.indexOf(c.ctx, i + 1)) {
        const d = Math.abs(i + c.ctx.length - c.offset);
        if (d < bestD) { bestD = d; best = i + c.ctx.length; }
      }
      if (best >= 0) pos = best;
    }
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let acc = 0;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (acc + n.data.length >= pos) { setCaret(n, pos - acc); return; }
      acc += n.data.length;
    }
    const r = document.createRange();
    r.selectNodeContents(el.lastElementChild || el);
    r.collapse(false);
    sel().removeAllRanges();
    sel().addRange(r);
  }

  function restoreSel() {
    if (range()) return;
    el.focus({ preventScroll: true });
    if (savedRange && el.contains(savedRange.startContainer)) { sel().removeAllRanges(); sel().addRange(savedRange); }
  }

  const remember = () => { const r = range(); if (r) savedRange = r.cloneRange(); };
  function changed() {
    cleanup();
    remember();  // selectionchange chodí opožděně – polohu kurzoru si pamatovat hned
    onInput();
    onState();
  }

  /**
   * Úklid po prohlížeči: Chrome občas vloží seznam do odstavce (<p><ul>…) a k formátování přidává styly
   * (font-size, font-weight u spojených nadpisů). Formát se v appce určuje jen značkami (b, i, h2…), takže styly pryč.
   */
  function cleanup() {
    el.querySelectorAll('[data-task]:not(li)').forEach((x) => x.removeAttribute('data-task'));
    if (!el.firstChild) { el.innerHTML = '<p><br></p>'; setCaret(el.firstChild, 0); return; }
    const nested = el.querySelectorAll(':is(p, h1, h2, h3, h4, h5, h6) > :is(ul, ol, p, div, h1, h2, h3, h4, h5, h6, table, blockquote, pre, hr)');
    const styled = el.querySelectorAll('[style]:not(th, td), span, font');
    if (!nested.length && !styled.length) return;
    // kurzor si označit přímo v textu (podle počtu znaků by se v prázdném řádku ztratil)
    const r0 = document.activeElement === el ? range() : null;
    const mark = r0 ? document.createElement('i-caret') : null;
    if (mark) { r0.collapse(true); r0.insertNode(mark); }
    for (const blk of nested) {
      const p = blk.parentElement;
      if (!p || !p.parentNode) continue;
      const parts = [];
      let cur = null;
      for (const n of [...p.childNodes]) {
        if (n.nodeType === 1 && /^(UL|OL|P|DIV|H[1-6]|TABLE|BLOCKQUOTE|PRE|HR)$/.test(n.tagName)) { cur = null; parts.push(n); } else {
          if (!cur) { cur = document.createElement(p.tagName); parts.push(cur); }
          cur.append(n);
        }
      }
      p.replaceWith(...parts.filter((x) => !(x.tagName === p.tagName && x !== blk && !x.textContent.replace(/\u200b/g, '').trim() && !x.querySelector('img, i-caret'))));
    }
    for (const x of el.querySelectorAll('[style]:not(th, td)')) x.removeAttribute('style');
    for (const x of el.querySelectorAll('span, font')) x.replaceWith(...x.childNodes);
    if (mark?.isConnected) {
      const r = document.createRange();
      r.setStartBefore(mark);
      r.collapse(true);
      sel().removeAllRanges();
      sel().addRange(r);
      mark.remove();
    } else mark?.remove();
    el.normalize();
  }

  // ---------- příkazy z lišty ----------
  function selectedLis() {
    const r = range();
    if (!r) return [];
    if (r.collapsed) { const li = closest('li'); return li ? [li] : []; }
    const all = [...el.querySelectorAll('li')].filter((li) => r.intersectsNode(li));
    return all.filter((li) => !all.some((o) => o !== li && li.contains(o)));
  }

  function toggleQuote() {
    const bq = closest('blockquote');
    if (bq) { unwrap(bq); return; }
    const r = range();
    const b = r && topBlock(r.startContainer);
    if (!b || b === el) return;
    const quote = h('blockquote');
    b.replaceWith(quote);
    quote.append(b.nodeType === 1 && /^(P|H[1-6]|UL|OL|PRE)$/.test(b.tagName) ? b : h('p', null, b));
    setCaret(r.startContainer, Math.min(r.startOffset, r.startContainer.length ?? r.startContainer.childNodes.length));
  }
  function unwrap(node) {
    const r = range();
    const kids = [...node.childNodes];
    node.replaceWith(...kids);
    if (r) setCaret(r.startContainer, r.startOffset);
  }

  function insertTable() {
    const r = range();
    const b = r ? topBlock(r.startContainer) : null;
    const t = h('table');
    t.innerHTML = `<thead><tr>${'<th><br></th>'.repeat(3)}</tr></thead><tbody>${`<tr>${'<td><br></td>'.repeat(3)}</tr>`.repeat(2)}</tbody>`;
    const after = h('p', null, h('br'));
    if (b && b !== el && b.tagName === 'P' && !b.textContent.trim() && !b.querySelector('img')) b.replaceWith(t, after);
    else if (b && b !== el) b.after(t, after);
    else el.append(t, after);
    setCaret(t.querySelector('th'), 0);
  }

  function tableOp(op) {
    const c = closest('td,th');
    if (!c) return;
    const tr = c.parentElement;
    const table = c.closest('table');
    const idx = c.cellIndex;
    const removeTable = () => { const p = h('p', null, h('br')); table.replaceWith(p); setCaret(p, 0); };
    if (op === 'row+') {
      const nr = h('tr');
      for (let k = 0; k < tr.cells.length; k++) nr.append(h('td', null, h('br')));
      if (tr.parentElement.tagName === 'THEAD') (table.tBodies[0] || table.createTBody()).prepend(nr); else tr.after(nr);
      setCaret(nr.cells[idx], 0);
    } else if (op === 'col+') {
      for (const row of table.rows) {
        const n = h(row.parentElement.tagName === 'THEAD' ? 'th' : 'td', null, h('br'));
        const ref = row.cells[idx];
        if (ref) ref.after(n); else row.append(n);
      }
      setCaret(tr.cells[idx + 1], 0);
    } else if (op === 'row-') {
      if (tr.parentElement.tagName === 'THEAD') {  // hlavička: první řádek těla se stane hlavičkou
        const first = table.tBodies[0]?.rows[0];
        if (!first) { removeTable(); return; }
        const nr = h('tr');
        for (const cell of [...first.cells]) { const th = h('th'); th.append(...cell.childNodes); nr.append(th); }
        first.remove();
        tr.replaceWith(nr);
        setCaret(nr.cells[Math.min(idx, nr.cells.length - 1)], 0);
      } else {
        const next = tr.nextElementSibling || tr.previousElementSibling || table.tHead?.rows[0];
        tr.remove();
        if (next) setCaret(next.cells[Math.min(idx, next.cells.length - 1)], 0);
      }
    } else if (op === 'col-') {
      if (tr.cells.length <= 1) { removeTable(); return; }
      for (const row of table.rows) row.cells[idx]?.remove();
      setCaret(tr.cells[Math.max(0, idx - 1)], 0);
    } else if (op === 'table-') {
      removeTable();
    }
  }

  function moveCell(cell, dir) {
    const cells = [...cell.closest('table').querySelectorAll('th,td')];
    let i = cells.indexOf(cell) + dir;
    if (i >= cells.length) { tableOp('row+'); return; }
    i = Math.max(0, i);
    const target = cells[i];
    const r = document.createRange();
    r.selectNodeContents(target);
    sel().removeAllRanges();
    sel().addRange(r);
  }

  function cmd(name) {
    restoreSel();
    exec('styleWithCSS', false);
    exec('defaultParagraphSeparator', 'p');
    switch (name) {
      case 'h1': case 'h2': case 'h3':
        exec('formatBlock', closest(name) ? '<p>' : `<${name}>`);
        break;
      case 'p': exec('formatBlock', '<p>'); break;
      case 'bold': exec('bold'); break;
      case 'italic': exec('italic'); break;
      case 'strike': exec('strikeThrough'); break;
      case 'ul': {
        const li = closest('li');
        if (li && li.parentElement.tagName === 'UL' && li.dataset.task != null) { selectedLis().forEach((x) => delete x.dataset.task); break; }
        exec('insertUnorderedList');
        break;
      }
      case 'ol': exec('insertOrderedList'); break;
      case 'task': {
        let lis = selectedLis();
        if (lis.length && lis.every((x) => x.dataset.task != null)) { lis.forEach((x) => delete x.dataset.task); break; }
        if (!lis.length) { exec('insertUnorderedList'); lis = selectedLis(); }
        lis.forEach((x) => { if (x.dataset.task == null) x.dataset.task = '0'; });
        break;
      }
      case 'indent': if (closest('li')) exec('indent'); break;
      case 'outdent': if (closest('li')) exec('outdent'); break;
      case 'quote': toggleQuote(); break;
      case 'code': exec('formatBlock', closest('pre') ? '<p>' : '<pre>'); break;
      case 'hr': exec('insertHorizontalRule'); ensureStructure(); break;
      case 'table': insertTable(); break;
      case 'row+': case 'col+': case 'row-': case 'col-': case 'table-': tableOp(name); break;
      case 'undo': exec('undo'); break;
      case 'redo': exec('redo'); break;
      default: break;
    }
    changed();
  }

  function stateNow() {
    if (!range()) return {};
    const li = closest('li');
    const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
    return {
      h1: !!closest('h1'), h2: !!closest('h2'), h3: !!closest('h3'),
      bold: q('bold'), italic: q('italic'), strike: q('strikeThrough'),
      ul: !!li && li.parentElement.tagName === 'UL' && li.dataset.task == null, ol: !!li && li.parentElement.tagName === 'OL',
      task: !!li && li.dataset.task != null, quote: !!closest('blockquote'), code: !!closest('pre'),
      link: !!closest('a'), inList: !!li, inTable: !!closest('td,th'),
    };
  }

  // ---------- odkazy a obrázky ----------
  function linkInfo() {
    restoreSel();
    remember();
    const a = closest('a');
    const r = range();
    return { href: a?.getAttribute('href') || '', text: a ? a.textContent : r ? r.toString() : '', existing: !!a };
  }
  function setLink(href, text) {
    restoreSel();
    const a = closest('a');
    if (a) {
      if (!href) {
        const r = document.createRange();
        r.selectNodeContents(a);
        sel().removeAllRanges();
        sel().addRange(r);
        exec('unlink');
      } else {
        a.setAttribute('href', href);
        if (text && text !== a.textContent) a.textContent = text;
      }
    } else if (href) {
      const r = range();
      if (r && !r.collapsed && !text) exec('createLink', href);
      else exec('insertHTML', `<a href="${esc(href)}">${esc(text || href)}</a>​`);
    }
    changed();
  }
  function insertImage(src, alt = '') {
    restoreSel();
    exec('insertHTML', `<img src="${esc(imgSrc(src))}" data-src="${esc(src)}" alt="${esc(alt)}">`);
    changed();
  }

  const shortUrl = (u) => (u.startsWith('#/') ? 'Odkaz na dokument' : u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 40));
  function updateBubble() {
    const r = range();
    const a = r && r.collapsed && document.activeElement === el ? closest('a') : null;
    if (!a) { bubble.hidden = true; return; }
    const href = a.getAttribute('href') || '';
    const keep = (e) => e.preventDefault();
    bubble.replaceChildren(
      h('a', { href, class: 'lb-url', target: href.startsWith('#') ? null : '_blank', rel: 'noopener', onmousedown: keep }, icon('open', 'ic sm'), shortUrl(href)),
      h('button', { type: 'button', class: 'btn small', onmousedown: keep, onclick: () => onLink() }, 'Upravit'),
      h('button', { type: 'button', class: 'btn small', onmousedown: keep, onclick: () => setLink('', '') }, 'Odebrat'));
    bubble.hidden = false;
    const rc = a.getBoundingClientRect();
    bubble.style.left = `${Math.max(8, Math.min(rc.left, innerWidth - bubble.offsetWidth - 8))}px`;
    bubble.style.top = `${rc.bottom + 6}px`;
  }

  // ---------- zkratky při psaní ----------
  function blockShortcut() {
    const r = range();
    if (!r || !r.collapsed) return;
    const b = blockOf(r.startContainer);
    if (!b) return;
    const t = textBefore(b, r).text.replace(/ /g, ' ');
    const del = () => { for (let k = 0; k < t.length; k++) sel().modify('extend', 'backward', 'character'); exec('delete'); };
    let m;
    if (b.tagName === 'LI') {
      if (b.dataset.task == null && (m = /^\[([ xX]?)\] $/.exec(t))) { del(); b.dataset.task = m[1].toLowerCase() === 'x' ? '1' : '0'; }
      return;
    }
    if (!/^(P|DIV)$/.test(b.tagName) || b.closest('td,th,pre')) return;
    if ((m = /^(#{1,3}) $/.exec(t))) { del(); exec('formatBlock', `<h${m[1].length}>`); } else if (/^[-*+] $/.test(t)) { del(); exec('insertUnorderedList'); } else if ((m = /^(\d{1,4})[.)] $/.exec(t))) {
      del();
      exec('insertOrderedList');
      if (+m[1] !== 1) closest('ol')?.setAttribute('start', m[1]);
    } else if ((m = /^\[([ xX]?)\] $/.exec(t))) {
      del();
      exec('insertUnorderedList');
      const li = closest('li');
      if (li) li.dataset.task = m[1].toLowerCase() === 'x' ? '1' : '0';
    } else if (/^> $/.test(t)) { del(); toggleQuote(); }
  }

  const INLINE = [
    [/(\*\*|__)(?=\S)(.+?)(?<=\S)\1$/u, 'b'],
    [/~~(?=\S)(.+?)(?<=\S)~~$/u, 's'],
    [/(?<![*\p{L}\p{N}\\])\*(?=[^\s*])([^*]+?)(?<=\S)\*$/u, 'i'],
    [/(?<![_\p{L}\p{N}\\])_(?=[^\s_])([^_]+?)(?<=\S)_$/u, 'i'],
    [/(?<!`)`([^`]+)`$/u, 'code'],
  ];
  function inlineShortcut() {
    const s = sel();
    const node = s.anchorNode;
    if (!node || node.nodeType !== 3 || !s.isCollapsed || node.parentElement.closest('code,pre')) return;
    const end = s.anchorOffset;
    const text = node.data.slice(0, end);
    for (const [re, tag] of INLINE) {
      const m = re.exec(text);
      if (!m) continue;
      const inner = m[m.length - 1];
      const start = m.index;
      const d = (m[0].length - inner.length) / 2;  // délka značky (** nebo *)
      const pick = (a, b) => { const r = document.createRange(); r.setStart(node, a); r.setEnd(node, b); s.removeAllRanges(); s.addRange(r); };
      pick(end - d, end);
      exec('delete');
      if (!node.isConnected || node.data.slice(start + d, start + d + inner.length) !== inner) return;
      pick(start, start + d);
      exec('delete');
      if (!node.isConnected) return;
      pick(start, start + inner.length);
      if (tag === 'code') {
        const code = h('code');
        s.getRangeAt(0).surroundContents(code);
        const after = document.createTextNode('\u200b');  // neviditelná mezera: další psaní už není kód
        code.after(after);
        setCaret(after, 1);
      } else {
        const c = { b: 'bold', i: 'italic', s: 'strikeThrough' }[tag];
        exec(c);
        s.collapseToEnd();
        exec(c);  // dál se píše bez formátu
      }
      return;
    }
  }

  function afterEnter() {
    const r = range();
    if (!r) return;
    const li = closest('li');
    if (li && li.dataset.task === '1' && !li.textContent.trim()) li.dataset.task = '0';  // nová položka není odškrtnutá
    const b = blockOf(r.startContainer);
    const prev = b?.previousElementSibling;
    if (prev && prev.parentNode === el && /^(P|DIV)$/.test(prev.tagName) && /^(-{3,}|\*{3,}|_{3,})$/.test(prev.textContent.trim())) prev.replaceWith(h('hr'));
  }

  // ---------- události ----------
  el.addEventListener('focus', () => { exec('defaultParagraphSeparator', 'p'); exec('styleWithCSS', false); });
  el.addEventListener('input', (e) => {
    if (e.isComposing) { onInput(); return; }  // psaní přes IME (Android): uklidit až po dopsání slova
    if (e.inputType === 'insertText' && e.data === ' ') blockShortcut();
    else if (e.inputType === 'insertText' && /[*_~`]$/.test(e.data || '')) inlineShortcut();
    else if (e.inputType === 'insertParagraph') afterEnter();
    changed();
  });
  el.addEventListener('compositionend', () => changed());

  el.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Tab' && !mod && !e.altKey) {
      const cell = closest('td,th');
      if (cell) { e.preventDefault(); moveCell(cell, e.shiftKey ? -1 : 1); onState(); return; }
      if (closest('li')) { e.preventDefault(); exec(e.shiftKey ? 'outdent' : 'indent'); changed(); }
      return;
    }
    if (e.key === 'Enter' && !mod) {
      if (!e.shiftKey && (closest('td,th') || closest('pre'))) { e.preventDefault(); exec('insertLineBreak'); return; }
      const bq = closest('blockquote');
      const r = range();
      const b = r && blockOf(r.startContainer);
      if (bq && b && b !== bq && !b.textContent.trim() && !b.querySelector('img')) {  // prázdný řádek v citaci → ven z citace
        e.preventDefault();
        const p = h('p', null, h('br'));
        b.remove();
        bq.after(p);
        if (!bq.textContent.trim() && !bq.querySelector('img')) bq.remove();
        setCaret(p, 0);
        changed();
      }
      return;
    }
    if (e.key === 'Backspace' && !mod) {
      const r = range();
      if (!r || !r.collapsed) return;
      const hd = closest('h1,h2,h3,h4,h5,h6');
      if (hd && atStart(hd, r)) { e.preventDefault(); exec('formatBlock', '<p>'); changed(); return; }
      const li = closest('li');
      if (li && li.dataset.task != null && atStart(li, r)) { e.preventDefault(); delete li.dataset.task; changed(); return; }
      const bq = closest('blockquote');
      if (bq && atStart(bq, r)) { e.preventDefault(); unwrap(bq); changed(); }
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); onLink(); return; }
    if (mod && e.altKey && /^Digit[0-3]$/.test(e.code)) { e.preventDefault(); cmd(e.code === 'Digit0' ? 'p' : `h${e.code.slice(-1)}`); return; }
    if (mod && e.shiftKey && /^Digit[789]$/.test(e.code)) { e.preventDefault(); cmd({ Digit7: 'ol', Digit8: 'ul', Digit9: 'task' }[e.code]); return; }
    if (mod && e.shiftKey && e.code === 'KeyX') { e.preventDefault(); cmd('strike'); }
  });

  // odškrtnutí políčka: klepnutí na čtvereček (bez otevírání klávesnice na telefonu)
  el.addEventListener('pointerdown', (e) => {
    const li = e.target.closest?.('li[data-task]');
    if (!li || !el.contains(li)) return;
    const r = li.getBoundingClientRect();
    const cs = getComputedStyle(li);
    const lh = parseFloat(cs.lineHeight) || 26;
    if (e.clientX < r.left + parseFloat(cs.paddingLeft) && e.clientY < r.top + lh + 4) {
      e.preventDefault();
      li.dataset.task = li.dataset.task === '1' ? '0' : '1';
      changed();
    }
  });

  el.addEventListener('click', (e) => {
    const a = e.target.closest?.('a');
    if (!a || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) location.hash = href;
    else window.open(href, '_blank', 'noopener');
  });

  el.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...cd.files].filter((f) => f.type.startsWith('image/'));
    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    const onlyImg = !html || /^\s*(<meta[^>]*>\s*)?<img[^>]*>\s*$/i.test(html.replace(/<\/?(html|body)[^>]*>|<!--[\s\S]*?-->/g, ''));
    if (files.length && onlyImg) { e.preventDefault(); onImageFiles(files); return; }
    e.preventDefault();
    if (closest('td,th,pre')) { exec('insertText', text.replace(/\n+$/, '')); return; }
    if (!html && /^\s*https?:\/\/\S+\s*$/.test(text) && range() && !range().collapsed) { exec('createLink', text.trim()); changed(); return; }
    const md = (html ? htmlToMd(new DOMParser().parseFromString(html, 'text/html').body, { paste: true }) : text).replace(/\r\n?/g, '\n');
    if (!md.trim()) return;
    const frag = mdToHtml(md);
    const one = /^<p>([\s\S]*)<\/p>$/.exec(frag);
    exec('insertHTML', one && !one[1].includes('</p>') ? one[1] : frag);  // jeden odstavec → do aktuálního řádku
    changed();
  });

  el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
  el.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (pos) { sel().removeAllRanges(); sel().addRange(pos); savedRange = pos.cloneRange(); }
    onImageFiles(files);
  });

  const onSel = () => {
    const r = range();
    if (r) savedRange = r.cloneRange();
    updateBubble();
    onState();
  };
  const hideBubble = () => { bubble.hidden = true; };
  document.addEventListener('selectionchange', onSel);
  window.addEventListener('scroll', hideBubble, { passive: true });
  el.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== el) bubble.hidden = true; }, 150));

  return {
    el, kind: 'rich', getMd, setMd, cmd, state: stateNow, linkInfo, setLink, insertImage, saveCaret,
    focus: () => {
      el.focus({ preventScroll: true });
      if (savedRange && el.contains(savedRange.startContainer)) { sel().removeAllRanges(); sel().addRange(savedRange); }
    },
    focusStart: () => { el.focus(); setCaret(el.firstElementChild || el, 0); },
    destroy: () => { document.removeEventListener('selectionchange', onSel); window.removeEventListener('scroll', hideBubble); bubble.remove(); },
  };
}
