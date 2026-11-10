// Prohlížečové testy appky (Chromium): počítač i telefon, dva uživatelé najednou.
//   node tools/browser/test_app.mjs http://localhost:8795     (spouští tools/dev.sh test na čisté databázi)
// Snímky obrazovky se ukládají do tools/browser/shots/ (nejsou v gitu).
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { deflateSync } from 'zlib';

const base = process.argv[2] || 'http://localhost:8795';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
const errors = [];

async function open(name, { phone = false } = {}) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'cs-CZ', timezoneId: 'Europe/Prague' }
    : { viewport: { width: 1366, height: 860 }, locale: 'cs-CZ', timezoneId: 'Europe/Prague' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|409|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  return { ctx, page };
}
async function login(page, user) {
  await page.goto(base + '/');
  await page.fill('input[autocomplete=username]', user);
  await page.fill('input[type=password]', 'test');
  await page.click('button[type=submit]');
  await page.waitForSelector('.pagehead h1');
}
const step = async (name, fn) => {
  try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '–', e.message.split('\n')[0]); }
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const docBody = (page, id) => page.evaluate(async (i) => (await (await fetch(`server/index.php?r=/api/docs/${i}`)).json()).doc.body, id);
const docId = (page) => Number(new URL(page.url()).hash.split('/')[2]);
async function waitSaved(page) {
  await page.waitForTimeout(1100);
  await page.waitForSelector('.savestate.saved', { timeout: 10000 });
}
function png() {
  const raw = Buffer.concat(Array.from({ length: 4 }, () => Buffer.from([0, ...Array(4).fill([255, 0, 128]).flat()])));
  const crc = (buf) => { let c, k, n, crcT = []; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ======================================================================== počítač (Lenka)
const L = await open('Lenka');
const p = L.page;
await login(p, 'lenka');
let DOC = 0;

await step('přehled: prázdný stav a postranní panel', async () => {
  expect(await p.locator('.side .brand').isVisible(), 'chybí postranní panel');
  expect((await p.locator('main').innerText()).includes('Zatím tu nic není'), 'chybí prázdný stav');
});

await step('nová složka z postranního panelu', async () => {
  await p.click('.side-actions button:has-text("Složka")');
  await p.fill('dialog input', 'Dovolená');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.pagehead h1:has-text("Dovolená")');
  expect(await p.locator('.side .trow.folder:has-text("Dovolená")').count() === 1, 'složka není ve stromu');
});

await step('nový dokument ve složce: název je vybraný k přepsání', async () => {
  await p.click('main button:has-text("Nový dokument")');
  await p.waitForSelector('.doctitle');
  expect(await p.evaluate(() => document.activeElement.classList.contains('doctitle') && document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === 9), 'název není vybraný');
  await p.keyboard.type('Chorvatsko 2027');
  await p.keyboard.press('Enter');
  DOC = docId(p);
  expect(await p.evaluate(() => document.activeElement.classList.contains('rich')), 'Enter nepřesunul do textu');
  await p.waitForTimeout(900);
  expect(await p.locator('.side .trow.doc:has-text("Chorvatsko 2027")').count() === 1, 'nový název není ve stromu');
});

await step('psaní se zkratkami: nadpis, odrážky, políčka, tučné', async () => {
  await p.keyboard.type('# Ubytování');
  await p.keyboard.press('Enter');
  await p.keyboard.type('Apartmán v Makarské, **7 nocí** a _moře_ blízko');
  await p.keyboard.press('Enter');
  await p.keyboard.type('- záloha zaplacená');
  await p.keyboard.press('Enter');
  await p.keyboard.type('zbytek na místě');
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await p.keyboard.type('## Co zabalit');
  await p.keyboard.press('Enter');
  await p.keyboard.type('[] plavky');
  await p.keyboard.press('Enter');
  await p.keyboard.type('opalovací krém');
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await p.keyboard.type('Konec ');
  await p.keyboard.press('Control+B');
  await p.keyboard.type('tučně');
  await p.keyboard.press('Control+B');
  await p.keyboard.type(' a dál');
  await waitSaved(p);
  const md = await docBody(p, DOC);
  const want = '# Ubytování\n\nApartmán v Makarské, **7 nocí** a _moře_ blízko\n\n- záloha zaplacená\n- zbytek na místě\n\n## Co zabalit\n\n- [ ] plavky\n- [ ] opalovací krém\n\nKonec **tučně** a dál';
  expect(md === want, `uloženo:\n${md}`);
});

await step('odškrtnutí políčka klepnutím na čtvereček', async () => {
  const li = p.locator('.rich li[data-task]').first();
  const box = await li.boundingBox();
  await p.mouse.click(box.x + 6, box.y + 10);
  expect(await li.getAttribute('data-task') === '1', 'neodškrtnuto');
  await waitSaved(p);
  expect((await docBody(p, DOC)).includes('- [x] plavky'), 'neuloženo');
});

await step('lišta: nadpis 2 a číslovaný seznam', async () => {
  await p.click('.rich p:has-text("Konec")');
  await p.click('.toolbar [data-cmd="h2"]');
  expect(await p.locator('.rich h2:has-text("Konec")').count() === 1, 'nadpis nevznikl');
  expect(await p.locator('.toolbar [data-cmd="h2"]').getAttribute('aria-pressed') === 'true', 'tlačítko neukazuje stav');
  await p.click('.toolbar [data-cmd="h2"]');
  expect(await p.locator('.rich p:has-text("Konec")').count() === 1, 'nadpis nejde vrátit');
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  await p.click('.toolbar [data-cmd="ol"]');
  await p.keyboard.type('první');
  await p.keyboard.press('Enter');
  await p.keyboard.type('druhý');
  await p.keyboard.press('Tab');
  await waitSaved(p);
  expect((await docBody(p, DOC)).endsWith('1. první\n   1. druhý'), await docBody(p, DOC));
});

await step('tabulka: vložit, psát s Tab, přidat řádek', async () => {
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await p.click('.toolbar [data-cmd="table"]');
  expect(await p.locator('.rich table').count() === 1, 'tabulka nevznikla');
  expect(await p.locator('.tabletools').isVisible(), 'chybí nástroje tabulky');
  for (const t of ['Co', 'Kč', 'Pozn.', 'Trajekt', '1200', 'tam i zpět']) { await p.keyboard.type(t); await p.keyboard.press('Tab'); }
  await p.keyboard.type('Dálnice');
  await p.click('.tabletools button:has-text("+ řádek")');
  await p.keyboard.type('Parkování');
  await waitSaved(p);
  const md = await docBody(p, DOC);
  expect(md.includes('| Co | Kč | Pozn. |\n| --- | --- | --- |\n| Trajekt | 1200 | tam i zpět |\n| Dálnice |  |  |\n| Parkování |  |  |'), md);
});

await step('odkaz přes Ctrl+K na jiný dokument i web', async () => {
  await p.locator('.rich p').last().click();
  await p.keyboard.type('Rezervace: ');
  await p.keyboard.press('Control+K');
  await p.fill('dialog input[aria-label="Adresa nebo dokument"]', 'booking.com/hotel');
  await p.fill('dialog input[aria-label="Text odkazu"]', 'Booking');
  await p.click('dialog button[type=submit]');
  await waitSaved(p);
  expect((await docBody(p, DOC)).includes('Rezervace: [Booking](https://booking.com/hotel)'), await docBody(p, DOC));
  await p.keyboard.press('ArrowLeft');
  await p.waitForSelector('.linkbubble:not([hidden])');
  expect((await p.locator('.linkbubble').innerText()).includes('booking.com/hotel'), 'bublina odkazu');
});

await step('obrázek přes tlačítko', async () => {
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('.toolbar [data-cmd="image"]')]);
  await chooser.setFiles({ name: 'mapa.png', mimeType: 'image/png', buffer: png() });
  await p.waitForSelector('.rich img[data-src^="img/"]');
  const ok = await p.locator('.rich img').evaluate((img) => new Promise((res) => (img.complete ? res(img.naturalWidth) : img.addEventListener('load', () => res(img.naturalWidth)))));
  expect(ok === 4, `obrázek se nenačetl (${ok})`);
  await waitSaved(p);
  expect(/!\[mapa\]\(img\/\d+\)/.test(await docBody(p, DOC)), await docBody(p, DOC));
});

