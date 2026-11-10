#!/usr/bin/env python3
"""Nahrání appky na WEDOS přes FTP (s TLS).

  python3 tools/deploy.py --dry-run     jen vypíše, co by se nahrálo
  python3 tools/deploy.py               nahraje změněné soubory
  python3 tools/deploy.py --all         nahraje všechno znovu

Konfigurace tools/deploy.json (není v gitu):
  {"host": "....wedos.net", "user": "...", "password": "...", "remote_dir": "/www/subdom/app/notes", "tls": true}
Obsah složky web/ jde do remote_dir (kromě data/ – obrázky na serveru se nepřepisují ani nemažou);
produkční konfigurace tools/out/env.prod.json (viz tools/make_env.py) se nahraje jako server/env.json.
"""
import argparse
import ftplib
import hashlib
import io
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
WEB = os.path.join(ROOT, "web")
CFG = os.path.join(ROOT, "tools", "deploy.json")
ENV_PROD = os.path.join(ROOT, "tools", "out", "env.prod.json")
CACHE = os.path.join(ROOT, "tools", "out", "deploy-cache.json")
SKIP = {"server/env.json", "server/env.example.json"}


class FTP_TLS_Reuse(ftplib.FTP_TLS):
    """WEDOS (vsftpd) vyžaduje u datového spojení stejnou TLS session jako u řídicího."""

    def ntransfercmd(self, cmd, rest=None):
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        if self._prot_p:
            conn = self.context.wrap_socket(conn, server_hostname=self.host, session=self.sock.session)
        return conn, size


def connect(cfg):
    ftp = FTP_TLS_Reuse(cfg["host"], timeout=60) if cfg.get("tls", True) else ftplib.FTP(cfg["host"], timeout=60)
    ftp.login(cfg["user"], cfg["password"])
    if isinstance(ftp, ftplib.FTP_TLS):
        ftp.prot_p()
    return ftp


def local_files():
    files = {}
    for base, dirs, names in os.walk(WEB):
        # skryté složky a data/ (lokální obrázky) se nenahrávají
        dirs[:] = [d for d in dirs if not d.startswith(".") and not (base == WEB and d == "data")]
        for n in names:
            full = os.path.join(base, n)
            rel = os.path.relpath(full, WEB).replace(os.sep, "/")
            if rel in SKIP:
                continue
            with open(full, "rb") as f:
                files[rel] = f.read()
    if not os.path.exists(ENV_PROD):
        sys.exit("Chybí tools/out/env.prod.json – nejdřív spusť tools/make_env.py")
    with open(ENV_PROD, "rb") as f:
        files["server/env.json"] = f.read()
    return files


def ensure_dir(ftp, path, known):
    parts = path.strip("/").split("/")
    cur = ""
    for p in parts:
        cur += "/" + p
        if cur in known:
            continue
        try:
            ftp.mkd(cur)
        except ftplib.error_perm:
            pass  # už existuje
        known.add(cur)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args()

    files = local_files()
    cache = {}
    if os.path.exists(CACHE) and not a.all:
        with open(CACHE, encoding="utf-8") as f:
            cache = json.load(f)
    changed = {rel: data for rel, data in files.items() if cache.get(rel) != hashlib.md5(data).hexdigest()}
    # PHP knihovny a .htaccess nejdřív, index.php a statické soubory potom
    order = sorted(changed, key=lambda r: (not r.startswith("server/lib/"), r != "server/.htaccess", r.startswith("server/index.php"), r))
    print(f"Ke nahrání: {len(order)} z {len(files)} souborů")
    for rel in order:
        print("  " + rel)
    if a.dry_run or not order:
        return

    with open(CFG, encoding="utf-8") as f:
        cfg = json.load(f)
    ftp = connect(cfg)
    remote = cfg["remote_dir"].rstrip("/")
    known = set()
    for rel in order:
        target = f"{remote}/{rel}"
        ensure_dir(ftp, os.path.dirname(target), known)
        ftp.storbinary(f"STOR {target}", io.BytesIO(changed[rel]))
        cache[rel] = hashlib.md5(changed[rel]).hexdigest()
        print(f"  nahráno {rel}")
        with open(CACHE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=1)
    ftp.quit()
    print("Hotovo.")


if __name__ == "__main__":
    main()
