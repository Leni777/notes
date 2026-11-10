#!/usr/bin/env bash
# Lokální vývoj (Docker):
#   tools/dev.sh up        spustit appku (http://localhost:8794, lenka / test, roman / test), testovací instanci (8795) a plánovač
#   tools/dev.sh demo      nahrát ukázkové dokumenty do lokální databáze
#   tools/dev.sh test      smazat testovací databázi a pustit testy API, Markdownu a slučování a prohlížečové testy
#   tools/dev.sh reset     smazat lokální databázi appky a obrázky (začít načisto)
#   tools/dev.sh down      zastavit
set -euo pipefail
cd "$(dirname "$0")/.."
sql() { docker exec notes_db mysql -unotes -pnotes -e "$1" 2>&1 | grep -v "Using a password" || true; }
clean() {  # čistá testovací databáze a složka s obrázky
  sql "DROP DATABASE IF EXISTS notes_test; CREATE DATABASE notes_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  docker exec notes_web_test rm -rf /tmp/notes-test-data
}
case "${1:-}" in
  up)    mkdir -p web/data && chmod 777 web/data && docker compose up -d --build ;;  # obrázky zapisuje Apache (jiný uživatel)
  down)  docker compose down ;;
  demo)  python3 tools/demo_data.py http://localhost:8794 ;;
  reset) sql "DROP DATABASE IF EXISTS notes; CREATE DATABASE notes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"; docker exec notes_web rm -rf /var/www/html/data/img ;;
  test)
    clean
    python3 tools/test_api.py http://localhost:8795
    [ -d tools/browser/node_modules ] || npm --prefix tools/browser install --no-audit --no-fund --silent
    # Chromium potřebuje systémové knihovny; když nejsou nainstalované (WSL), použijí se rozbalené v /tmp/chromelibs
    [ -d /tmp/chromelibs/root/usr/lib/x86_64-linux-gnu ] && export LD_LIBRARY_PATH=/tmp/chromelibs/root/usr/lib/x86_64-linux-gnu
    node tools/browser/test_units.mjs http://localhost:8795
    clean  # prohlížečové testy na čisté databázi
    node tools/browser/test_app.mjs http://localhost:8795 ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