await step('vložení HTML ze schránky (web / Google Docs) se převede', async () => {
  await p.keyboard.press('Enter');
  await p.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-x"><p><span style="font-weight:700">Vložené</span> z Docs</p><ul><li><p>bod A</p></li><li><p>bod B</p></li></ul></b>');
    dt.setData('text/plain', 'Vložené z Docs\nbod A\nbod B');
    document.querySelector('.rich').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await waitSaved(p);
  const md = await docBody(p, DOC);
  expect(md.includes('**Vložené** z Docs\n\n- bod A\n- bod B'), md);
});

await step('přepnutí na Markdown a zpět', async () => {
  await p.click('.modesw button[data-mode="md"]');
  const ta = p.locator('textarea.mdtext');
  expect(await ta.isVisible(), 'chybí textové pole');
  expect((await ta.inputValue()) === await docBody(p, DOC), 'Markdown nesedí s uloženým textem');
  expect(await p.locator('.editorwrap .preview').isVisible(), 'chybí náhled vedle');
  await ta.click();
  await p.keyboard.press('Control+End');
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await p.keyboard.type('- [ ] pas');
  await p.keyboard.press('Enter');
  await p.keyboard.type('lékárnička');
  await waitSaved(p);
  expect((await docBody(p, DOC)).endsWith('- [ ] pas\n- [ ] lékárnička'), 'pokračování seznamu v Markdownu');
  await p.waitForTimeout(300);
  expect(await p.locator('.preview li[data-task]:has-text("lékárnička")').count() === 1, 'náhled se neobnovil');
  await p.click('.modesw button[data-mode="rich"]');
  expect(await p.locator('.rich li[data-task]:has-text("lékárnička")').count() === 1, 'po přepnutí chybí text');
  await p.screenshot({ path: SHOTS + 'pc-dokument.png', fullPage: true });
});

