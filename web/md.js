// Markdown ↔ HTML. Dokument se ukládá jako Markdown (texťák jako ve VS Code); formátovaný režim (jako Google Docs)
// ho zobrazí jako HTML a při ukládání převede zpátky. Převod tam a zpět je stabilní: md → html → md dá stejný text.
// Podporováno: nadpisy, odstavce (nový řádek = zalomení), tučné, kurzíva, přeškrtnuté, kód, odkazy, obrázky,
// odrážky, číslované seznamy, zaškrtávací políčka (- [ ] / - [x]), vnořené seznamy, citace, bloky kódu, čára, tabulky.
// Vlastní HTML v Markdownu se nepodporuje (všechno se zobrazí jako text) – appka je tak bezpečná proti vloženému kódu.

const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isWS = (c) => c === undefined || /\s/.test(c);
const isAlnum = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isBlank = (l) => /^[ \t]*$/.test(l);
const indentOf = (s) => { let n = 0; for (const c of s) { if (c === ' ') n++; else if (c === '\t') n += 4 - (n % 4); else break; } return n; };

const RE = {
  fence: /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[ \t]*$/,
  heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  quote: /^ {0,3}>[ \t]?(.*)$/,
  item: /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/,
  task: /^\[([ xX])\](?:[ \t]+(.*))?$/,
  tableDelim: /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
};

/** Adresa odkazu, kterou appka pustí (http, https, mailto, tel, odkaz na jiný dokument #/…); jinak null. */
export function safeUrl(u) {
  u = String(u || '').trim();
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^www\.[^\s]+$/i.test(u)) return `https://${u}`;
  if (/^#\//.test(u)) return u;
  return null;
}

/** Obrázek uložený v appce: „img/12“ → adresa API. */
export const imgSrc = (u) => {
  const m = /^img\/(\d+)$/.exec(String(u || '').trim());
  if (m) return `server/index.php?r=/api/img/${m[1]}`;
  return /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : null;
};

// ------------------------------------------------------------------ Markdown → HTML

export function mdToHtml(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  return blocks(lines);
}

function itemInfo(l) {
  if (RE.hr.test(l)) return null;
  const m = RE.item.exec(l);
  if (!m) return null;
  const ordered = /\d/.test(m[2]);
  return { indent: indentOf(m[1]), ordered, marker: m[2], text: m[3] ?? '' };
}

const startsBlock = (l) => RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || !!itemInfo(l);

/** Buňky řádku tabulky (svislítko s \ před sebou je text). */
function splitRow(l) {
  let s = l.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines, i) {
  if (!lines[i].includes('|') || i + 1 >= lines.length || !RE.tableDelim.test(lines[i + 1]) || !lines[i + 1].includes('-')) return false;
  if (!lines[i + 1].includes('|') && splitRow(lines[i]).length !== 1) return false;
  return splitRow(lines[i]).length === splitRow(lines[i + 1]).length;
}

