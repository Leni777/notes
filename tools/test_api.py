#!/usr/bin/env python3
"""Integrační testy API proti lokální testovací instanci (Docker, samostatná databáze a složka s obrázky).

  tools/dev.sh test        (smaže testovací databázi a pustí tyto testy i prohlížečové)
"""
import base64
import json
import sys
import urllib.error
import urllib.request
import zlib
import struct
from http.cookiejar import CookieJar

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8795"
CRON = "dev-cron"


class Client:
    def __init__(self):
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, raw=None, ctype=None, token=None):
        p, _, q = path.partition("?")
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(f"{BASE}/server/index.php?r={p}" + (f"&{q}" if q else ""), data=data, method=method)
        if data is not None:
            req.add_header("content-type", ctype or "application/json")
        if token:
            req.add_header("x-api-token", token)
        try:
            with self.opener.open(req) as r:
                body = r.read()
                ct = r.headers.get("content-type", "")
                return r.status, (json.loads(body or b"null") if "json" in ct else body), ct
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null"), ""

    def ok(self, method, path, body=None, **kw):
        st, r, _ = self.call(method, path, body, **kw)
        assert st == 200, (method, path, st, r)
        return r

    def login(self, login, password="test"):
        st, r, _ = self.call("POST", "/api/login", {"login": login, "password": password})
        for c in self.jar:  # cookie je Secure; prohlížeč ji na localhostu posílá, urllib ne
            c.secure = False
        return st, r


passed = 0


def check(name, cond, info=None):
    global passed
    if not cond:
        print(f"FAIL: {name}  {info if info is not None else ''}")
        sys.exit(1)
    passed += 1
    print(f"ok   {name}")


def png(w=3, h=2):
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


L = Client()  # Lenka
R = Client()  # Roman
A = Client()  # nepřihlášený

# --- přihlášení ---
check("bez přihlášení 401", A.call("GET", "/api/tree")[0] == 401)
check("špatné heslo 401", A.login("lenka", "x")[0] == 401)
check("neznámý uživatel 401", A.login("pepa", "test")[0] == 401)
st, r = L.login("Lenka ")
check("přihlášení Lenky (jméno bez ohledu na velikost a mezery)", st == 200 and r["user"]["name"] == "Lenka", r)
st, r = R.login("roman")
check("přihlášení Romana", st == 200 and r["user"]["female"] is False, r)
me = L.ok("GET", "/api/me")
check("me: oba uživatelé", [u["name"] for u in me["users"]] == ["Lenka", "Roman"], me["users"])
check("me: klíč VAPID", len(me["push"]["key"]) == 87, me["push"])
LID, RID = me["user"]["id"], [u["id"] for u in me["users"] if u["login"] == "roman"][0]

# --- složky ---
trip = L.ok("POST", "/api/folders", {"name": "  Dovolená  "})["folder"]
check("složka: název oříznutý", trip["name"] == "Dovolená", trip)
cro = L.ok("POST", "/api/folders", {"name": "Chorvatsko", "parent_id": trip["id"]})["folder"]
check("podsložka", cro["parent_id"] == trip["id"])
gifts = R.ok("POST", "/api/folders", {"name": "Dárky"})["folder"]
check("složka bez názvu 400", L.call("POST", "/api/folders", {"name": " "})[0] == 400)
check("podsložka v neexistující 404", L.call("POST", "/api/folders", {"name": "x", "parent_id": 9999})[0] == 404)
check("složka do vlastní podsložky 400", L.call("PUT", f"/api/folders/{trip['id']}", {"parent_id": cro["id"]})[0] == 400)
check("složka do sebe 400", L.call("PUT", f"/api/folders/{trip['id']}", {"parent_id": trip["id"]})[0] == 400)
f = L.ok("PUT", f"/api/folders/{gifts['id']}", {"name": "Dárky 2026", "parent_id": None})["folder"]
check("přejmenování složky", f["name"] == "Dárky 2026")

