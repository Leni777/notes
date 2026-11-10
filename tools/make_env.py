#!/usr/bin/env python3
"""Vytvoří produkční konfiguraci tools/out/env.prod.json (na hosting se nahraje jako server/env.json).

  python3 tools/make_env.py

Přístup k databázi umí převzít z hubnutí (stejná databáze d307882_master, tabulky notes_* se s ničím nepotkají).
Zeptá se na hesla Lenky a Romana (nikam se nevypisují). Tajný klíč přihlášení a token pro plánovač upozornění
vygeneruje náhodně; při dalším spuštění je zachová.

Heslo změněné v appce (Nastavení → Změnit heslo) platí, dokud se tady nenastaví nové – to pak přepíše to z appky
(„zapomenuté heslo“: nastavit tady a nahrát tools/deploy.py).
"""
import datetime as dt
import getpass
import json
import os
import secrets
import subprocess
import sys

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "env.prod.json")
HUBNUTI = os.path.expanduser("~/moje/hubnuti/tools/out/env.prod.json")
USERS = {
    "lenka": {"name": "Lenka", "female": True, "color": "#c2185b", "ask": "Heslo pro Lenku"},
    "roman": {"name": "Roman", "female": False, "color": "#1f6fd1", "ask": "Heslo pro Romana (změnit si ho může v appce)"},
}


def ask(label, current=""):
    v = input(f"{label}{f' [{current}]' if current else ''}: ").strip()
    return v or current


def bcrypt(password):
    # přes PHP, aby hash přesně odpovídal password_verify() na hostingu
    return subprocess.run(["php", "-r", "echo password_hash(rtrim(fgets(STDIN), \"\\n\"), PASSWORD_DEFAULT);"],
                          input=password + "\n", capture_output=True, text=True, check=True).stdout.strip()


def main():
    env = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            env = json.load(f)
        print("Upravuji existující tools/out/env.prod.json (Enter = ponechat).")
    db = env.get("db", {})
    if not db.get("password") and os.path.exists(HUBNUTI) and ask("Převzít přístup k databázi z hubnutí? (a/n)", "a").lower().startswith("a"):
        with open(HUBNUTI, encoding="utf-8") as f:
            db = dict(json.load(f)["db"])
        print(f"  převzato: {db['host']} / {db['name']}")
    db["host"] = ask("Databáze – server (např. md354.wedos.net)", db.get("host", ""))
    db["port"] = int(ask("Databáze – port", str(db.get("port", 3306))))
    db["name"] = ask("Databáze – název", db.get("name", ""))
    db["user"] = ask("Databáze – uživatel", db.get("user", ""))
    pw = getpass.getpass("Databáze – heslo" + (" (Enter = ponechat)" if db.get("password") else "") + ": ")
    if pw:
        db["password"] = pw
    env["db"] = db
    env.setdefault("timezone", "Europe/Prague")

    users = env.get("users", {})
    for login, u in USERS.items():
        cur = users.get(login, {})
        p1 = getpass.getpass(u["ask"] + (" (Enter = ponechat)" if cur.get("password_hash") else "") + ": ")
        if p1:
            if len(p1) < 6:
                sys.exit("Heslo musí mít aspoň 6 znaků.")
            if getpass.getpass("  znovu: ") != p1:
                sys.exit("Hesla se neshodují.")
            cur["password_hash"] = bcrypt(p1)
            cur["password_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if not cur.get("password_hash"):
            sys.exit(f"Heslo pro {u['name']} je povinné.")
        cur.update({"name": u["name"], "female": u["female"], "color": u["color"]})
        users[login] = cur
    env["users"] = users

    env.setdefault("session_secret", secrets.token_hex(32))
    env.setdefault("cron_token", secrets.token_hex(24))
    env["vapid_subject"] = ask("Kontaktní e-mail pro push služby (mailto:…)", env.get("vapid_subject", "mailto:notes@makuderovi.cz"))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    fd = os.open(OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(env, f, ensure_ascii=False, indent=2)
    print(f"Uloženo do {OUT} (jen pro tebe, není v gitu).")
    print(f"Adresa pro cron: https://app.makuderovi.cz/notes/server/index.php?r=/api/cron&token={env['cron_token'][:4]}… (celý token je v souboru)")


if __name__ == "__main__":
    main()
