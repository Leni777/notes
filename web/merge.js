// Slučování souběžných úprav: když dva lidé upraví stejný dokument zároveň, spojí se obě změny (3-cestné sloučení
// po řádcích jako v gitu). Když oba změní stejný řádek, zkusí se to po slovech; teprve když ani to nejde,
// zůstanou v dokumentu obě verze řádku (nic se neztratí) a appka na to upozorní.

/** Nejdelší společná podposloupnost: pro každý prvek a index shodného prvku v b (nebo -1). */
function lcsMatch(a, b) {
  const match = new Int32Array(a.length).fill(-1);
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) { match[s] = s; s++; }
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; match[ea] = eb; }
  const n = ea - s;
  const m = eb - s;
  if (!n || !m || n * m > 4e6) return match;  // příliš velká změna: zbytek bez shody (celý blok = změna)
  const W = m + 1;
  const T = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      T[i * W + j] = a[s + i] === b[s + j] ? T[(i + 1) * W + j + 1] + 1 : Math.max(T[(i + 1) * W + j], T[i * W + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[s + i] === b[s + j]) { match[s + i] = s + j; i++; j++; } else if (T[(i + 1) * W + j] >= T[i * W + j + 1]) i++; else j++;
  }
  return match;
}

const same = (x, y) => x.length === y.length && x.every((v, k) => v === y[k]);

/**
 * 3-cestné sloučení polí (řádků nebo slov). o = společný základ, a = moje, b = jejich.
 * fallback(oc, ac, bc) může vyřešit konfliktní úsek jinak (vrátí pole, nebo null).
 */
export function merge3(o, a, b, fallback = null) {
  const ma = lcsMatch(o, a);
  const mb = lcsMatch(o, b);
  const out = [];
  let conflicts = 0;
  const resolve = (oc, ac, bc) => {
    if (!oc.length && !ac.length && !bc.length) return;
    if (same(ac, oc)) out.push(...bc);
    else if (same(bc, oc)) out.push(...ac);
    else if (same(ac, bc)) out.push(...ac);
    else if (!oc.length) out.push(...bc, ...ac);  // oba něco přidali na stejné místo → obojí
    else {
      const f = fallback && fallback(oc, ac, bc);
      if (f) out.push(...f);
      else { conflicts++; out.push(...bc, ...ac); }
    }
  };
  let i = 0;
  let ia = 0;
  let ib = 0;
  for (;;) {
    let j = i;
    while (j < o.length && !(ma[j] >= ia && mb[j] >= ib)) j++;
    if (j >= o.length) { resolve(o.slice(i), a.slice(ia), b.slice(ib)); break; }
    resolve(o.slice(i, j), a.slice(ia, ma[j]), b.slice(ib, mb[j]));
    out.push(o[j]);
    i = j + 1;
    ia = ma[j] + 1;
    ib = mb[j] + 1;
  }
  return { result: out, conflicts };
}

const words = (s) => s.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || [];

/** Sloučení textů dokumentu. Vrací {text, conflicts}. */
export function mergeText(base, mine, theirs) {
  if (mine === base || mine === theirs) return { text: theirs, conflicts: 0 };
  if (theirs === base) return { text: mine, conflicts: 0 };
  const byWords = (oc, ac, bc) => {
    const r = merge3(words(oc.join('\n')), words(ac.join('\n')), words(bc.join('\n')));
    return r.conflicts ? null : r.result.join('').split('\n');
  };
  const r = merge3(base.split('\n'), mine.split('\n'), theirs.split('\n'), byWords);
  return { text: r.result.join('\n'), conflicts: r.conflicts };
}

/** Rozdíl dvou textů po řádcích: [{t: '=' | '-' | '+', line}]. */
export function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const m = lcsMatch(a, b);
  const out = [];
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    if (m[i] < 0) { out.push({ t: '-', line: a[i] }); continue; }
    while (j < m[i]) out.push({ t: '+', line: b[j++] });
    out.push({ t: '=', line: a[i] });
    j = m[i] + 1;
  }
  while (j < b.length) out.push({ t: '+', line: b[j++] });
  return out;
}