await step('po načtení znovu je všechno uložené', async () => {
  const before = await docBody(p, DOC);
  await p.reload();
  await p.waitForSelector('.rich h1');
  await p.click('.modesw button[data-mode="md"]');
  expect((await p.locator('textarea.mdtext').inputValue()) === before, 'obsah po načtení nesedí');
  await p.click('.modesw button[data-mode="rich"]');
});

// ======================================================================== dva lidé najednou
const R = await open('Roman');
const r = R.page;
await login(r, 'roman');

await step('Roman vidí dokument od Lenky a Lenka vidí, že ho má otevřený', async () => {
  await r.goto(`${base}/#/d/${DOC}`);
  await r.waitForSelector('.rich h1');
  expect((await r.locator('.docmeta').innerText()).includes('upravila Lenka'), await r.locator('.docmeta').innerText());
  await p.waitForSelector('.presence .pres', { timeout: 12000 });
  expect((await p.locator('.presence').getAttribute('class')) !== null, 'přítomnost');
  expect((await p.locator('.presence .avatar').innerText()) === 'R', 'avatar Romana');
});

await step('současné psaní: změny obou se spojí', async () => {
  // Lenka píše na začátek, Roman na konec – zároveň
  await p.click('.rich h1');
  await p.keyboard.press('Home');
  await p.keyboard.type('Hotel: ');
  await r.locator('.rich li[data-task]:has-text("lékárnička")').click();
  await r.keyboard.press('End');
  await r.keyboard.press('Enter');
  await r.keyboard.type('nabíječka');
  await Promise.all([waitSaved(p), waitSaved(r)]);
  await p.waitForTimeout(4000);  // ping a sloučení
  await Promise.all([waitSaved(p), waitSaved(r)]);
  const md = await docBody(p, DOC);
  expect(md.startsWith('# Hotel: Ubytování') && md.endsWith('- [ ] lékárnička\n- [ ] nabíječka'), md);
  await p.waitForFunction(() => document.querySelector('.rich').textContent.includes('nabíječka'), null, { timeout: 12000 });
  await r.waitForFunction(() => document.querySelector('.rich h1').textContent.startsWith('Hotel:'), null, { timeout: 12000 });
});

await step('kurzor zůstane na místě, když přijde změna od druhého', async () => {
  await p.click('.rich h2:has-text("Co zabalit")');
  await p.keyboard.press('End');
  await r.locator('.rich h1').click();
  await r.keyboard.press('End');
  await r.keyboard.type(' 🏖');
  await waitSaved(r);
  await p.waitForFunction(() => document.querySelector('.rich h1').textContent.includes('🏖'), null, { timeout: 12000 });
  await p.keyboard.type('!');
  await waitSaved(p);
  expect((await docBody(p, DOC)).includes('## Co zabalit!'), await docBody(p, DOC));
});

