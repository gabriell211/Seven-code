#!/usr/bin/env python3
"""Fail-closed evidence audit for a single EXPERIMENTAL GNU ARM64 Android APK.

This is binary integrity evidence only, NOT proof of executing Code OSS on
Android and NOT permission to ship a release or bypass actual Copilot OAuth.
"""
import hashlib
import io
import json
import pathlib
import re
import sys
import tempfile
import zipfile

FOUR_COPILOT_PATHS = (
    "extensions/copilot/node_modules/@github/copilot/sdk/prebuilds/linux-arm64/runtime.node",
    "extensions/copilot/node_modules/@github/copilot/sdk/prebuilds/linux-arm64/cli-native.node",
    "node_modules/@github/copilot-sdk-linux-arm64/prebuilds/linux-arm64/runtime.node",
    "node_modules/@github/copilot-sdk-linux-arm64/prebuilds/linux-arm64/copilot-runtime",
)
REQUIRED_OUTER = (
    "lib/arm64-v8a/libseven-gnu-node.so",
    "lib/arm64-v8a/libseven-gnu-loader.so",
    "lib/arm64-v8a/libsevenpty.so",
    "assets/seven-local/server.zip",
    "assets/seven-local/server.sha256",
    "assets/seven-local/gnu-libs.zip",
    "assets/seven-local/gnu-notices.zip",
    "assets/seven-local/gnu-manifest.json",
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest_stream(stream):
    h = hashlib.sha256()
    while piece := stream.read(1024 * 1024):
        h.update(piece)
    return h.hexdigest()


def members(archive, label):
    names = archive.namelist()
    require(len(names) <= 110_000, "Archive has too many members: " + label)
    require(len(names) == len(set(names)), "Duplicate archive entries: " + label)
    for name in names:
        require(not name.startswith("/") and "\\" not in name and
                all(part not in (".", "..") for part in name.split("/")),
                "Unsafe archive entry " + label + ": " + name)
    return set(names)


def check_arm64_elf(raw, path):
    require(len(raw) > 64 and raw[:6] == b"\x7fELF\x02\x01" and
            int.from_bytes(raw[18:20], "little") == 183,
            "Not a genuine AArch64 ELF: " + path)


def verify(apk):
    require(apk.is_file() and apk.stat().st_size > 30_000_000,
            "Experimental APK must contain full local Code OSS (not a thin client)")
    with zipfile.ZipFile(apk) as outer, tempfile.TemporaryDirectory() as folder:
        names = members(outer, "apk")
        require(set(REQUIRED_OUTER) <= names,
                "Single APK missing GNU runtime: " + str(sorted(set(REQUIRED_OUTER) - names)))
        manifest = json.loads(outer.read("assets/seven-local/gnu-manifest.json"))
        require(manifest.get("mode") == "research-only-gnu-aarch64-separate-process",
                "Unrecognized GNU runtime provenance")
        require(manifest.get("androidVerified") is False and
                manifest.get("releaseEligible") is False,
                "Research experiment cannot claim Android compatibility/release")
        require(re.fullmatch(r"[a-f0-9]{40}", manifest.get("sourceSha", "")),
                "Missing upstream Code OSS source revision")
        require(isinstance(manifest.get("codeossRunId"), int) and
                manifest["codeossRunId"] > 0, "No source build ID for GNU original")
        for elf, expected in (
            ("lib/arm64-v8a/libseven-gnu-node.so", manifest["nodeSha256"]),
            ("lib/arm64-v8a/libseven-gnu-loader.so", manifest["loaderSha256"]),
        ):
            raw = outer.read(elf)
            check_arm64_elf(raw, elf)
            require(sha(raw) == expected, "Android packaging modified GNU ELF: " + elf)
        libc = manifest.get("libraries")
        require(isinstance(libc, dict) and "libc.so.6" in libc,
                "Bundled GNU libraries do not include the original libc")
        with zipfile.ZipFile(io.BytesIO(outer.read("assets/seven-local/gnu-libs.zip"))) as libraries:
            actual = members(libraries, "gnu-libs")
            require(actual == set(libc), "Missing/extra GNU libraries in APK")
            for name, item in libc.items():
                require(re.fullmatch(r"[A-Za-z0-9._+-]{1,140}", name),
                        "Invalid GNU library basename: " + name)
                raw = libraries.read(name)
                check_arm64_elf(raw, name)
                require(sha(raw) == item["sha256"], "Modified GNU library: " + name)
        with zipfile.ZipFile(io.BytesIO(outer.read("assets/seven-local/gnu-notices.zip"))) as notices:
            require(len(members(notices, "notices")) > 0,
                    "GNU third-party copyright notices missing")

        archive = pathlib.Path(folder) / "server.zip"
        with outer.open("assets/seven-local/server.zip") as data, archive.open("wb") as output:
            digest = hashlib.sha256()
            size = 0
            while chunk := data.read(1024 * 1024):
                size += len(chunk)
                require(size <= 500_000_000, "Compressed Code OSS archive exceeds limit")
                digest.update(chunk)
                output.write(chunk)
        require(size >= 30_000_000, "Local Code OSS server is too small")
        original_digest = outer.read("assets/seven-local/server.sha256").decode().strip()
        require(digest.hexdigest() == original_digest, "Code OSS archive hash mismatch")
        with zipfile.ZipFile(archive) as server:
            originals = members(server, "server.zip")
            required = set(FOUR_COPILOT_PATHS) | {
                "out/server-main.js",
                "out/vs/code/browser/workbench/workbench.js",
                "out/vs/workbench/api/node/extensionHostProcess.js",
                "extensions/copilot/dist/extension.js",
                "product.json", "LICENSE.txt", "ThirdPartyNotices.txt",
            }
            require(required <= originals,
                    "The original editor, extension host or Copilot is incomplete")
            product = json.loads(server.read("product.json"))
            require(product.get("commit") == manifest["sourceSha"] and
                    product.get("nameShort") == "Seven Code",
                    "Original editor was compiled for the wrong source")
            hashes = manifest.get("originalCopilotElf", {})
            require(set(hashes) == set(FOUR_COPILOT_PATHS),
                    "Original four Copilot ELF entries replaced or omitted")
            for name in FOUR_COPILOT_PATHS:
                with server.open(name) as stream:
                    binary = stream.read()
                check_arm64_elf(binary, name)
                require(sha(binary) == hashes[name],
                        "Original proprietary Copilot binary modified: " + name)
    print("EXPERIMENTAL GNU APK integrity verified: Code OSS, Node, loader, " +
          "libc closure, notices and all four ORIGINAL Copilot ARM64 binaries.")
    print("NOT Android runtime acceptance. NOT Copilot OAuth or release approval.")


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 2, "Usage: verify-gnu-apk.py PATH/APK")
        verify(pathlib.Path(sys.argv[1]))
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print("EXPERIMENTAL APK INVALID: " + str(error), file=sys.stderr)
        sys.exit(1)
