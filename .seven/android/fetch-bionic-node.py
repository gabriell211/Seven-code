#!/usr/bin/env python3
"""Fetch Termux-maintained Android/Bionic ARM64 Node with signed provenance.

The Code OSS server's JavaScript can be built on Linux/ARM64, but its
Node executable must target Android's Bionic loader. This stage deliberately
builds a separate artifact until native Code OSS addons are qualified.
"""
import argparse
import datetime
import email.utils
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

REPOSITORY = os.environ.get(
    "TERMUX_MAIN_URL", "https://packages-cf.termux.dev/apt/termux-main"
).rstrip("/")
FINGERPRINT = "CC72CF8BA7DBFA0182877D045A897D96E57CF20C"
ORIGIN = "termux-main stable"
INDEX_ENTRY = "main/binary-aarch64/Packages"
PACKAGES = ("nodejs-lts", "libc++", "openssl", "c-ares", "libicu",
            "libsqlite", "zlib")
SYSTEM_LIBS = {
    "libc.so", "libdl.so", "libm.so", "liblog.so", "libandroid.so",
    "libstdc++.so", "libz.so", "libpthread.so", "librt.so",
    "libunwind.so", "libmediandk.so", "libgcc.so"
}


def run(*argv, env=None, **kwargs):
    return subprocess.run(argv, check=True, capture_output=True,
                          text=True, env=env, **kwargs)


def fetch(relative, target):
    url = REPOSITORY + "/" + relative.lstrip("/")
    request = urllib.request.Request(
        url, headers={"User-Agent": "Seven-Code-Bionic-Artifact-Builder/1.0"}
    )
    with urllib.request.urlopen(request, timeout=90) as stream:
        with target.open("wb") as out:
            shutil.copyfileobj(stream, out, length=128 * 1024)
    if target.stat().st_size == 0:
        raise RuntimeError("Downloaded empty file: " + url)
    print("Downloaded", relative, target.stat().st_size, "bytes")


def digest(path):
    sha = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def parse_control(text):
    parsed = {}
    for stanza in re.split(r"\n\s*\n", text):
        if not stanza.strip():
            continue
        result = {}
        for line in stanza.splitlines():
            if line.startswith((" ", "\t")):
                continue
            if ": " in line:
                key, val = line.split(": ", 1)
                result[key] = val.strip()
        if result.get("Package"):
            parsed[result["Package"]] = result
    return parsed


def verify_signed_index(directory, key):
    inrelease = directory / "InRelease"
    packages = directory / "Packages"
    fetch("dists/stable/InRelease", inrelease)
    fetch("dists/stable/" + INDEX_ENTRY, packages)
    with tempfile.TemporaryDirectory(prefix="seven-termux-gpg-") as gnupg:
        Path(gnupg).chmod(0o700)
        env = dict(os.environ, GNUPGHOME=gnupg)
        run("gpg", "--batch", "--import", str(key), env=env)
        keys = run("gpg", "--batch", "--with-colons", "--fingerprint",
                   env=env).stdout
        if FINGERPRINT not in keys.replace(":", "").upper():
            raise RuntimeError("Termux signing key fingerprint mismatch")
        result = run("gpg", "--batch", "--status-fd", "2", "--decrypt",
                     str(inrelease), env=env)
        signed_by = re.search(r"\[GNUPG:\] VALIDSIG ([A-Fa-f0-9]{40})",
                              result.stderr)
        if not signed_by or signed_by.group(1).upper() != FINGERPRINT:
            raise RuntimeError("Termux InRelease not signed by pinned key")
        payload = result.stdout
    if not re.search(r"(?m)^Origin: " + re.escape(ORIGIN) + r"$", payload):
        raise RuntimeError("Signed index was not published for termux-main stable")
    match = re.search(r"(?m)^Date: (.+)$", payload)
    if not match:
        raise RuntimeError("Signed index has no freshness date")
    updated = email.utils.parsedate_to_datetime(match.group(1))
    age = datetime.datetime.now(datetime.timezone.utc) - updated
    if age > datetime.timedelta(days=30) or age < datetime.timedelta(days=-2):
        raise RuntimeError("Signed Termux index is stale or future dated")
    sha_section = re.search(r"(?ms)^SHA256:\n((?: [^\n]+\n)+)", payload)
    if not sha_section:
        raise RuntimeError("Signed index lacks SHA256 entries")
    index_hash = None
    for line in sha_section.group(1).splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[2] == INDEX_ENTRY:
            index_hash = parts[0]
            break
    if index_hash is None or digest(packages) != index_hash:
        raise RuntimeError("Packages index does not match signed InRelease SHA256")
    print("Verified Termux repository signature", FINGERPRINT)
    return parse_control(packages.read_text(errors="replace"))


