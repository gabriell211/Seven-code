#!/usr/bin/env python3
"""Build a signed-source Kerberos/GSSAPI Android Bionic SDK from Termux.

This is an NDK build input, not a release artifact. The signed Packages index
and each .deb SHA256 are validated with the pinned Termux signing key.
All transitively needed Termux packages are fetched; no system glibc libraries
or unverified package mirrors are accepted.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile

SOURCE = Path(__file__).with_name("fetch-bionic-node.py")
spec = importlib.util.spec_from_file_location("seven_verified_termux", SOURCE)
repo = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(repo)

MAX_PACKAGES = 65
# Packages supplied by the Android system/Termux virtual environment rather
# than installable concrete aarch64 packages from the signed index.
IGNORABLE = {"android-api", "termux-api", "termux-am", "termux-tools"}


def requested(dependencies: str) -> list[str]:
    result = []
    for group in dependencies.split(","):
        # A signed Debian Depends may have alternatives and version ranges.
        # Choose only the first available actual package when resolving it.
        alternatives = []
        for option in group.split("|"):
            name = re.split(r"\s*\(|\s*\[|\s*<", option.strip(), maxsplit=1)[0]
            if name:
                alternatives.append(name)
        if alternatives:
            result.append(alternatives)
    return result


def get_dependencies(name, signed):
    record = signed[name]
    return requested(record.get("Depends", "")) + requested(record.get("Pre-Depends", ""))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    key = Path(__file__).with_name("termux-repository-key.asc")
    assert key.is_file(), "Pinned Termux signing key missing"
    with tempfile.TemporaryDirectory(prefix="seven-kerberos-verified-") as td:
        work = Path(td)
        records = repo.verify_signed_index(work, key)
        packages = ["krb5"]
        selected = set(packages)
        for name in packages:
            require = get_dependencies(name, records)
            for alternatives in require:
                dependency = next((x for x in alternatives if x in records), None)
                if dependency is None:
                    if any(x in IGNORABLE for x in alternatives):
                        continue
                    raise RuntimeError("Missing concrete signed Termux dependency of " +
                                       name + ": " + str(alternatives))
                if dependency not in selected:
                    packages.append(dependency)
                    selected.add(dependency)
                    if len(packages) > MAX_PACKAGES:
                        raise RuntimeError("Exceeded bounded signed Termux dependency set")
        destination_headers = out / "include"
        destination_libs = out / "libs"
        destination_headers.mkdir(exist_ok=True)
        destination_libs.mkdir(exist_ok=True)
        manifest = {}
        archive_root = work / "packages"
        for name in packages:
            p = records[name]
            filename = p.get("Filename", "")
            sha = p.get("SHA256", "")
            if not filename.startswith("pool/") or not re.fullmatch("[0-9a-f]{64}", sha):
                raise RuntimeError("Unsigned dependency: " + name)
            archive = work / ("download-" + str(len(manifest)) + ".deb")
            repo.fetch(filename, archive)
            if repo.digest(archive) != sha:
                raise RuntimeError("Termux signed package SHA mismatch: " + name)
            unpacked = archive_root / name
            unpacked.mkdir(parents=True)
            repo.run("dpkg-deb", "-x", str(archive), str(unpacked))
            manifest[name] = {"version": p.get("Version"), "sha256": sha,
                              "filename": filename}
            for file in unpacked.rglob("*"):
                if not file.is_file():
                    continue
                # Keep the header tree layout, never copy symlinks outside it.
                pieces = file.parts
                if "include" in pieces:
                    off = pieces.index("include")
                    relative = Path(*pieces[off + 1:])
                    if relative.parts and file.suffix in (".h", ".hpp"):
                        target = destination_headers / relative
                        target.parent.mkdir(parents=True, exist_ok=True)
                        if target.exists() and repo.digest(target) != repo.digest(file):
                            raise RuntimeError("Conflicting Kerberos headers: " + str(relative))
                        shutil.copy2(file, target)
                if ".so" not in file.name:
                    continue
                with file.open("rb") as data:
                    if data.read(4) != b"\x7fELF":
                        continue
                target = destination_libs / file.name
                if target.exists():
                    if repo.digest(target) != repo.digest(file):
                        raise RuntimeError("Conflicting Termux ABI libraries: " + file.name)
                    continue
                # Enforce Android 64-bit AArch64, and forbid glibc imports.
                needed = repo.abi_details(file)
                shutil.copy2(file, target)
            print("Signed Termux SDK package:", name, p.get("Version"))
        headers = [destination_headers / "krb5.h",
                   destination_headers / "gssapi/gssapi.h"]
        for header in headers:
            if not header.is_file():
                raise RuntimeError("Signed krb5 SDK is missing: " + str(header))
        libs = {f.name: f for f in destination_libs.iterdir()}
        if not any(name.startswith("libgssapi_krb5.so") for name in libs):
            raise RuntimeError("Signed Kerberos runtime lacks libgssapi_krb5")
        if not any(name.startswith("libkrb5.so") for name in libs):
            raise RuntimeError("Signed Kerberos runtime lacks libkrb5")
        unresolved = {}
        available = set(libs) | repo.SYSTEM_LIBS
        for name, file in libs.items():
            missing = [x for x in repo.abi_details(file) if x not in available]
            if missing:
                unresolved[name] = missing
        if unresolved:
            raise RuntimeError("Termux Kerberos SDK dependency closure incomplete: " +
                               json.dumps(unresolved, sort_keys=True))
        metadata = {
            "signerFingerprint": repo.FINGERPRINT,
            "indexOrigin": repo.ORIGIN,
            "packages": manifest,
            "libraries": {name: repo.digest(file) for name, file in sorted(libs.items())},
        }
        (out / "kerberos-provenance.json").write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n")
        print("Android Bionic Kerberos SDK verified:",
              len(manifest), "packages and", len(libs), "ELF libraries")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("ANDROID KERBEROS SDK FAILED:", str(error), file=sys.stderr)
        raise
