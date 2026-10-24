#!/usr/bin/env python3
"""Verify that a Seven Code APK is fully standalone on Android ARM64.

Binary packaging qualification, NOT proof of successful editor/Copilot E2E.
All runtime components must be inside ONE Android APK, not in remote assets.
"""
import hashlib
import io
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import zipfile


REQUIRED_SERVER = (
    "out/server-main.js",
    "out/vs/code/browser/workbench/workbench.js",
    "out/vs/workbench/api/node/extensionHostProcess.js",
    "extensions/copilot/dist/extension.js",
    "extensions/seven-code-mobile-terminal/dist/browser/extension.js",
    "product.json",
    "LICENSE.txt",
    "ThirdPartyNotices.txt",
)

EXCLUDED_NATIVE_DIRS = (
    "/linux-x64/", "/darwin-", "/win32-", "/alpine-", "/x64/",
    "/ia32/", "/linux-armhf/"
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def safe_entries(archive):
    names = archive.namelist()
    require(len(names) <= 100_000, "Too many files in embedded archive")
    require(len(names) == len(set(names)), "Duplicate archive entries")
    for name in names:
        require(
            not name.startswith("/") and "\\" not in name and
            all(part not in (".", "..") for part in name.split("/")),
            "Path traversal in embedded server ZIP: " + name
        )
    return set(names)


def inspect_elf(data, label, work_dir, *, executable=False):
    require(len(data) >= 64 and data[:4] == b"\x7fELF", "Missing ELF: " + label)
    require(data[4] == 2 and data[5] == 1 and int.from_bytes(data[18:20], "little") == 183,
            "Expected 64-bit AArch64 ELF: " + label)
    path = pathlib.Path(work_dir) / ("inspect" + str(len(label)) + ".elf")
    path.write_bytes(data)
    try:
        dynamic = subprocess.run(
            ["readelf", "-d", str(path)], capture_output=True, text=True, check=True
        ).stdout
        symbols = subprocess.run(
            ["readelf", "--version-info", str(path)], capture_output=True,
            text=True, check=True
        ).stdout
        require("libc.so.6" not in dynamic and "libstdc++.so.6" not in dynamic and
                not re.search(r"GLIBC_[0-9]", symbols), "glibc ELF in APK: " + label)
        if executable:
            headers = subprocess.run(
                ["readelf", "-l", str(path)], capture_output=True,
                text=True, check=True
            ).stdout
            require("/system/bin/linker64" in headers,
                    "Node must have Android Bionic /system/bin/linker64 interpreter")
    finally:
        path.unlink(missing_ok=True)


def main(apk):
    require(apk.is_file() and apk.stat().st_size > 30_000_000,
            "Missing standalone APK (or thin client under 30 MB)")
    with tempfile.TemporaryDirectory(prefix="seven-release-audit-") as directory:
        server_zip = pathlib.Path(directory) / "server.zip"
        with zipfile.ZipFile(apk) as outer:
            files = safe_entries(outer)
            required = {
                "lib/arm64-v8a/libnode.so",
                "lib/arm64-v8a/libsevenpty.so",
                "assets/seven-local/server.zip",
                "assets/seven-local/server.sha256",
                "assets/seven-local/native-libs.zip",
                "assets/seven-local/termux-provenance.json",
                "assets/seven-local/NOTICE-node.txt"
            }
            require(not required - files, "APK missing embedded runtime: " +
                    ", ".join(sorted(required - files)))
            expected_server_hash = outer.read(
                "assets/seven-local/server.sha256"
            ).decode("ascii").strip()
            require(re.fullmatch(r"[a-f0-9]{64}", expected_server_hash) is not None,
                    "Invalid embedded server SHA256")
            digest = hashlib.sha256()
            with outer.open("assets/seven-local/server.zip") as source, server_zip.open("wb") as target:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    target.write(chunk)
                    require(target.tell() <= 500_000_000,
                            "Code OSS archive too large to install safely")
            require(digest.hexdigest() == expected_server_hash,
                    "Embedded Code OSS server archive SHA256 mismatch")
            require(server_zip.stat().st_size >= 30_000_000,
                    "Embedded Code OSS archive is unexpectedly small")
            provenance = json.loads(outer.read(
                "assets/seven-local/termux-provenance.json"
            ))
            require(provenance.get("platform") == "android-bionic-arm64",
                    "Bundled Node provenance is not Android/Bionic")
            node = outer.read("lib/arm64-v8a/libnode.so")
            require(len(node) >= 5_000_000 and sha256(node) == provenance.get("nodeSha256"),
                    "Bundled Node is missing or does not match signed-source provenance")
            inspect_elf(node, "Bionic Node", directory, executable=True)
            lib_data = outer.read("assets/seven-local/native-libs.zip")
            require(1_000_000 <= len(lib_data) <= 256_000_000,
                    "Missing Bionic native shared libraries")
            with zipfile.ZipFile(io.BytesIO(lib_data)) as libs:
                library_names = safe_entries(libs)
                expected_libs = provenance.get("libraries", {})
                require(expected_libs and library_names == set(expected_libs),
                        "Bionic native library set differs from signed-source manifest")
                for name in sorted(library_names):
                    content = libs.read(name)
                    require(sha256(content) == expected_libs[name],
                            "Bionic library integrity mismatch: " + name)
                    inspect_elf(content, "Bionic lib " + name, directory)

        with zipfile.ZipFile(server_zip) as server:
            server_files = safe_entries(server)
            require(not set(REQUIRED_SERVER) - server_files,
                    "Server in APK is incomplete: " +
                    ", ".join(sorted(set(REQUIRED_SERVER) - server_files)))
            require("node" not in server_files,
                    "GNU/Linux Node binary may not be bundled in Android Code OSS")
            identity = json.loads(server.read("product.json"))
            require(identity.get("nameShort") == "Seven Code" and
                    re.fullmatch("[a-f0-9]{40}", identity.get("commit", "")),
                    "Code OSS identity and commit must be verifiable")
            require(len(server.read("out/server-main.js")) >= 10_000,
                    "Original Code OSS server entrypoint is too small")
            require(len(server.read("out/vs/code/browser/workbench/workbench.js")) >= 10_000,
                    "Code OSS workbench is missing or too small")
            for name in sorted(server_files):
                # Archive may contain inert prebuilt binaries for other
                # platforms; Android-reachable addons and helpers MUST be
                # Bionic and AArch64, not copied from Linux ARM64.
                if any(excluded in "/" + name for excluded in EXCLUDED_NATIVE_DIRS):
                    continue
                if not (name.endswith(".node") or name.endswith("/rg") or
                        name.endswith("/ripgrep")):
                    continue
                data = server.read(name)
                if data[:4] == b"\x7fELF":
                    inspect_elf(data, "Code OSS native " + name, directory)
    print("Verified single APK contains digest-matched Code OSS, Bionic Node, " +
          "all declared native libraries and no active glibc addon detected.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: verify-standalone-apk.py PATH/SevenCode-*.apk")
    try:
        main(pathlib.Path(sys.argv[1]))
    except (RuntimeError, OSError, zipfile.BadZipFile, subprocess.CalledProcessError) as exc:
        print("STANDALONE RELEASE BLOCKED: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