def abi_details(path):
    with path.open("rb") as fh:
        data = fh.read(64)
    if len(data) < 64 or data[:4] != b"\x7fELF" or data[4] != 2:
        raise RuntimeError("Not a valid ELF64: " + str(path))
    if struct.unpack_from("<H", data, 18)[0] != 183:
        raise RuntimeError("Not an ARM64 Android ELF: " + str(path))
    dyn = run("readelf", "-d", str(path)).stdout
    ver = run("readelf", "--version-info", str(path)).stdout
    if "GLIBC_" in ver or "libc.so.6" in dyn:
        raise RuntimeError("glibc ELF in Android runtime: " + str(path))
    needed = re.findall(r"Shared library: \[([^\]]+)\]", dyn)
    return needed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    parser.add_argument("--expected-major", type=int, default=24)
    args = parser.parse_args()
    destination = args.destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    source_dir = Path(__file__).resolve().parent
    key_file = source_dir / "termux-repository-key.asc"
    if not key_file.is_file():
        raise RuntimeError("Pinned Termux signing key not found")
    with tempfile.TemporaryDirectory(prefix="seven-android-node-") as temporary:
        root = Path(temporary)
        index = verify_signed_index(root, key_file)
        components = {}
        for package in PACKAGES:
            item = index.get(package)
            if item is None:
                raise RuntimeError(f"Missing signed-index package {package}")
            path = item.get("Filename", "")
            expected = item.get("SHA256", "")
            if not path.startswith("pool/") or not re.fullmatch("[0-9a-f]{64}", expected):
                raise RuntimeError("Unsigned/unexpected Termux package " + package)
            archive = root / (package.replace("+", "-") + ".deb")
            fetch(path, archive)
            if digest(archive) != expected:
                raise RuntimeError("Termux .deb SHA256 mismatch: " + package)
            directory = root / "packages" / package.replace("+", "-")
            directory.mkdir(parents=True, exist_ok=True)
            run("dpkg-deb", "-x", str(archive), str(directory))
            components[package] = {"version": item.get("Version"),
                                   "sha256": expected, "filename": path}
        node_root = root / "packages" / "nodejs-lts"
        binaries = [p for p in node_root.rglob("node") if p.is_file()]
        if len(binaries) != 1:
            raise RuntimeError(f"Expected one Termux Node binary, found {binaries}")
        binary = binaries[0]
        node_version = components["nodejs-lts"]["version"].split("-", 1)[0]
        if int(node_version.split(".")[0]) != args.expected_major:
            raise RuntimeError(
                f"Termux Bionic Node {node_version} is not expected Node {args.expected_major}.x"
            )
        executable = destination / "libnode.so"
        shutil.copy2(binary, executable)
        executable.chmod(0o755)
        header = run("readelf", "-l", str(executable)).stdout
        if "/system/bin/linker64" not in header:
            raise RuntimeError("Termux Node is not linked for the Android Bionic loader")
        library_root = destination / "libs"
        library_root.mkdir(exist_ok=True)
        # Libraries can have a versioned SONAME (libicuuc.so.78); APK
        # JNI packing discards these names. Keep the exact names in an
        # Android asset ZIP, then extract under the app's private directory.
        for package in PACKAGES:
            folder = root / "packages" / package.replace("+", "-")
            for file in folder.rglob("*"):
                if not file.is_file() or ".so" not in file.name:
                    continue
                with file.open("rb") as fh:
                    if fh.read(4) != b"\x7fELF":
                        continue
                dest = library_root / file.name
                if dest.exists():
                    if digest(file) != digest(dest):
                        raise RuntimeError("Conflicting Termux libraries: " + file.name)
                    continue
                shutil.copy2(file, dest)
        available = {x.name for x in library_root.iterdir()}
        unresolved = {}
        for file in [executable, *library_root.iterdir()]:
            needed = abi_details(file)
            missing = [name for name in needed
                       if name not in available and name not in SYSTEM_LIBS]
            if missing:
                unresolved[file.name] = missing
        if unresolved:
            raise RuntimeError("Missing native Android shared libraries: " +
                               json.dumps(unresolved))
        # Node's upstream MIT and third-party notices must travel with the
        # runtime. An HTTPS source tag is bound to the verified package version.
        license_path = destination / "NOTICE-node.txt"
        with urllib.request.urlopen(
            f"https://raw.githubusercontent.com/nodejs/node/v{node_version}/LICENSE",
            timeout=45
        ) as req:
            license_text = req.read(2_000_000)
        if b"Node.js" not in license_text or len(license_text) < 1_000:
            raise RuntimeError("Node license is missing or unexpectedly short")
        license_path.write_bytes(license_text)
        # Include Termux package copyright notices if they exist.
        for package in PACKAGES:
            folder = root / "packages" / package.replace("+", "-")
            notices = [p for p in folder.rglob("*")
                       if p.is_file() and p.name.upper() in
                       ("COPYRIGHT", "LICENSE", "LICENSE.TXT")]
            if notices:
                target = destination / "notices" / package
                target.mkdir(parents=True, exist_ok=True)
                for entry in notices[:30]:
                    if entry.stat().st_size < 1_000_000:
                        shutil.copy2(entry, target / entry.name)
        with zipfile.ZipFile(destination / "android-libs.zip", "w",
                             compression=zipfile.ZIP_DEFLATED) as zipped:
            for file in sorted(library_root.iterdir()):
                zipped.write(file, file.name)
        manifest = {
            "platform": "android-bionic-arm64",
            "node": node_version,
            "signerFingerprint": FINGERPRINT,
            "indexOrigin": ORIGIN,
            "nodeSha256": digest(executable),
            "libraries": {x.name: digest(x) for x in library_root.iterdir()},
            "packages": components
        }
        (destination / "provenance.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n"
        )
        print("Verified Bionic Node", node_version, "with",
              len(available), "runtime libraries.")


if __name__ == "__main__":
    try:
        main()
    except (Exception, subprocess.CalledProcessError) as error:
        print("ANDROID NODE BUILD FAILED:", str(error), file=sys.stderr)
        raise
