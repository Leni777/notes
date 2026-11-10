# Poznámky – společné dokumenty Lenky a Romana

Místo OneNote / Google Docs: textové dokumenty ve složkách (plán dovolené, seznam dárků, nápady…), do kterých píšou
oba. Funguje v prohlížeči na počítači i v telefonu (dá se nainstalovat jako aplikace). Vzhled stejný jako Hubnutí a Todo.

Bude na **https://app.makuderovi.cz/notes/**. Tabulky v databázi mají předponu **`notes_`**.

| Složka | Co v ní je |
|---|---|
| `web/` | **celý obsah se nahrává na hosting** (kromě `data/`): appka (HTML, JS, CSS, service worker) + `server/` (PHP API, `schema.sql`) |
| `web/data/` | jen lokálně: obrázky z dokumentů (není v gitu; na hostingu je vlastní `data/`, z webu nepřístupná) |
| `tools/` | lokální vývoj, testy, ukázková data, konfigurace a nahrání na WEDOS |
| `tools/browser/` | prohlížečové testy (Playwright) |
| `docker-compose.yml`, `docker/`, `db/` | lokální vývoj (PHP + MySQL jako na WEDOS) |

## Jak appka funguje

- **Přihlášení:** každý své jméno a heslo (`lenka`, `roman`). Počáteční hesla jsou v konfiguraci (`tools/make_env.py`),
  změnit si heslo jde v *Nastavení → Změnit heslo* (ostatní zařízení se pak odhlásí). Zapomenuté heslo: nastavit nové
  v `make_env.py` a nahrát – novější heslo z konfigurace přepíše to z appky.
- **Složky jako ve VS Code:** na počítači strom vlevo (rozbalování, přetažení myší do jiné složky, `+` u složky = nový
  dokument v ní), na telefonu procházení složek a tlačítko `+`. Složky jdou do sebe (Dovolená → Chorvatsko 2027).
  Řazení podle názvu nebo podle poslední úpravy. Nahoře **připnuté** dokumenty, na přehledu **naposledy upravené**.
- **Nabídka u dokumentu / složky:** `⋯`, pravé tlačítko myši, na telefonu dlouhé podržení – přejmenovat, připnout,
  přesunout, duplikovat, historie verzí, smazat.
- **Dva režimy psaní s přepínačem** (v hlavičce dokumentu, pamatuje si ho každé zařízení):
  - **Formát** (jako Google Docs): nadpisy, tučné, odrážky… jsou vidět rovnou, lišta s tlačítky.
  - **Markdown** (jako VS Code): čistý text se značkami (`# nadpis`, `**tučně**`, `- odrážka`, `- [ ] políčko`),
    na širokém monitoru s náhledem vedle.
  - Dokument se ukládá jako **Markdown**, takže oba režimy ukazují přesně totéž a přepínat jde kdykoli.
    Převod tam a zpět je stabilní (testuje se – `tools/browser/test_units.mjs`).
- **Formátování:** nadpisy 1–3, tučné, kurzíva, přeškrtnuté, odrážky, číslované seznamy (i vnořené – Tab / Shift+Tab),
  **zaškrtávací políčka** (odškrtnutí klepnutím na čtvereček, na telefonu bez otevírání klávesnice), **tabulky**
  (Tab = další buňka, tlačítka + řádek / + sloupec / smazat), odkazy (Ctrl+K; i na jiný dokument – stačí psát jeho
  název), **obrázky** (tlačítkem, vložením ze schránky nebo přetažením; velké fotky se před nahráním zmenší na 2000 px),
  citace, blok kódu, čára, Zpět / Znovu.
- **Zkratky při psaní** (ve formátovaném režimu): `# ` / `## ` / `### ` nadpis, `- ` odrážky, `1. ` číslovaný seznam,
  `[] ` políčko, `> ` citace, `---` + Enter čára, `**tučně**`, `_kurzíva_`, `~~škrtnuté~~`, `` `kód` ``.
  Klávesy: Ctrl+B / I, Ctrl+K odkaz, Ctrl+Alt+1–3 nadpisy, Ctrl+Shift+7 / 8 / 9 seznamy, Ctrl+S uložit hned,
  Ctrl+Shift+F hledat.
- **Vložení z jiných stránek:** text zkopírovaný z webu, Google Docs nebo Wordu si ponechá nadpisy, tučné, seznamy,
  odkazy a tabulky (zbytek formátování se zahodí). Funguje i v režimu Markdown (vloží se jako Markdown).
- **Ukládání samo** chvíli po dopsání (stav vpravo nahoře: Uloženo / Ukládám… / Bez připojení). Bez signálu se text
  drží v prohlížeči jako koncept a uloží se, až bude připojení – i když se appka mezitím zavře.
- **Psaní ve dvou najednou:** u dokumentu je vidět, kdo ho má otevřený a kdo zrovna píše. Změny druhého se do
  otevřeného dokumentu načítají průběžně (každé 2–3 s, když jste v něm oba). Když oba upraví dokument zároveň, změny
  se **sloučí** (jako v gitu: po řádcích, ve stejném řádku po slovech). Jen když oba přepíšou totéž místo, zůstanou
  v dokumentu obě verze a appka na to upozorní. Nic se neztratí.