function blocks(lines) {
  const out = [];
  let i = 0;
  let blank = 0;
  let first = true;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { blank++; i++; continue; }
    // víc prázdných řádků mezi bloky = prázdné odstavce (místo navíc, jak ho člověk udělal Enterem)
    const empties = first ? blank : Math.max(0, blank - 1);
    for (let k = 0; k < empties; k++) out.push('<p><br></p>');
    blank = 0;
    first = false;

    let m = RE.fence.exec(line);
    if (m) {
      const fence = m[1];
      const lang = m[2];
      const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`).test(lines[i])) body.push(lines[i++]);
      i++;  // uzavírací ```
      out.push(`<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    m = RE.heading.exec(line);
    if (m) {
      const n = m[1].length;
      const text = m[2] ?? '';
      out.push(`<h${n}>${text ? inline(text) : '<br>'}</h${n}>`);
      i++;
      continue;
    }
    if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }
    if (RE.quote.test(line)) {
      const inner = [];
      while (i < lines.length && RE.quote.test(lines[i])) inner.push(RE.quote.exec(lines[i++])[1]);
      out.push(`<blockquote>${blocks(inner) || '<p><br></p>'}</blockquote>`);
      continue;
    }
    if (itemInfo(line)) {
      const r = list(lines, i);
      out.push(r.html);
      i = r.next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const r = table(lines, i);
      out.push(r.html);
      i = r.next;
      continue;
    }
    const para = [];
    while (i < lines.length && !isBlank(lines[i])) {
      if (para.length && (startsBlock(lines[i]) || isTableStart(lines, i))) break;
      para.push(lines[i++]);
    }
    out.push(`<p>${para.map((l) => inline(l)).join('<br>')}</p>`);
  }
  return out.join('');
}

function list(lines, i) {
  const first = itemInfo(lines[i]);
  const { indent, ordered } = first;
  const items = [];
  while (i < lines.length) {
    const it = itemInfo(lines[i]);
    if (!it || it.ordered !== ordered || Math.abs(it.indent - indent) > 1) break;
    i++;
    const text = [it.text];
    let children = '';
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) break;
      const sub = itemInfo(l);
      if (sub) {
        if (sub.indent >= indent + 2) {
          const r = list(lines, i);
          children += r.html;
          i = r.next;
          continue;
        }
        break;
      }
      if (children || (startsBlock(l) && indentOf(l) <= indent + 1) || isTableStart(lines, i)) break;
      text.push(l.trim());  // pokračování položky na dalším řádku
      i++;
    }
    items.push({ text, children });
  }
  const tag = ordered ? 'ol' : 'ul';
  const start = ordered ? parseInt(first.marker, 10) : 1;
  const lis = items.map(({ text, children }) => {
    let task = '';
    const t = RE.task.exec(text[0]);
    if (t) {
      task = ` data-task="${t[1] === ' ' ? '0' : '1'}"`;
      text[0] = t[2] ?? '';
    }
    const content = text.length === 1 && text[0] === '' ? '' : text.map((l) => inline(l)).join('<br>');
    return `<li${task}>${content || (children ? '' : '<br>')}${children}</li>`;
  }).join('');
  return { html: `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${lis}</${tag}>`, next: i };
}

function table(lines, i) {
  const head = splitRow(lines[i]);
  const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : ''));
  i += 2;
  const rows = [];
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) rows.push(splitRow(lines[i++]));
  const cell = (tag, text, k) => {
    // <br> v buňce = zalomení řádku (jako na GitHubu); \<br> je text
    const html = text.split(/(?<!\\)<br\s*\/?>/i).map((p) => inline(p.trim())).join('<br>');
    return `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${html || '<br>'}</${tag}>`;
  };
  const tr = (cells, tag) => `<tr>${head.map((_, k) => cell(tag, cells[k] ?? '', k)).join('')}</tr>`;
  return { html: `<table><thead>${tr(head, 'th')}</thead><tbody>${rows.map((r) => tr(r, 'td')).join('')}</tbody></table>`, next: i };
}

// --- řádkové formátování ---

function backtickClose(s, from, n) {
  for (let j = from; j < s.length; j++) {
    if (s[j] !== '`') continue;
    let k = j;
    while (s[k] === '`') k++;
    if (k - j === n) return j;
    j = k;
  }
  return -1;
}

/** [text](adresa) od pozice i (s[i] === '['). */
function linkAt(s, i) {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === '[') depth++;
    else if (s[j] === ']' && --depth === 0) break;
  }
  if (j >= s.length || s[j + 1] !== '(') return null;
  let k = j + 2;
  let url = '';
  if (s[k] === '<') {
    const e = s.indexOf('>', k);
    if (e < 0) return null;
    url = s.slice(k + 1, e);
    k = e + 1;
  } else {
    let par = 0;
    for (; k < s.length; k++) {
      const c = s[k];
      if (c === '\\' && ESCAPABLE.test(s[k + 1] || '')) { url += s[k + 1]; k++; continue; }
      if (/\s/.test(c)) break;
      if (c === '(') par++;
      if (c === ')') { if (par === 0) break; par--; }
      url += c;
    }
  }
  const tm = /^[ \t]+"[^"]*"/.exec(s.slice(k));  // nepovinný titulek se zahodí
  if (tm) k += tm[0].length;
  if (s[k] !== ')') return null;
  return { text: s.slice(i + 1, j), url, end: k + 1 };
}

