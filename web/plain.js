// Režim Markdown (jako ve VS Code): čistý text se značkami. Tlačítka lišty vkládají značky, Enter v seznamu
// pokračuje další položkou, Tab odsadí. Vložené HTML (z webu, z Google Docs) se převede na Markdown.
import { htmlToMd } from './md.js';
import { autoGrow, h } from './lib.js';

const LIST_RE = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)([.)]) (?:\[[ xX]\] )?|> )(.*)$/;

export function createPlain({ onInput, onState = () => {}, onImageFiles = () => {}, onLink = () => {} }) {
  const ta = autoGrow(h('textarea', {
    class: 'mdtext', spellcheck: 'true', 'aria-label': 'Text dokumentu (Markdown)', autocapitalize: 'sentences', wrap: 'soft',
  }));

  const changed = () => { ta.fit(); onInput(); onState(); };

  /** Nahradí úsek textu (s možností Zpět) a vybere [selStart, selEnd] v novém textu. */
  function replace(start, end, text, selStart = null, selEnd = null) {
    ta.focus();
    ta.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, start, end, 'end');
    if (selStart != null) ta.setSelectionRange(selStart, selEnd ?? selStart);
    changed();
  }

  /** Celé řádky, na kterých je výběr. */
  function lines() {
    const v = ta.value;
    const s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let e = v.indexOf('\n', Math.max(ta.selectionEnd - (ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === '\n' ? 1 : 0), ta.selectionStart));
    if (e < 0) e = v.length;
    return { s, e, list: v.slice(s, e).split('\n') };
  }

  function mapLines(fn) {
    const { s, e, list } = lines();
    const out = list.map(fn).join('\n');
    replace(s, e, out, s, s + out.length);
  }

  const stripBlock = (l) => l.replace(/^(\s*)(#{1,6} |> |[-*+] \[[ xX]\] |[-*+] |\d+[.)] (?:\[[ xX]\] )?)/, '$1');

  function toggleHeading(n) {
    const { list } = lines();
    const all = list.every((l) => new RegExp(`^#{${n}} `).test(l));
    mapLines((l) => (all ? l.replace(/^#{1,6} /, '') : '#'.repeat(n) + ' ' + stripBlock(l).trimStart()));
  }

  function toggleList(kind) {
    const { list } = lines();
    const re = { ul: /^\s*[-*+] (?!\[[ xX]\] )/, ol: /^\s*\d+[.)] /, task: /^\s*([-*+]|\d+[.)]) \[[ xX]\] /, quote: /^\s*> / }[kind];
    const all = list.filter((l) => l.trim()).every((l) => re.test(l));
    let n = 0;
    mapLines((l) => {
      if (!l.trim()) return l;
      const ind = /^\s*/.exec(l)[0];
      const body = stripBlock(l).slice(ind.length);
      if (all) return ind + body;
      if (kind === 'ul') return `${ind}- ${body}`;
      if (kind === 'ol') return `${ind}${++n}. ${body}`;
      if (kind === 'task') return `${ind}- [ ] ${body}`;
      return `${ind}> ${body}`;
    });
  }

  function wrap(mark) {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const L = mark.length;
    if (v.slice(s - L, s) === mark && v.slice(e, e + L) === mark) { replace(s - L, e + L, v.slice(s, e), s - L, e - L); return; }  // zrušit
    const inner = v.slice(s, e);
    const lead = /^\s*/.exec(inner)[0];
    const trail = /\s*$/.exec(inner.slice(lead.length))[0];
    const core = inner.slice(lead.length, inner.length - trail.length);
    if (!core) { replace(s, e, mark + mark, s + L); return; }
    replace(s, e, lead + mark + core + mark + trail, s + lead.length + L, s + lead.length + L + core.length);
  }

  function indent(dir) {
    mapLines((l) => (dir > 0 ? '  ' + l : l.replace(/^( {1,2}|\t)/, '')));
  }

  /** Vloží blok (čáru, tabulku) na samostatné řádky. */
  function insertBlock(text) {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const before = v.slice(0, s);
    const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const post = v.slice(e).startsWith('\n') ? '\n' : '\n\n';
    replace(s, e, pre + text + post, s + pre.length + text.length + post.length);
  }

  function cmd(name) {
    switch (name) {
      case 'h1': case 'h2': case 'h3': toggleHeading(Number(name[1])); break;
      case 'p': mapLines(stripBlock); break;
      case 'bold': wrap('**'); break;
      case 'italic': wrap('_'); break;
      case 'strike': wrap('~~'); break;
      case 'ul': case 'ol': case 'task': case 'quote': toggleList(name); break;
      case 'indent': indent(1); break;
      case 'outdent': indent(-1); break;
      case 'code': {
        const { s, e, list } = lines();
        const t = list.join('\n');
        replace(s, e, '```\n' + t + '\n```', s + 4, s + 4 + t.length);
        break;
      }
      case 'hr': insertBlock('---'); break;
      case 'table': insertBlock('| Sloupec 1 | Sloupec 2 | Sloupec 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |'); break;
      case 'undo': ta.focus(); document.execCommand('undo'); changed(); break;
      case 'redo': ta.focus(); document.execCommand('redo'); changed(); break;
      default: break;
    }
  }

  function linkInfo() {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    // kurzor v [text](adresa)?
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const le = v.indexOf('\n', s) < 0 ? v.length : v.indexOf('\n', s);
    for (const m of v.slice(ls, le).matchAll(/\[([^\]]*)\]\(([^)\s]*)\)/g)) {
      const a = ls + m.index;
      if (s >= a && e <= a + m[0].length) return { href: m[2], text: m[1], existing: true, range: [a, a + m[0].length] };
    }
    return { href: '', text: v.slice(s, e), existing: false, range: [s, e] };
  }
  function setLink(href, text) {
    const info = linkInfo();
    const [s, e] = info.range;
    if (!href) { replace(s, e, info.text, s, s + info.text.length); return; }
    const t = (text || info.text || href).replace(/[[\]]/g, '\\$&');
    replace(s, e, `[${t}](${href.replace(/ /g, '%20')})`, s + t.length + href.length + 4);
  }
  function insertImage(src, alt = '') {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const pre = s && v[s - 1] !== '\n' ? '\n' : '';
    const t = `${pre}![${alt.replace(/[[\]]/g, '')}](${src})\n`;
    replace(s, e, t, s + t.length);
  }

  ta.addEventListener('input', changed);
  ta.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.isComposing && ta.selectionStart === ta.selectionEnd) {
      const v = ta.value;
      const s = ta.selectionStart;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const m = LIST_RE.exec(v.slice(ls, s));
      if (!m) return;
      e.preventDefault();
      if (!m[5].trim() && v.slice(s, v.indexOf('\n', s) < 0 ? v.length : v.indexOf('\n', s)).trim() === '') {  // prázdná položka → konec seznamu
        replace(ls, s, m[1], ls + m[1].length);
        return;
      }
      let marker = m[2];
      if (m[3]) marker = `${Number(m[3]) + 1}${m[4]} ${/\[[ xX]\]/.test(m[2]) ? '[ ] ' : ''}`;
      else marker = marker.replace(/\[[xX]\]/, '[ ]');
      replace(s, s, '\n' + m[1] + marker, s + 1 + m[1].length + marker.length);
      return;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      const { list } = lines();
      if (list.length > 1 || LIST_RE.test(list[0]) || e.shiftKey) { e.preventDefault(); indent(e.shiftKey ? -1 : 1); }
      return;
    }
    if (mod && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); wrap('**'); } else if (k === 'i') { e.preventDefault(); wrap('_'); } else if (k === 'k') { e.preventDefault(); onLink(); }
    }
  });
  ta.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...cd.files].filter((f) => f.type.startsWith('image/'));
    const html = cd.getData('text/html');
    if (files.length && !cd.getData('text/plain').trim()) { e.preventDefault(); onImageFiles(files); return; }
    if (html && /<(p|h[1-6]|ul|ol|li|b|strong|i|em|a|table|br)\b/i.test(html)) {
      const md = htmlToMd(new DOMParser().parseFromString(html, 'text/html').body, { paste: true });
      if (md.trim()) { e.preventDefault(); replace(ta.selectionStart, ta.selectionEnd, md, ta.selectionStart + md.length); }
    }
  });
  ta.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
  ta.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); onImageFiles(files); }
  });

  function setMd(md, { keepCaret = false } = {}) {
    const focused = document.activeElement === ta;
    const caret = keepCaret && focused ? { offset: ta.selectionStart, ctx: ta.value.slice(Math.max(0, ta.selectionStart - 30), ta.selectionStart) } : null;
    ta.value = md;
    ta.fit();
    if (caret) {
      let pos = Math.min(caret.offset, md.length);
      if (caret.ctx) {
        let best = -1;
        let bestD = Infinity;
        for (let i = md.indexOf(caret.ctx); i >= 0; i = md.indexOf(caret.ctx, i + 1)) {
          const d = Math.abs(i + caret.ctx.length - caret.offset);
          if (d < bestD) { bestD = d; best = i + caret.ctx.length; }
        }
        if (best >= 0) pos = best;
      }
      ta.setSelectionRange(pos, pos);
    }
  }

  return {
    el: ta, kind: 'md', getMd: () => ta.value, setMd, cmd, state: () => ({}), linkInfo, setLink, insertImage,
    focus: () => ta.focus(), focusStart: () => { ta.focus(); ta.setSelectionRange(0, 0); },
    destroy: () => {},
  };
}