- **Historie verzí** (nabídka dokumentu): úpravy jednoho člověka během 10 minut tvoří jednu verzi. U každé verze kdo a
  kdy, co se změnilo (zeleně přidané, červeně smazané) nebo celý text, a **Obnovit tuto verzi** (aktuální stav
  zůstane v historii).
- **Koš:** smazaný dokument nebo složka (i se vším uvnitř) jde do koše, odkud jde obnovit. Natrvalo smazat jde
  jednotlivě nebo „Vysypat koš“. Obnovený dokument, jehož složka už neexistuje, se vrátí do Dokumentů.
- **Hledání** v názvech i textu, bez ohledu na diakritiku a velká písmena („darky“ najde „Dárky“), víc slov = všechna.
- **Upozornění** (Web Push, *Nastavení → Upozornění*, zapíná se na každém zařízení): když druhý vytvoří nebo upraví
  dokument, přijde pár minut po dokončení úprav upozornění se shrnutím, co přibylo („Roman upravil „Co zabalit“ –
  + lékárnička · nabíječka“). Kdo má dokument zrovna otevřený, upozornění nedostane.
- **Další:** stažení dokumentu jako `.md`, tisk (jen text), záloha všeho v *Nastavení → Data* (JSON, bez obrázků).

## Lokální vývoj (Docker)

```bash
tools/dev.sh up      # appka http://localhost:8794 (lenka / test, roman / test), testovací instance :8795, plánovač
tools/dev.sh demo    # ukázkové dokumenty (Dovolená, Dárky…)
tools/dev.sh test    # testy API (83), převodu Markdown a slučování (79) a prohlížečové (počítač, telefon, dva lidé)
tools/dev.sh reset   # smazat lokální databázi a obrázky
tools/dev.sh down
```
- Lokální konfigurace je `web/server/env.json` (hesla „test“, token plánovače `dev-cron`). Porty se nepotkají s hubnutím
  (8790/8791/3307) ani s todo (8792/8793/3308).
- Prohlížečové testy potřebují `npm --prefix tools/browser install` (udělá `dev.sh test` sám) a knihovny pro Chromium;
  ve WSL bez nich `dev.sh test` použije rozbalené v `/tmp/chromelibs` (jinak `sudo npx playwright install-deps`).
  Snímky obrazovky z testů jsou v `tools/browser/shots/`.
- Kontejner `notes_cron` každou minutu volá plánovač upozornění.

### Jak to je uvnitř

- `web/md.js` – převod Markdown ↔ HTML (vlastní, bez knihoven). HTML v Markdownu se nepodporuje – všechno se zobrazí
  jako text, takže dokument nemůže obsahovat škodlivý kód; odkazy jen http(s), mailto, tel a `#/d/…`.
- `web/rich.js` – formátovaný editor (contenteditable), `web/plain.js` – Markdown, `web/doc.js` – stránka dokumentu
  (ukládání, verze, sloučení, přítomnost, koncept), `web/merge.js` – 3-cestné slučování.
- Server hlídá souběžné úpravy číslem verze: uložení se starou verzí vrátí 409 s aktuálním textem a prohlížeč změny
  sloučí a pošle znovu.
- Obrázky: `![popis](img/12)` v textu, soubor v `data/img/` (název náhodný), vydává ho `server/index.php?r=/api/img/12`
  jen přihlášeným. Dokument smazaný natrvalo smaže i své obrázky (pokud je nepoužívá jiný dokument, např. kopie).

## Nasazení na WEDOS

1. Složka `/www/subdom/app/notes/` → `https://app.makuderovi.cz/notes/` (pravidla v `makuderovi/app.md`; ve složce nesmí
   být vlastní `RewriteEngine On`). Databáze stejná jako u hubnutí (`d307882_master`), tabulky mají předponu `notes_`.
2. **Konfigurace:** `python3 tools/make_env.py` (převezme přístup k databázi z hubnutí, zeptá se na hesla Lenky a Romana)
   → `tools/out/env.prod.json`.
3. **Tabulky:** importovat `web/server/schema.sql` ve WEDOS phpMyAdminu do `d307882_master` (webový uživatel databáze
   tabulky zakládat nesmí). Soubor obsahuje jen `CREATE TABLE IF NOT EXISTS`.
4. **Nahrání:** `tools/deploy.json` (FTP údaje jako u hubnutí, `remote_dir` = `/www/subdom/app/notes`), pak
   `python3 tools/deploy.py --dry-run` a `python3 tools/deploy.py`. Složka `data/` (obrázky) se na serveru vytvoří sama
   a nahrávání ji nepřepisuje.
5. **Plánovač upozornění:** cron-job.org každých 5 minut volá
   `https://app.makuderovi.cz/notes/server/index.php?r=/api/cron&token=<cron_token>` (token je v `env.prod.json`).
   Upozornění odejde po 3 minutách bez úprav (při běhu každých 5 minut tedy 3–8 minut po dopsání).
6. Na telefonu v Chromu otevřít `https://app.makuderovi.cz/notes/` → menu → **Instalovat aplikaci**, pak
   *Nastavení → Zapnout upozornění*.

`server/env.json`, `lib/` a `schema.sql` jsou přes `.htaccess` zvenku nedostupné, `data/` zakazuje `app/.htaccess`
(a pro jistotu i vlastní `.htaccess`, který si appka do `data/` zapíše). Klíče pro upozornění (VAPID) si appka vytvoří
sama při prvním spuštění a uloží do tabulky `notes_kv`.