/** Párová značka (**, __, *, _, ~~) od pozice i; vrací {tag, inner, end} nebo null. */
function pairAt(s, i, d, tag) {
  const L = d.length;
  const c = d[0];
  if (isWS(s[i + L])) return null;
  if (c === '_' && isAlnum(s[i - 1])) return null;  // podtržítko uvnitř slova (snake_case) není kurzíva
  for (let j = i + L + 1; j <= s.length - L; j++) {
    const ch = s[j];
    if (ch === '\\') { j++; continue; }
    if (ch === '`') {
      let n = 1;
      while (s[j + n] === '`') n++;
      const e = backtickClose(s, j + n, n);
      if (e >= 0) { j = e + n - 1; continue; }
    }
    if (!s.startsWith(d, j) || isWS(s[j - 1])) continue;
    if (L === 1 && (s[j + 1] === c || s[j - 1] === c)) {  // součást ** – přeskočit celý běh
      while (s[j + 1] === c) j++;
      continue;
    }
    if (L === 2 && s[j + 2] === c && c !== '~') j++;  // ***: tučné končí posledními dvěma
    if (c === '_' && isAlnum(s[j + L])) continue;
    return { tag, inner: s.slice(i + L, j), end: j + L };
  }
  return null;
}

function emphAt(s, i) {
  const c = s[i];
  let run = 0;
  while (s[i + run] === c) run++;
  if (c === '~') return run === 2 ? pairAt(s, i, '~~', 'del') : null;
  if (run >= 2) {
    const m = pairAt(s, i, c + c, 'strong');
    if (m) return m;
  }
  return run === 1 || run >= 3 ? pairAt(s, i, c, 'em') : null;
}

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"]+/gi;
/** Text s automatickými odkazy (adresy http… a www…). */
function autolink(text) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > 0 && /[\p{L}\p{N}]/u.test(text[m.index - 1])) continue;
    let u = m[0];
    while (/[.,;:!?'"]$/.test(u) || (u.endsWith(')') && (u.match(/\(/g) || []).length < (u.match(/\)/g) || []).length)) u = u.slice(0, -1);
    if (/^www\.$/i.test(u) || !/[^.]\.[^.]/.test(u.replace(/^https?:\/\//i, ''))) continue;
    out += esc(text.slice(last, m.index)) + `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${esc(u)}</a>`;
    last = m.index + u.length;
  }
  return out + esc(text.slice(last));
}

function inline(s, noLink = false) {
  let out = '';
  let text = '';
  let i = 0;
  const flush = () => { if (text) { out += noLink ? esc(text) : autolink(text); text = ''; } };
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && ESCAPABLE.test(s[i + 1] || '')) { text += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      const e = backtickClose(s, i + n, n);
      if (e >= 0) {
        flush();
        let code = s.slice(i + n, e);
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        out += `<code>${esc(code)}</code>`;
        i = e + n;
        continue;
      }
      text += s.slice(i, i + n);
      i += n;
      continue;
    }
    if (c === '!' && s[i + 1] === '[') {
      const m = linkAt(s, i + 1);
      const src = m && imgSrc(m.url);
      if (src) {
        flush();
        out += `<img src="${esc(src)}" data-src="${esc(m.url)}" alt="${esc(unescapeMd(m.text))}">`;
        i = m.end;
        continue;
      }
    }
    if (c === '[' && !noLink) {
      const m = linkAt(s, i);
      if (m) {
        flush();
        const href = safeUrl(m.url);
        const inner = inline(m.text, true);
        out += href ? `<a href="${esc(href)}"${href.startsWith('#') ? '' : ' target="_blank" rel="noopener"'}>${inner}</a>` : inner;
        i = m.end;
        continue;
      }
    }
    if (c === '*' || c === '_' || c === '~') {
      const m = emphAt(s, i);
      if (m) {
        flush();
        out += `<${m.tag}>${inline(m.inner, noLink)}</${m.tag}>`;
        i = m.end;
        continue;
      }
      let n = 1;
      while (s[i + n] === c) n++;
      text += s.slice(i, i + n);
      i += n;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

const unescapeMd = (s) => s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');

// ------------------------------------------------------------------ HTML → Markdown

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'THEAD', 'TBODY',
  'TFOOT', 'TR', 'FIGURE', 'FIGCAPTION', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'ASIDE', 'DL', 'DT', 'DD', 'ADDRESS',
  'DETAILS', 'SUMMARY', 'CENTER']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG', 'CANVAS',
  'BUTTON', 'SELECT', 'TEXTAREA', 'COLGROUP', 'CAPTION']);
