#!/usr/bin/env python3
"""Merge a signed-source Termux Kerberos dependency closure into Bionic Node ZIP.

Everything is embedded in the ONE APK. The merge is rejected on missing,
modified or conflicting SONAMEs. Do not claim this validates Copilot.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tempfile
import zipfile

def sha(data):
    return hashlib.sha256(data).hexdigest()

def valid_zip(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        files = {}
        for info in z.infolist():
            name = info.filename
            if not re.fullmatch(r"[A-Za-z0-9._+\-]{1,255}", name) or ".so" not in name:
                raise RuntimeError("Unexpected Bionic library archive entry: " + name)
            if name in files:
                raise RuntimeError("Duplicate native library: " + name)
            files[name] = z.read(info)
        return files

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("node_bundle", type=Path)
    parser.add_argument("kerberos_addons", type=Path)
    args = parser.parse_args()
    root = args.node_bundle.resolve()
    addons = args.kerberos_addons.resolve()
    node_provenance = json.loads((root / "provenance.json").read_text())
    kerberos_provenance = json.loads((addons / "kerberos-provenance.json").read_text())
    assert node_provenance["platform"] == "android-bionic-arm64"
    assert kerberos_provenance["signerFingerprint"] == node_provenance["signerFingerprint"]
    assert kerberos_provenance["indexOrigin"] == node_provenance["indexOrigin"]
    node_libs = valid_zip((root / "android-libs.zip").read_bytes())
    krb_libs = valid_zip((addons / "kerberos-libs.zip").read_bytes())
    assert set(node_libs) == set(node_provenance["libraries"])
    assert set(krb_libs) == set(kerberos_provenance["libraries"])
    for name, bytes in node_libs.items():
        if sha(bytes) != node_provenance["libraries"][name]:
            raise RuntimeError("Node Bionic library hash mismatch: " + name)
    for name, bytes in krb_libs.items():
        if sha(bytes) != kerberos_provenance["libraries"][name]:
            raise RuntimeError("Kerberos Bionic library hash mismatch: " + name)
        if name in node_libs and node_libs[name] != bytes:
            raise RuntimeError("Conflicting Kerberos/native Node shared library: " + name)
        node_libs[name] = bytes
    with zipfile.ZipFile(root / "android-libs.zip", "w",
                         compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(node_libs.items()):
            archive.writestr(name, content)
    node_provenance["libraries"] = {name: sha(data) for name, data in sorted(node_libs.items())}
    node_provenance["kerberosSources"] = kerberos_provenance
    (root / "provenance.json").write_text(
        json.dumps(node_provenance, indent=2, sort_keys=True) + "\n"
    )
    print("Verified merged Android/Bionic libraries:",
          len(node_libs), "total, including", len(krb_libs), "Kerberos closure objects.")


if __name__ == "__main__":
    main()