await step('upozornění: plánovač připraví Lence shrnutí Romanových změn', async () => {
  await r.goto(base + '/#/');
  await p.goto(base + '/#/');
  await p.waitForTimeout(500);
  const sent = await p.evaluate(async () => (await (await fetch('server/index.php?r=/api/cron&quiet=0&token=dev-cron')).json()).sent);
  const toLenka = sent.filter((x) => x.message.title.startsWith('Roman'));
  expect(toLenka.length === 1 && toLenka[0].message.title === 'Roman upravil „Chorvatsko 2027“', JSON.stringify(sent));
});

await step('historie verzí: obě jména a obnovení starší verze', async () => {
  await p.goto(`${base}/#/d/${DOC}/historie`);
  await p.waitForSelector('.revitem');
  const names = await p.locator('.revitem .rev-main span:first-child').allInnerTexts();
  expect(names.includes('Roman') && names.includes('Lenka'), names.join());
  await p.waitForSelector('.diff .dl.add');
  await p.screenshot({ path: SHOTS + 'pc-historie.png' });
  const revs = await p.evaluate(async (id) => (await (await fetch(`server/index.php?r=/api/docs/${id}/revisions`)).json()).revisions, DOC);
  const oldest = await p.evaluate(async (rid) => (await (await fetch(`server/index.php?r=/api/revisions/${rid}`)).json()).revision.body, revs[revs.length - 1].id);
  await p.locator('.revitem').last().click();
  await p.click('button:has-text("Celý text")');
  await p.waitForSelector('.revdetail .prose');
  await p.click('button:has-text("Obnovit tuto verzi")');
  await p.click('dialog button:has-text("Obnovit")');
  await p.waitForSelector('.rich');
  expect((await docBody(p, DOC)) === oldest && !oldest.includes('nabíječka'), 'obnovená verze nesedí');
  await p.goto(`${base}/#/d/${DOC}/historie`);
  await p.waitForSelector('.revitem');
  await p.locator('.revitem').nth(1).click();
  await p.click('button:has-text("Obnovit tuto verzi")');
  await p.click('dialog button:has-text("Obnovit")');
  await p.waitForSelector('.rich h1');
  expect((await docBody(p, DOC)).includes('nabíječka'), 'vrácení zpět');
});

await step('hledání bez diakritiky se zvýrazněním', async () => {
  await p.goto(base + '/#/hledat');
  await p.fill('input[type=search]', 'nabijecka');
  await p.waitForSelector('.items mark');
  expect((await p.locator('.items mark').first().innerText()) === 'nabíječka', await p.locator('.items mark').first().innerText());
});

await step('přesun do jiné složky přes nabídku a přetažením', async () => {
  await p.goto(base + '/#/');
  await p.click('main button:has-text("Nová složka")');
  await p.fill('dialog input', 'Archiv');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.pagehead h1:has-text("Archiv")');
  await p.goto(base + '/#/');
  await p.locator('main .item.folder:has-text("Dovolená") .more').click();
  await p.click('.tm-item:has-text("Přesunout do")');
  await p.click('.pickrow:has-text("Archiv")');
  await p.waitForTimeout(500);
  const path = await p.evaluate(async () => { const t = await (await fetch('server/index.php?r=/api/tree')).json(); const by = Object.fromEntries(t.folders.map((f) => [f.name, f])); return by['Dovolená'].parent_id === by['Archiv'].id; });
  expect(path, 'složka se nepřesunula');
  // přetažení dokumentu ve stromu do kořene
  await p.goto(`${base}/#/d/${DOC}`);
  await p.waitForSelector('.side .trow.doc[aria-current="page"]');
  await p.locator('.side .trow.doc[aria-current="page"]').dragTo(p.locator('.side .droproot'));
  await p.waitForTimeout(600);
  expect(await p.evaluate(async (id) => (await (await fetch(`server/index.php?r=/api/docs/${id}`)).json()).doc.folder_id === null, DOC), 'přetažení do kořene');
});

await step('smazání do koše a obnovení', async () => {
  await p.click('.docmenu');
  await p.click('.tm-item:has-text("Smazat")');
  await p.click('dialog button:has-text("Smazat")');
  await p.waitForSelector('.pagehead h1');
  await p.goto(base + '/#/kos');
  await p.waitForSelector('.trashrow:has-text("Chorvatsko 2027")');
  expect((await p.locator('.trashrow').innerText()).includes('Smazala Lenka'), await p.locator('.trashrow').innerText());
  await p.click('.trashrow button:has-text("Obnovit")');
  await p.waitForSelector('.empty:has-text("Koš je prázdný")');
});