# --- dokumenty ---
d = L.ok("POST", "/api/docs", {"folder_id": cro["id"]})["doc"]
check("nový dokument: Bez názvu, verze 1", d["title"] == "Bez názvu" and d["version"] == 1 and d["body"] == "" and d["created_by"] == LID, d)
DOC = d["id"]
r = L.ok("PUT", f"/api/docs/{DOC}", {"title": "Plán 2027"})["doc"]
check("přejmenování nemění verzi", r["title"] == "Plán 2027" and r["version"] == 1, r)
body1 = "# Ubytování\n\n- apartmán **Makarska**\n- [ ] záloha"
r = L.ok("PUT", f"/api/docs/{DOC}", {"body": body1, "base_version": 1})["doc"]
check("uložení textu: verze 2", r["version"] == 2 and r["updated_by"] == LID, r)
st, r, _ = R.call("PUT", f"/api/docs/{DOC}", {"body": "jiný text", "base_version": 1})
check("souběžná úprava: 409 s aktuálním dokumentem", st == 409 and r["doc"]["version"] == 2 and r["doc"]["body"] == body1, (st, r))
check("bez base_version 400", R.call("PUT", f"/api/docs/{DOC}", {"body": "x"})[0] == 400)
body2 = body1 + "\n- [ ] trajekt"
r = R.ok("PUT", f"/api/docs/{DOC}", {"body": body2, "base_version": 2})["doc"]
check("Roman uloží na aktuální verzi", r["version"] == 3 and r["updated_by"] == RID, r)
r = R.ok("PUT", f"/api/docs/{DOC}", {"body": body2, "base_version": 3})["doc"]
check("stejný text = beze změny verze", r["version"] == 3, r)
full = L.ok("GET", f"/api/docs/{DOC}")["doc"]
check("načtení dokumentu", full["body"] == body2 and full["folder_id"] == cro["id"] and full["in_trash"] is False, full)
check("CRLF → LF", L.ok("PUT", f"/api/docs/{DOC}", {"body": body2.replace("\n", "\r\n"), "base_version": 3})["doc"]["version"] == 3)
tree = L.ok("GET", "/api/tree")
td = [x for x in tree["docs"] if x["id"] == DOC][0]
check("strom: náhled bez značek", td["preview"] == "Ubytování · apartmán Makarska · záloha · trajekt", td["preview"])
check("strom: složky", {x["name"] for x in tree["folders"]} == {"Dovolená", "Chorvatsko", "Dárky 2026"})
L.ok("PUT", f"/api/docs/{DOC}", {"pinned": True})
check("připnutí", [x for x in L.ok("GET", "/api/tree")["docs"] if x["id"] == DOC][0]["pinned"] is True)
check("neexistující dokument 404", L.call("GET", "/api/docs/9999")[0] == 404)
check("neexistující složka u dokumentu 404", L.call("PUT", f"/api/docs/{DOC}", {"folder_id": 9999})[0] == 404)

# --- historie verzí ---
revs = L.ok("GET", f"/api/docs/{DOC}/revisions")["revisions"]
check("historie: Lenčiny úpravy v jedné verzi, Romanova zvlášť", [x["user_id"] for x in revs] == [RID, LID], revs)
rv = L.ok("GET", f"/api/revisions/{revs[0]['id']}")["revision"]
check("verze: text a předchozí text", rv["body"] == body2 and rv["prev_body"] == body1, rv)
r = L.ok("POST", f"/api/revisions/{revs[1]['id']}/restore")["doc"]
check("obnovení verze: nová verze", r["version"] == 4, r)
check("obnovení verze: text", L.ok("GET", f"/api/docs/{DOC}")["doc"]["body"] == body1)
revs = L.ok("GET", f"/api/docs/{DOC}/revisions")["revisions"]
check("obnovení je v historii jako nová verze", len(revs) == 3 and revs[0]["user_id"] == LID, revs)
R.ok("PUT", f"/api/docs/{DOC}", {"body": body2, "base_version": 4})