const BLOCK_SELECTOR = [...BLOCK_TAGS].join(',').toLowerCase();
const isEl = (n) => n.nodeType === 1;
const isBlockEl = (n) => isEl(n) && BLOCK_TAGS.has(n.tagName);

/**
 * Obsah prvku (editoru nebo vloženého HTML) → Markdown.
 * paste = HTML ze schránky (konce řádků v textu jsou jen mezery, jako v prohlížeči).
 */
export function htmlToMd(root, { paste = false } = {}) {
  const out = [];
  blockChildren(root, out, { paste });
  while (out.length && out[out.length - 1] === '') out.pop();
  return joinBlocks(out);
}

function joinBlocks(blocksArr) {
  let out = '';
  let pending = 0;
  let started = false;
  for (const b of blocksArr) {
    if (b === '') { pending++; continue; }
    out += (started ? '\n\n' : '') + '\n'.repeat(pending) + b;
    started = true;
    pending = 0;
  }
  return out;
}

function blockChildren(parent, out, ctx) {
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const meaningful = run.some((n) => (n.nodeType === 3 ? n.data.trim() !== '' && n.data.replace(/[​\s]/g, '') !== '' : isEl(n) && !SKIP_TAGS.has(n.tagName)));
    if (meaningful) para(out, inlineMd(run, ctx));
    run = [];
  };
  for (const n of parent.childNodes) {
    if (isBlockEl(n)) { flush(); block(n, out, ctx); }
    // řádkový prvek s bloky uvnitř (Google Docs vkládá celý dokument do <b>) = jen obal
    else if (isEl(n) && !SKIP_TAGS.has(n.tagName) && n.querySelector(BLOCK_SELECTOR)) { flush(); blockChildren(n, out, ctx); }
    else run.push(n);
  }
  flush();
}

const hasBlockChild = (el) => [...el.children].some(isBlockEl);

function para(out, md) {
  if (md.trim() === '') { out.push(''); return; }
  out.push(md.split('\n').map(escapeLineStart).join('\n'));
}

function block(n, out, ctx) {
  const t = n.tagName;
  if (/^H[1-6]$/.test(t)) {
    const md = inlineMd(n.childNodes, { ...ctx, oneLine: ' ' }).trim();
    out.push('#'.repeat(Number(t[1])) + (md ? ' ' + md : ''));
  } else if (t === 'UL' || t === 'OL') {
    const md = listMd(n, '', ctx);
    if (md) out.push(md);
  } else if (t === 'BLOCKQUOTE') {
    const inner = [];
    blockChildren(n, inner, ctx);
    while (inner.length && inner[inner.length - 1] === '') inner.pop();
    const md = joinBlocks(inner);
    out.push(md ? md.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n') : '>');
  } else if (t === 'PRE') {
    const text = preText(n).replace(/\n$/, '');
    let fence = '```';
    while (text.includes(fence)) fence += '`';
    const lang = n.dataset?.lang || n.querySelector('code')?.className.match(/language-(\S+)/)?.[1] || '';
    out.push(`${fence}${lang}\n${text}${text ? '\n' : ''}${fence}`);
  } else if (t === 'HR') {
    out.push('---');
  } else if (t === 'TABLE') {
    const md = tableMd(n, ctx);
    if (md) out.push(md);
  } else if (t === 'LI') {
    para(out, inlineMd(n.childNodes, ctx));
  } else if (SKIP_TAGS.has(t)) {
    // nic
  } else if (hasBlockChild(n)) {
    blockChildren(n, out, ctx);
  } else {
    para(out, inlineMd(n.childNodes, ctx));
  }
}

function preText(el) {
  let s = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) s += n.data;
    else if (n.tagName === 'BR') s += '\n';
    else if (isEl(n)) s += (isBlockEl(n) && s && !s.endsWith('\n') ? '\n' : '') + preText(n);
  }
  return s;
}