await step('bez připojení: koncept zůstane a uloží se po připojení', async () => {
  await p.goto(`${base}/#/d/${DOC}`);
  await p.waitForSelector('.rich h1');
  await p.locator('.rich p').first().click();
  await p.keyboard.press('End');
  await L.ctx.setOffline(true);
  await p.keyboard.type(' (offline)');
  await p.waitForSelector('.savestate.offline', { timeout: 8000 });
  expect(await p.evaluate((id) => !!localStorage.getItem(`notes:draft:${id}`), DOC), 'koncept se neuložil');
  await L.ctx.setOffline(false);
  await p.waitForSelector('.savestate.saved', { timeout: 20000 });
  expect((await docBody(p, DOC)).includes('(offline)'), 'neuloženo po připojení');
  expect(await p.evaluate((id) => !localStorage.getItem(`notes:draft:${id}`), DOC), 'koncept zůstal');
});

await step('neuložený koncept se po zavření obnoví', async () => {
  await p.evaluate((id) => localStorage.setItem(`notes:draft:${id}`, JSON.stringify({ v: 1, base: '', body: 'ztracené psaní', at: Date.now() })), DOC);
  await p.reload();
  await p.waitForSelector('.rich');
  await waitSaved(p);
  const md = await docBody(p, DOC);
  expect(md.includes('ztracené psaní') && md.includes('nabíječka'), md);
});

await p.goto(base + '/#/');
await p.waitForTimeout(400);
await p.screenshot({ path: SHOTS + 'pc-prehled.png' });
await R.ctx.close();

// ======================================================================== telefon (Lenka)
const T = await open('telefon', { phone: true });
const t = T.page;
await login(t, 'lenka');

await step('telefon: přehled bez postranního panelu, tlačítko +', async () => {
  expect(!(await t.locator('.side').isVisible()), 'postranní panel na telefonu');
  expect(await t.locator('#fab').isVisible(), 'chybí tlačítko +');
  await t.screenshot({ path: SHOTS + 'tel-prehled.png' });
});

await step('telefon: nový dokument přes +, psaní, odškrtnutí bez klávesnice', async () => {
  await t.tap('#fab');
  await t.tap('.tm-item:has-text("Nový dokument")');
  await t.waitForSelector('.doctitle');
  await t.keyboard.type('Nákup');
  await t.keyboard.press('Enter');
  await t.keyboard.type('[] mléko');
  await t.keyboard.press('Enter');
  await t.keyboard.type('chleba');
  await waitSaved(t);
  await t.evaluate(() => document.activeElement.blur());
  const li = t.locator('.rich li[data-task]').first();
  const box = await li.boundingBox();
  await t.touchscreen.tap(box.x + 8, box.y + 12);
  expect(await li.getAttribute('data-task') === '1', 'neodškrtnuto');
  expect(!(await t.evaluate(() => document.activeElement?.classList.contains('rich'))), 'odškrtnutí otevřelo klávesnici');
  await waitSaved(t);
  expect((await docBody(t, docId(t))) === '- [x] mléko\n- [ ] chleba', await docBody(t, docId(t)));
  await t.screenshot({ path: SHOTS + 'tel-dokument.png' });
});

await step('telefon: lišta jde posouvat a nepřetéká stránku', async () => {
  const sw = await t.evaluate(() => document.documentElement.scrollWidth);
  expect(sw <= 390, `stránka je široká ${sw}px`);
  const tb = await t.evaluate(() => { const e = document.querySelector('.toolbar'); return e.scrollWidth > e.clientWidth; });
  expect(tb, 'lišta by měla jít posouvat');
});

await step('telefon: dlouhé podržení u dokumentu otevře nabídku', async () => {
  await t.tap('.back');
  await t.waitForSelector('.item');
  const box = await t.locator('.item:has-text("Nákup")').first().boundingBox();
  const cdp = await T.ctx.newCDPSession(t);
  const pt = [{ x: box.x + 60, y: box.y + 20 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
  await t.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await t.waitForSelector('.tmenu.touch');
  expect((await t.locator('.tmenu').innerText()).includes('Přesunout do složky'), 'nabídka');
  await t.keyboard.press('Escape');
});

await T.ctx.close();
await L.ctx.close();
await browser.close();

if (errors.length) { failed++; console.log('FAIL chyby v konzoli:\n  ' + errors.join('\n  ')); }
console.log(failed ? `\n${failed} testů selhalo` : '\nVšechny prohlížečové testy prošly.');
process.exit(failed ? 1 : 0);
