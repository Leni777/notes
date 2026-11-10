// Testy čistých funkcí v prohlížeči: převod Markdown ↔ HTML (md.js) a slučování souběžných úprav (merge.js).
//   node tools/browser/test_units.mjs http://localhost:8795
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:8795';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base + '/poznamky.webmanifest').catch(() => page.goto(base + '/'));

const results = await page.evaluate(async () => {
  const { mdToHtml, htmlToMd } = await import('/md.js');
  const { mergeText, diffLines } = await import('/merge.js');
  const out = [];
  const check = (name, got, want) => out.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const dom = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
  const round = (md) => htmlToMd(dom(mdToHtml(md)));

  // --- kanonický Markdown se převodem tam a zpět nezmění ---
  const canonical = {
    'nadpisy a formát': '# Nadpis\n\nOdstavec s **tučným**, _kurzívou_, ~~škrtnutým~~ a `kódem`.\n\n## Menší\n\n### Nejmenší',
    'zalomení řádku': 'Řádek 1\nŘádek 2',
    'odrážky vnořené': '- a\n- b\n  - c\n  - d\n- e',
    'číslovaný': '1. jedna\n2. dvě\n   1. vnořená\n3. tři',
    'číslovaný od 5': '5. pět\n6. šest',
    'políčka': '- [ ] koupit\n- [x] hotovo\n  - [ ] pod\n- obyčejná',
    'políčko prázdné': '- [ ]',
    'citace': '> citace\n> druhý řádek',
    'kód': '```\nkód\n  odsazený\n```',
    'kód s jazykem': '```js\nconst a = 1;\n```',
    'čára': 'nad\n\n---\n\npod',
    'tabulka': '| A | B |\n| --- | ---: |\n| 1 | 2 |\n| x \\| y | a<br>b |',
    'odkazy': '[odkaz](https://example.com) a https://seznam.cz a [dokument](#/d/5)',
    'www odkaz': 'www.seznam.cz',
    'obrázek': '![fotka](img/12)',
    'prázdné odstavce': 'a\n\n\n\nb',
    'prázdný na začátku': '\nb',
    'escapování začátků': '\\# není nadpis\n\\- není odrážka\n1\\. není seznam\n\\> není citace\n\\+ plus',
    'podtržítka a hvězdičky': 'snake_case_name a 2 \\* 3 a \\_x\\_',
    'tučná kurzíva': '**_tučná kurzíva_**',
    'kurzíva uvnitř slova': 'slo*vo*',
    'není políčko': '- \\[ ] není políčko',
    'formát v odkazu': '[**tučný** odkaz](https://a.cz)',
    'víc bloků': 'Text\n\n- a\n\n1. b\n\n> c',
    'položka na dva řádky': '- první\n  pokračování\n- druhá',
    'diakritika a emoji': 'Příliš žluťoučký kůň 🐴 úpěl ďábelské ódy',
    'hranaté závorky': 'pole [0] a [x] a [odkaz bez adresy]',
    'vlnovka': 'cca ~5 km a \\~\\~',
  };
  for (const [name, md] of Object.entries(canonical)) check('tam a zpět: ' + name, round(md), md);

  // --- Markdown psaný ručně se převede na kanonický tvar ---
  const normalize = {
    '* hvězdičky → -': ['* a\n* b', '- a\n- b'],
    '*kurzíva* → _': ['*kurzíva*', '_kurzíva_'],
    '__tučné__ → **': ['__tučné__', '**tučné**'],
    '***x*** → **_x_**': ['***x***', '**_x_**'],
    'nadpis s # na konci': ['# Titul #', '# Titul'],
    'líné pokračování položky': ['- a\nb', '- a\n  b'],
    'odstavec a hned seznam': ['Ubytování:\n- a\n- b', 'Ubytování:\n\n- a\n- b'],
    '1) → 1.': ['1) a\n2) b', '1. a\n2. b'],
    '[X] velké': ['- [X] a', '- [x] a'],
    'tabulka bez krajních svislítek': ['A | B\n--|--\n1 | 2', '| A | B |\n| --- | --- |\n| 1 | 2 |'],
  };
  for (const [name, [md, want]] of Object.entries(normalize)) check('úprava: ' + name, round(md), want);

  // --- HTML z editoru a ze schránky → Markdown ---
  const html = {
    'mezera na konci tučného': ['<p>a <b>b </b>c</p>', 'a **b** c'],
    'sousední tučné úseky': ['<p><b>a</b><b>b</b></p>', '**ab**'],
    'divy z Chromu': ['<div>x</div><div><br></div><div>y</div>', 'x\n\n\ny'],
    'vnořený seznam z Chromu': ['<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>', '- a\n  - b\n- c'],
    'br na konci bloku': ['<p>text<br></p>', 'text'],
    'span s tučným písmem': ['<p><span style="font-weight:700">B</span> n</p>', '**B** n'],
    'Google Docs': ['<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><h1><span style="font-weight:400">Titul</span></h1><p><span style="font-weight:700">tučně</span><span> text</span></p><ul><li><p>jedna</p></li><li><p>dvě</p></li></ul></b>', '# Titul\n\n**tučně** text\n\n- jedna\n- dvě'],
    'Google Docs políčka': ['<ul><li role="checkbox" aria-checked="true">x</li><li role="checkbox" aria-checked="false">y</li></ul>', '- [x] x\n- [ ] y'],
    'GitHub políčka': ['<ul><li class="task-list-item"><input type="checkbox" checked> a</li><li><input type="checkbox"> b</li></ul>', '- [x] a\n- [ ] b'],
    'datum na začátku': ['<p>1. ledna</p>', '1\\. ledna'],
    'hvězdička v textu': ['<p>a*b</p>', 'a\\*b'],
    'nebezpečný odkaz': ['<p><a href="javascript:alert(1)">x</a></p>', 'x'],
    'obrázek z editoru': ['<p><img src="server/index.php?r=/api/img/3" data-src="img/3" alt="foto"></p>', '![foto](img/3)'],
    'tabulka bez hlavičky': ['<table><tr><td>a|b</td><td>c<br>d</td></tr></table>', '| a\\|b | c<br>d |\n| --- | --- |'],
    'odkaz = adresa': ['<p><a href="https://seznam.cz">https://seznam.cz</a></p>', 'https://seznam.cz'],
    'nbsp a zero-width': ['<p>a  b​</p>', 'a  b'],
    'skript se zahodí': ['<p>a</p><script>alert(1)</script><style>p{}</style>', 'a'],
    'kurzíva uprostřed slova': ['<p>ne<i>skutečné</i></p>', 'ne*skutečné*'],
    'prázdná položka': ['<ul><li><br></li></ul>', '-'],
    'nadpis s br': ['<h2>a<br>b</h2>', '## a b'],
    'citace s odstavci': ['<blockquote><p>a</p><p>b</p></blockquote>', '> a\n>\n> b'],
    'pre s br': ['<pre>a<br>b</pre>', '```\na\nb\n```'],
  };
  for (const [name, [h, want]] of Object.entries(html)) check('html: ' + name, htmlToMd(dom(h), { paste: true }), want);

  // --- bezpečnost: HTML v Markdownu je jen text ---
  check('bezpečnost: script', mdToHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  check('bezpečnost: javascript odkaz', mdToHtml('[x](javascript:alert(1))'), '<p>x</p>');
  check('bezpečnost: obrázek s javascriptem', mdToHtml('![x](javascript:alert(1))').includes('<img'), false);
  check('bezpečnost: uvozovky v adrese', mdToHtml('[x](https://a.cz/"onmouseover="alert(1))').includes('"onmouseover'), false);

  // --- konkrétní HTML ---
  check('html: políčko', mdToHtml('- [x] a'), '<ul><li data-task="1">a</li></ul>');
  check('html: obrázek', mdToHtml('![f](img/7)'), '<p><img src="server/index.php?r=/api/img/7" data-src="img/7" alt="f"></p>');
  check('html: prázdné odstavce', mdToHtml('a\n\n\nb'), '<p>a</p><p><br></p><p>b</p>');
  check('html: autolink bez tečky na konci', mdToHtml('viz https://a.cz.'), '<p>viz <a href="https://a.cz" target="_blank" rel="noopener">https://a.cz</a>.</p>');

  // --- slučování ---
  const mt = (b, m, t) => mergeText(b, m, t);
  check('merge: různé řádky', mt('a\nb\nc', 'a\nB\nc', 'a\nb\nC'), { text: 'a\nB\nC', conflicts: 0 });
  check('merge: oba přidali na konec', mt('- x', '- x\n- moje', '- x\n- jejich'), { text: '- x\n- jejich\n- moje', conflicts: 0 });
  check('merge: stejný řádek, jiná slova', mt('Jedeme v pondělí ráno', 'Jedeme v úterý ráno', 'Jedeme v pondělí večer'), { text: 'Jedeme v úterý večer', conflicts: 0 });
  check('merge: opravdový konflikt', mt('x', 'y', 'z'), { text: 'z\ny', conflicts: 1 });
  check('merge: smazání a úprava jinde', mt('a\nb\nc\nd', 'a\nc\nd', 'a\nb\nc\nD'), { text: 'a\nc\nD', conflicts: 0 });
  check('merge: stejná změna', mt('a', 'b', 'b'), { text: 'b', conflicts: 0 });
  check('merge: jen jejich', mt('a', 'a', 'b'), { text: 'b', conflicts: 0 });
  check('merge: odškrtnutí a přidání', mt('- [ ] a\n- [ ] b', '- [x] a\n- [ ] b', '- [ ] a\n- [ ] b\n- [ ] c'), { text: '- [x] a\n- [ ] b\n- [ ] c', conflicts: 0 });
  const big = Array.from({ length: 3000 }, (_, k) => `řádek ${k}`).join('\n');
  const t0 = performance.now();
  const r = mt(big, big.replace('řádek 10\n', 'řádek 10 moje\n'), big.replace('řádek 2900\n', 'řádek 2900 jejich\n'));
  check('merge: velký dokument', r.conflicts === 0 && r.text.includes('řádek 10 moje') && r.text.includes('řádek 2900 jejich'), true);
  check('merge: rychlost (< 500 ms)', performance.now() - t0 < 500, true);
  check('diff', diffLines('a\nb\nc', 'a\nB\nc\nd'), [{ t: '=', line: 'a' }, { t: '-', line: 'b' }, { t: '+', line: 'B' }, { t: '=', line: 'c' }, { t: '+', line: 'd' }]);
  return out;
});

let failed = 0;
for (const r of results) {
  if (r.ok) console.log('ok  ', r.name);
  else { failed++; console.log('FAIL', r.name, '\n     chci:', JSON.stringify(r.want), '\n     mám: ', JSON.stringify(r.got)); }
}
console.log(`\n${results.length - failed}/${results.length} prošlo`);
await browser.close();
process.exit(failed ? 1 : 0);