# --- přítomnost ---
R.ok("POST", f"/api/docs/{DOC}/ping", {"editing": True})
p = L.ok("POST", f"/api/docs/{DOC}/ping", {})["doc"]
check("přítomnost: Lenka vidí, že Roman píše", p["others"] == [{"user_id": RID, "editing": True}] and p["version"] == 5, p)
check("ping bez těla", L.call("POST", f"/api/docs/{DOC}/ping")[0] == 200)
R.ok("POST", f"/api/docs/{DOC}/leave")
check("po odchodu nikdo", L.ok("POST", f"/api/docs/{DOC}/ping", {})["doc"]["others"] == [])
L.ok("POST", f"/api/docs/{DOC}/leave")

# --- hledání ---
g = R.ok("POST", "/api/docs", {"title": "Dárky pro děti", "folder_id": gifts["id"], "body": "Lego pro Toníka\n\nKnížka o dinosaurech"})["doc"]
res = L.ok("GET", "/api/search?q=darky")["results"]
check("hledání bez diakritiky v názvu", [x["id"] for x in res] == [g["id"]], res)
res = L.ok("GET", "/api/search?q=DINOSAUR")["results"]
check("hledání v textu + úryvek", len(res) == 1 and "dinosaurech" in res[0]["snippet"], res)
res = L.ok("GET", "/api/search?q=lego%20knizka")["results"]
check("hledání víc slov (všechna)", len(res) == 1, res)
check("hledání: jeden znak nic", L.ok("GET", "/api/search?q=a")["results"] == [])
res = L.ok("GET", "/api/search?q=100%25")["results"]
check("hledání se znakem %", res == [], res)

# --- koš ---
L.ok("DELETE", f"/api/docs/{g['id']}")
check("smazaný dokument není ve stromu", g["id"] not in [x["id"] for x in L.ok("GET", "/api/tree")["docs"]])
check("smazaný dokument se nehledá", L.ok("GET", "/api/search?q=lego")["results"] == [])
t = L.ok("GET", "/api/trash")
check("koš: dokument", [x["id"] for x in t["docs"]] == [g["id"]] and t["docs"][0]["deleted_by"] == LID, t)
check("smazaný dokument nejde upravit", L.call("PUT", f"/api/docs/{g['id']}", {"title": "x"})[0] == 404)
L.ok("POST", f"/api/docs/{g['id']}/restore")
check("obnovení dokumentu", g["id"] in [x["id"] for x in L.ok("GET", "/api/tree")["docs"]])
check("natrvalo jen z koše", L.call("DELETE", f"/api/trash/docs/{g['id']}")[0] == 400)
L.ok("DELETE", f"/api/folders/{trip['id']}")
tree = L.ok("GET", "/api/tree")
check("smazaná složka: zmizí i podsložka a dokumenty v ní", {x["name"] for x in tree["folders"]} == {"Dárky 2026"} and DOC not in [x["id"] for x in tree["docs"]], tree)
check("dokument ve smazané složce se nehledá", L.ok("GET", "/api/search?q=trajekt")["results"] == [])
t = L.ok("GET", "/api/trash")
check("koš: jen horní smazaná složka s počtem dokumentů", [(x["name"], x["docs"]) for x in t["folders"]] == [("Dovolená", 1)], t)
check("dokument ve smazané složce: v koši", L.ok("GET", f"/api/docs/{DOC}")["doc"]["in_trash"] is True)
check("do smazané složky nejde přidat", L.call("POST", "/api/docs", {"folder_id": cro["id"]})[0] == 404)
L.ok("POST", f"/api/folders/{trip['id']}/restore")
tree = L.ok("GET", "/api/tree")
check("obnovení složky i s obsahem", DOC in [x["id"] for x in tree["docs"]] and len(tree["folders"]) == 3)
# dokument smazaný, pak jeho složka natrvalo → obnovený dokument jde do kořene
tmpf = L.ok("POST", "/api/folders", {"name": "Dočasná"})["folder"]
tmpd = L.ok("POST", "/api/docs", {"folder_id": tmpf["id"], "title": "Osiřelý"})["doc"]
L.ok("DELETE", f"/api/docs/{tmpd['id']}")
L.ok("DELETE", f"/api/folders/{tmpf['id']}")
check("natrvalo jen složku z koše", L.call("DELETE", f"/api/trash/folders/{gifts['id']}")[0] == 404)
L.ok("DELETE", f"/api/trash/folders/{tmpf['id']}")
check("složka smazaná natrvalo", tmpf["id"] not in [x["id"] for x in L.ok("GET", "/api/trash")["folders"]])
check("dokumenty ve složce smazané natrvalo jsou pryč", L.call("GET", f"/api/docs/{tmpd['id']}")[0] == 404)
tmp2 = L.ok("POST", "/api/docs", {"title": "Do koše"})["doc"]
L.ok("DELETE", f"/api/docs/{tmp2['id']}")
check("vysypat koš", L.ok("DELETE", "/api/trash")["deleted"] == 1 and L.call("GET", f"/api/docs/{tmp2['id']}")[0] == 404)