/** Řádek odstavce by se jinak přečetl jako nadpis, odrážka, citace… → \ před značkou. */
function escapeLineStart(l) {
  const m = /^([ \t]*)(.*)$/.exec(l);
  const [, ws, rest] = m;
  if (/^#{1,6}([ \t]|$)/.test(rest) || /^[-+]([ \t]|$)/.test(rest) || /^>/.test(rest) || /^\|/.test(rest) || /^-([ \t]*-){2,}[ \t]*$/.test(rest)) return ws + '\\' + rest;
  if (/^\d{1,9}[.)]([ \t]|$)/.test(rest)) return ws + rest.replace(/^(\d+)([.)])/, '$1\\$2');
  return l;
}

function listMd(list, pad, ctx) {
  const ordered = list.tagName === 'OL';
  let n = ordered ? (parseInt(list.getAttribute('start'), 10) || 1) : 1;
  const lines = [];
  let lastPad = pad + '  ';
  for (const child of list.childNodes) {
    if (isEl(child) && (child.tagName === 'UL' || child.tagName === 'OL')) {  // seznam přímo v seznamu (Chrome) = vnořený pod předchozí položkou
      const md = listMd(child, lastPad, ctx);
      if (md) lines.push(md);
      continue;
    }
    if (!isEl(child) || child.tagName !== 'LI') {
      if (child.nodeType === 3 && !child.data.trim()) continue;
      if (isEl(child) && SKIP_TAGS.has(child.tagName)) continue;
    }
    const li = child;
    const marker = ordered ? `${n++}.` : '-';
    const inner = [];
    const nested = [];
    let task = null;
    if (isEl(li)) {
      if (li.dataset?.task === '0' || li.dataset?.task === '1') task = li.dataset.task === '1';
      else if (li.getAttribute('role') === 'checkbox') task = li.getAttribute('aria-checked') === 'true';  // Google Docs
      for (const c of li.childNodes) {
        if (isEl(c) && (c.tagName === 'UL' || c.tagName === 'OL')) nested.push(c);
        else if (isEl(c) && c.tagName === 'INPUT' && c.type === 'checkbox') task = c.checked || c.hasAttribute('checked');
        else inner.push(c);
      }
    } else {
      inner.push(li);
    }
    const text = inlineMd(inner, ctx).trim();
    const sub = pad + ' '.repeat(marker.length + 1);
    const [first, ...rest] = text ? text.split('\n') : [''];
    let firstLine = first;
    if (task === null && /^\[[ xX]\]([ \t]|$)/.test(firstLine)) firstLine = '\\' + firstLine;  // text „[ ]“ není políčko
    const head = pad + marker + (task !== null ? ` [${task ? 'x' : ' '}]` : '') + (firstLine ? ' ' + firstLine : '');
    lines.push(head, ...rest.map((l) => (l.trim() ? sub + escapeLineStart(l) : sub.trimEnd())));
    for (const nl of nested) {
      const md = listMd(nl, sub, ctx);
      if (md) lines.push(md);
    }
    lastPad = sub;
  }
  return lines.join('\n');
}

