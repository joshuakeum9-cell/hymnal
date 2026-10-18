"""Praise songs in the public repo, sealed: data/praise/*/song.abc and meta.json live in git only as
data/praise.vault (zip, then AES-GCM under a random 256-bit key). The key is the PRAISE_KEY Actions
secret; locally work/praise-key.txt (made by `seal` the first time). data/praise/ itself is ignored.

Usage: python tools/praise_vault.py seal     data/praise -> data/praise.vault
       python tools/praise_vault.py open     data/praise.vault -> data/praise (skips without a key)
"""
from __future__ import annotations

import glob
import hashlib
import hmac
import io
import os
import secrets
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAULT = os.path.join(ROOT, "data/praise.vault")
KEY_FILE = os.path.join(ROOT, "work/praise-key.txt")
FILES = ("song.abc", "meta.json")


def key(create: bool = False) -> bytes | None:
    hexkey = os.environ.get("PRAISE_KEY", "").strip()
    if not hexkey and os.path.exists(KEY_FILE):
        hexkey = open(KEY_FILE, encoding="utf-8").read().strip()
    if not hexkey and create:
        hexkey = secrets.token_hex(32)
        os.makedirs(os.path.dirname(KEY_FILE), exist_ok=True)
        with open(KEY_FILE, "w", encoding="utf-8") as fh:
            fh.write(hexkey)
    return bytes.fromhex(hexkey) if hexkey else None


def seal() -> None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for d in sorted(glob.glob(os.path.join(ROOT, "data/praise/[0-9]*"))):
            for name in FILES:
                path = os.path.join(d, name)
                info = zipfile.ZipInfo(f"{os.path.basename(d)}/{name}", date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, open(path, "rb").read())  # fixed dates: an unchanged song set seals the same
    body = buf.getvalue()
    k = key(create=True)
    iv = hmac.new(k, body, hashlib.sha256).digest()[:12]
    with open(VAULT, "wb") as fh:
        fh.write(iv + AESGCM(k).encrypt(iv, body, None))
    print(f"sealed {len(glob.glob(os.path.join(ROOT, 'data/praise/[0-9]*')))} songs into data/praise.vault")


def open_vault() -> None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    k = key()
    if not k or not os.path.exists(VAULT):
        print("no praise key or vault: building without praise songs")
        return
    box = open(VAULT, "rb").read()
    body = AESGCM(k).decrypt(box[:12], box[12:], None)
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        for name in z.namelist():
            out = os.path.join(ROOT, "data/praise", name)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "wb") as fh:
                fh.write(z.read(name))
    print(f"opened {len(z.namelist()) // len(FILES)} praise songs")


if __name__ == "__main__":
    {"seal": seal, "open": open_vault}[sys.argv[1]]()