# --- duplikát ---
dup = L.ok("POST", f"/api/docs/{DOC}/duplicate")["doc"]
check("duplikát: název, text, složka", dup["title"] == "Plán 2027 (kopie)" and dup["body"] == body2 and dup["folder_id"] == cro["id"], dup)

# --- obrázky ---
st, r, _ = L.call("POST", f"/api/images?doc={DOC}&name=fotka", raw=png(), ctype="image/png")
check("nahrání obrázku", st == 200 and r["src"] == f"img/{r['id']}" and r["width"] == 3, (st, r))
IMG = r["id"]
st, data, ct = L.call("GET", f"/api/img/{IMG}")
check("obrázek: vydá ho jen přihlášenému", st == 200 and ct == "image/png" and data == png(), (st, ct))
check("obrázek bez přihlášení 401", A.call("GET", f"/api/img/{IMG}")[0] == 401)
check("neobrázek 400", L.call("POST", "/api/images", raw=b"<?php echo 1;", ctype="image/png")[0] == 400)
check("prázdný soubor 400", L.call("POST", "/api/images", raw=b"", ctype="image/png")[0] == 400)
check("neexistující obrázek 404", L.call("GET", "/api/img/9999")[0] == 404)
# obrázek v kopii dokumentu přežije smazání originálu natrvalo
cur = L.ok("GET", f"/api/docs/{dup['id']}")["doc"]
L.ok("PUT", f"/api/docs/{dup['id']}", {"body": cur["body"] + f"\n\n![fotka](img/{IMG})", "base_version": cur["version"]})
own = L.ok("POST", "/api/docs", {"title": "S obrázkem"})["doc"]
st, r2, _ = L.call("POST", f"/api/images?doc={own['id']}", raw=png(2, 2), ctype="image/png")
L.ok("PUT", f"/api/docs/{own['id']}", {"body": f"![]({r2['src']})", "base_version": 1})
L.ok("DELETE", f"/api/docs/{own['id']}")
L.ok("DELETE", f"/api/trash/docs/{own['id']}")
check("obrázek smazán s dokumentem", L.call("GET", f"/api/img/{r2['id']}")[0] == 404)