function tableMd(tableEl, ctx) {
  const rows = [...tableEl.rows].filter((r) => r.closest('table') === tableEl);
  if (!rows.length) return '';
  const cols = Math.max(...rows.map((r) => r.cells.length));
  if (!cols) return '';
  const cellMd = (c) => (c ? inlineMd(c.childNodes, { ...ctx, oneLine: '<br>', inTable: true }).trim() : '');
  const line = (r) => '| ' + Array.from({ length: cols }, (_, k) => cellMd(r.cells[k])).join(' | ') + ' |';
  const aligns = Array.from({ length: cols }, (_, k) => {
    const c = rows[0].cells[k];
    const a = (c?.style?.textAlign || c?.getAttribute('align') || '').toLowerCase();
    return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
  });
  return [line(rows[0]), '| ' + aligns.join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n');
}

// --- řádkový obsah: úseky textu se značkami → Markdown ---

const ORDER = ['b', 'i', 's'];

function collect(node, marks, link, segs, ctx) {
  if (node.nodeType === 3) {
    let t = node.data.replace(/​/g, '').replace(/ /g, ' ');
    if (ctx.paste) t = t.replace(/\s*\n\s*/g, ' ');
    if (!t) return;
    const parts = t.split('\n');
    parts.forEach((p, k) => {
      if (k) segs.push({ br: true });
      if (p) segs.push({ t: p, marks, link });
    });
    return;
  }
  if (!isEl(node)) return;
  const tag = node.tagName;
  if (SKIP_TAGS.has(tag)) return;
  if (tag === 'BR') { segs.push({ br: true }); return; }
  if (tag === 'IMG') {
    const src = node.dataset?.src || node.getAttribute('src') || '';
    if (imgSrc(src)) segs.push({ img: { alt: node.getAttribute('alt') || '', src }, link });
    return;
  }
  if (tag === 'INPUT') return;
  if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') {
    const t = node.textContent.replace(/​/g, '').replace(/ /g, ' ').replace(/\n/g, ' ');
    if (t) segs.push({ code: t, marks, link });
    return;
  }
  let m = marks;
  const add = (k) => { if (!m.includes(k)) m = [...m, k]; };
  const del = (k) => { m = m.filter((x) => x !== k); };
  const st = node.style || {};
  const fw = String(st.fontWeight || '');
  if (tag === 'B' || tag === 'STRONG') { if (fw === 'normal' || fw === '400') del('b'); else add('b'); } else if (fw === 'bold' || Number(fw) >= 600) add('b');
  else if (fw === 'normal' || fw === '400') del('b');
  if (tag === 'I' || tag === 'EM' || tag === 'CITE' || tag === 'VAR' || tag === 'DFN') add('i');
  else if (st.fontStyle === 'italic') add('i');
  else if (st.fontStyle === 'normal') del('i');
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /line-through/.test(st.textDecoration || st.textDecorationLine || '')) add('s');
  let l = link;
  if (tag === 'A') {
    const href = safeUrl(node.getAttribute('href'));
    if (href) l = href;
  }
  const blockish = isBlockEl(node);
  if (blockish && segs.length && !segs[segs.length - 1].br) segs.push({ br: true });
  for (const c of node.childNodes) collect(c, m, l, segs, ctx);
  if (blockish && segs.length && !segs[segs.length - 1].br) segs.push({ br: true });
}

const sameMarks = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

function inlineMd(nodes, ctx = {}) {
  let segs = [];
  for (const n of nodes) collect(n, [], null, segs, ctx);
  // zalomení na začátku a konci (Chrome dává <br> na konec bloku) – v Markdownu nejdou zapsat
  while (segs.length && segs[0].br) segs.shift();
  while (segs.length && segs[segs.length - 1].br) segs.pop();
  if (!segs.length) return '';
  // mezery na kraji formátovaného úseku vystrčit ven („**a **b“ by nefungovalo)
  const split = [];
  segs.forEach((s, k) => {
    if (!s.t || !s.marks.length) { split.push(s); return; }
    const lead = /^\s*/.exec(s.t)[0];
    const trail = s.t.length > lead.length ? /\s*$/.exec(s.t)[0] : '';
    const core = s.t.slice(lead.length, s.t.length - trail.length);
    const inter = (o) => (o && o.marks ? s.marks.filter((x) => o.marks.includes(x)) : []);
    if (lead) split.push({ t: lead, marks: inter(segs[k - 1]), link: s.link });
    if (core) split.push({ ...s, t: core });
    if (trail) split.push({ t: trail, marks: inter(segs[k + 1]), link: s.link });
  });
  // sloučit sousední úseky se stejným formátem
  segs = [];
  for (const s of split) {
    const p = segs[segs.length - 1];
    if (p && s.t !== undefined && p.t !== undefined && p.link === s.link && sameMarks(p.marks, s.marks)) p.t += s.t;
    else segs.push({ ...s });
  }
  // skupiny podle odkazu
  let out = '';
  let k = 0;
  while (k < segs.length) {
    const link = segs[k].br ? null : segs[k].link;
    let e = k;
    while (e < segs.length && !segs[e].br && segs[e].link === link) e++;
    if (e === k) { out += ctx.oneLine ?? '\n'; k++; continue; }  // zalomení
    const group = segs.slice(k, e);
    const inner = emitMarks(group, ctx, out.slice(-1), segs[e]);
    if (link) {
      const plain = group.length === 1 && group[0].t !== undefined && !group[0].marks.length ? group[0].t : null;
      if (plain && (plain === link || `https://${plain}` === link) && /^(https?:\/\/|www\.)/i.test(plain)) out += plain;
      else out += `[${inner}](${linkUrl(link)})`;
    } else {
      out += inner;
    }
    k = e;
  }
  return out;
}

