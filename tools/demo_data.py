#!/usr/bin/env python3
"""Ukázkové dokumenty pro lokální zkoušení (jen lokálně – přihlašuje se heslem „test“).

  tools/dev.sh demo        (= python3 tools/demo_data.py http://localhost:8794)

Založí složky a dokumenty od Lenky i od Romana, ať je vidět, kdo co upravil. Opakované spuštění nic nezdvojí
(dokument se stejným názvem ve stejné složce přeskočí).
"""
import json
import sys
import urllib.request
from http.cookiejar import CookieJar

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8794"


def client(login):
    jar = CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(method, path, body=None):
        p, _, q = path.partition("?")
        req = urllib.request.Request(f"{BASE}/server/index.php?r={p}" + (f"&{q}" if q else ""),
                                     data=json.dumps(body).encode() if body is not None else None, method=method,
                                     headers={"content-type": "application/json"})
        with op.open(req) as r:
            return json.loads(r.read() or b"null")

    call("POST", "/api/login", {"login": login, "password": "test"})
    for c in jar:
        c.secure = False
    return call


L = client("lenka")
R = client("roman")
tree = L("GET", "/api/tree")


def folder(call, name, parent=None):
    for f in tree["folders"]:
        if f["name"] == name and f["parent_id"] == parent:
            return f["id"]
    f = call("POST", "/api/folders", {"name": name, "parent_id": parent})["folder"]
    tree["folders"].append(f)
    return f["id"]


def doc(call, title, folder_id, body, pinned=False):
    if any(d["title"] == title and d["folder_id"] == folder_id for d in tree["docs"]):
        print(f"  už je: {title}")
        return
    d = call("POST", "/api/docs", {"title": title, "folder_id": folder_id, "body": body})["doc"]
    if pinned:
        call("PUT", f"/api/docs/{d['id']}", {"pinned": True})
    print(f"  přidáno: {title}")


trip = folder(L, "Dovolená")
cro = folder(L, "Chorvatsko 2027", trip)
gifts = folder(R, "Dárky")

doc(L, "Plán cesty", cro, """# Chorvatsko 2027

Odjezd **sobota 3. 7.** ráno, návrat 17. 7.

## Ubytování

- apartmán v Makarské, 7 nocí – [rezervace](https://www.booking.com)
- záloha **zaplacená** (6 000 Kč), zbytek na místě
- pak 7 nocí kemp na Hvaru

## Rozpočet

| Co | Kč | Poznámka |
| --- | ---: | --- |
| Apartmán | 18 000 | 7 nocí |
| Kemp | 9 500 | |
| Trajekt | 1 200 | tam i zpět |
| Dálnice | 1 600 | Slovinsko + Chorvatsko |

## Výlety

1. Biokovo – vyhlídka Skywalk
2. Krka – vodopády
3. Split, Diokleciánův palác
""", pinned=True)

doc(R, "Co zabalit", cro, """## Oblečení

- [x] plavky
- [x] kraťasy
- [ ] mikina na večer

## Ostatní

- [ ] opalovací krém 50+
- [ ] lékárnička
  - [ ] náplasti
  - [ ] Paralen
- [ ] nabíječky a powerbanka
- [ ] dálniční známky (koupit online)
""")

doc(L, "Vánoce 2026", gifts, """Rozpočet zhruba **2 000 Kč** na osobu.

## Děti

- [ ] Toník – Lego Technic
- [x] Ema – knížka o koních

## Rodiče

- [ ] mamka – poukaz na masáž
- [ ] taťka – _něco na kolo?_

> Nápady průběžně doplňovat, ať to není na poslední chvíli.
""")

doc(R, "Nápady na víkendy", None, """- Lednice – zámek a minaret
- Moravský kras, Punkevní jeskyně (rezervovat předem!)
- Pálava – výšlap na Děvičky
""")

print("Hotovo.")