# --- upozornění na změny (plánovač) ---
check("plánovač bez tokenu 401", A.call("GET", "/api/cron")[0] == 401)
A.ok("GET", "/api/cron?quiet=0", token=CRON)  # vyřídit dosavadní změny
cur = R.ok("GET", f"/api/docs/{DOC}")["doc"]
R.ok("PUT", f"/api/docs/{DOC}", {"body": cur["body"] + "\n- [ ] opalovací krém\n- [ ] plavky", "base_version": cur["version"]})
check("plánovač čeká na klid po úpravách", A.ok("GET", "/api/cron?quiet=60", token=CRON)["sent"] == [])
sent = A.ok("GET", "/api/cron?quiet=0", token=CRON)["sent"]
check("upozornění pro Lenku", len(sent) == 1 and sent[0]["to"] == [LID], sent)
check("text upozornění", sent[0]["message"]["title"] == "Roman upravil „Plán 2027“" and sent[0]["message"]["body"] == "+ opalovací krém · plavky", sent[0]["message"])
check("odkaz z upozornění", sent[0]["message"]["url"] == f"./#/d/{DOC}")
check("podruhé se neposílá", A.ok("GET", "/api/cron?quiet=0", token=CRON)["sent"] == [])
L.ok("POST", f"/api/docs/{DOC}/ping", {})
cur = L.ok("GET", f"/api/docs/{DOC}")["doc"]
R.ok("PUT", f"/api/docs/{DOC}", {"body": cur["body"] + "\nnavíc", "base_version": cur["version"]})
sent = A.ok("GET", "/api/cron?quiet=0", token=CRON)["sent"]
check("kdo má dokument otevřený, upozornění nedostane", len(sent) == 1 and sent[0]["to"] == [], sent)
L.ok("POST", f"/api/docs/{DOC}/leave")
nd = L.ok("POST", "/api/docs", {"title": "Nákup", "body": "mléko"})["doc"]
sent = A.ok("GET", "/api/cron?quiet=0", token=CRON)["sent"]
check("nový dokument: „Lenka vytvořila“ pro Romana", [(x["to"], x["message"]["title"]) for x in sent] == [([RID], "Lenka vytvořila „Nákup“")], sent)
L.ok("PUT", f"/api/docs/{nd['id']}", {"title": "Nákup sobota"})
sent = A.ok("GET", "/api/cron?quiet=0", token=CRON)["sent"]
check("přejmenování", sent and sent[0]["message"]["title"] == "Lenka přejmenovala „Nákup“", sent)
cur = L.ok("GET", f"/api/docs/{nd['id']}")["doc"]
L.ok("PUT", f"/api/docs/{nd['id']}", {"body": "", "base_version": cur["version"]})
sent = A.ok("GET", "/api/cron?quiet=0", token=CRON)["sent"]
check("smazané řádky", sent and sent[0]["message"]["body"] == "smazala 1 řádek", sent)

# --- záloha ---
b = L.ok("GET", "/api/backup")
check("záloha: dokumenty s textem i složky", any(x["id"] == DOC and "opalovací" in x["body"] for x in b["docs"]) and len(b["folders"]) >= 3 and b["images"], list(b))

# --- upozornění: přihlášení zařízení ---
check("neplatné zařízení 400", L.call("POST", "/api/push/subscribe", {"endpoint": "http://x"})[0] == 400)

# --- změna hesla ---
check("heslo: špatné současné 400", R.call("PUT", "/api/me/password", {"old": "x", "new": "novéheslo"})[0] == 400)
check("heslo: krátké 400", R.call("PUT", "/api/me/password", {"old": "test", "new": "abc"})[0] == 400)
R2 = Client()
R2.login("roman")
R.ok("PUT", "/api/me/password", {"old": "test", "new": "novéheslo"})
for c in R.jar:
    c.secure = False
check("po změně hesla zůstane přihlášený", R.call("GET", "/api/me")[0] == 200)
check("jiné zařízení se odhlásí", R2.call("GET", "/api/me")[0] == 401)
check("staré heslo neplatí", Client().login("roman", "test")[0] == 401)
check("nové heslo platí", Client().login("roman", "novéheslo")[0] == 200)

print(f"\nVšech {passed} testů API prošlo.")