function linkUrl(u) {
  u = u.replace(/ /g, '%20').replace(/</g, '%3C').replace(/>/g, '%3E');
  const open = (u.match(/\(/g) || []).length;
  const close = (u.match(/\)/g) || []).length;
  return open === close ? u : u.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function firstChar(seg) {
  if (!seg) return undefined;
  return seg.t !== undefined ? seg.t[0] : seg.code !== undefined ? '`' : undefined;
}

function emitMarks(segs, ctx, prevChar, nextSeg) {
  let out = '';
  const stack = [];  // [{m, d}]
  const close = (to) => { while (stack.length > to) out += stack.pop().d; };
  segs.forEach((s, k) => {
    const want = s.img ? [] : ORDER.filter((x) => s.marks.includes(x));
    let x = 0;
    while (x < stack.length && x < want.length && stack[x].m === want[x]) x++;
    close(x);
    for (let w = x; w < want.length; w++) {
      let d = want[w] === 'b' ? '**' : want[w] === 's' ? '~~' : '_';
      if (d === '_') {  // kurzíva uvnitř slova musí být *, podtržítko by se nepoznalo
        let e = k;
        while (e < segs.length && !segs[e].img && segs[e].marks.includes('i')) e++;
        const before = out ? out.slice(-1) : prevChar;
        const after = e < segs.length ? firstChar(segs[e]) : firstChar(nextSeg);
        if (isAlnum(before) || isAlnum(after)) d = '*';
      }
      out += d;
      stack.push({ m: want[w], d });
    }
    if (s.t !== undefined) out += escText(s.t, ctx);
    else if (s.code !== undefined) {
      let n = 1;
      for (const r of s.code.match(/`+/g) || []) n = Math.max(n, r.length + 1);
      const f = '`'.repeat(n);
      const pad = s.code.startsWith('`') || s.code.endsWith('`') || (s.code.startsWith(' ') && s.code.endsWith(' ') && s.code.trim()) ? ' ' : '';
      out += f + pad + s.code + pad + f;
    } else if (s.img) {
      out += `![${escText(s.img.alt, ctx).replace(/]/g, '\\]')}](${linkUrl(s.img.src)})`;
    }
  });
  close(0);
  return out;
}

function escText(t, ctx) {
  let r = '';
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === '\\' || c === '*' || c === '`') r += '\\' + c;
    else if (c === '_') r += isAlnum(t[k - 1]) && isAlnum(t[k + 1]) ? '_' : '\\_';
    else if (c === '~' && (t[k + 1] === '~' || t[k - 1] === '~')) r += '\\~';
    else if (c === '[' && t.indexOf('](', k) > k) r += '\\[';
    else if (c === '|' && ctx.inTable) r += '\\|';
    else if (c === '<' && ctx.inTable && /^<br\s*\/?>/i.test(t.slice(k))) r += '\\<';
    else r += c;
  }
  return r;
}
