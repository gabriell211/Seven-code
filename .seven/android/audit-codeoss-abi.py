#!/usr/bin/env python3
"""Audit the actual executable ABI in a Code OSS server tree.

A Code OSS build that targets linux-arm64 is a *GNU/Linux* build until
all ELF modules and subprocess helpers have been rebuilt for Android/Bionic.
Do not relabel it Android because the CPU instruction set happens to match.
"""
import argparse
import pathlib
import struct
import subprocess
import sys

ELF_MAGIC = b"\x7fELF"
AARCH64 = 183
INTERESTING = ("node", "rg", "ripgrep", "pty")
ANDROID_ALLOWED = {
    "libc.so", "libdl.so", "libm.so", "liblog.so", "libandroid.so",
    "libz.so", "libEGL.so", "libGLESv2.so",
}


def elf_info(path):
    with path.open("rb") as fh:
        header = fh.read(64)
    if header[:4] != ELF_MAGIC:
        return None
    if len(header) < 20:
        raise ValueError(f"Truncated ELF: {path}")
    is_64 = header[4] == 2
    little_endian = header[5] == 1
    if not is_64 or not little_endian:
        raise ValueError(f"Unsupported ELF class/endian: {path}")
    return struct.unpack_from("<H", header, 18)[0]


def readelf(*args):
    return subprocess.run(["readelf", *map(str, args)], check=True,
                          capture_output=True, text=True).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("tree", type=pathlib.Path)
    parser.add_argument("--stage", choices=["linux-arm64", "android-bionic"], required=True)
    args = parser.parse_args()
    root = args.tree.resolve()
    assert (root / "out/server-main.js").is_file(), "No Code OSS server entrypoint"
    assert (root / "out/vs/code/browser/workbench/workbench.js").is_file(), "No web workbench"
    assert (root / "out/vs/workbench/api/node/extensionHostProcess.js").is_file(), "No Node extension host"
    assert (root / "extensions/seven-code-mobile-terminal/dist/browser/extension.js").is_file(), "Missing Android adapter"
    assert (root / "extensions/copilot/dist/extension.js").is_file(), "Missing upstream Copilot"
    elfs, critical, wrong, glibc = [], [], [], []
    for file in root.rglob("*"):
        if not file.is_file() or file.is_symlink():
            continue
        # Only files with an ELF header can be executable; .node addons plus
        # the package's native helpers are the interesting candidates.
        with file.open("rb") as fh:
            magic = fh.read(4)
        if magic != ELF_MAGIC:
            continue
        machine = elf_info(file)
        rel = str(file.relative_to(root))
        elfs.append(rel)
        active = not any(part in rel for part in (
            "/linux-x64/", "/x64/", "/darwin-", "/win32-", "/alpine-",
            "/ia32/", "/linux-armhf/", "/linux-arm/"
        ))
        if active and (rel.endswith(".node") or file.name == "rg" or "linux-arm64" in rel):
            critical.append(rel)
            if machine != AARCH64:
                wrong.append((rel, machine))
            dynamic = readelf("-d", file)
            versions = readelf("--version-info", file)
            if "libc.so.6" in dynamic or "GLIBC_" in versions:
                glibc.append(rel)
    print(f"Code OSS: {len(elfs)} ELF files, {len(critical)} active ARM64 addon/search candidates")
    for rel, machine in wrong[:20]:
        print(f"INVALID machine {machine}: {rel}", file=sys.stderr)
    if wrong:
        raise SystemExit("Unsupported non-AARCH64 ELF in an active Code OSS path")
    if args.stage == "linux-arm64":
        if not critical:
            raise SystemExit("No ARM64 native module/search binary in compiled tree")
        print("PASS: Code OSS web + Node extension host compiled for Linux ARM64.")
        print(f"WARNING: {len(glibc)} active GNU/Linux ELF objects require Bionic replacement.")
    else:
        if (root / "node").exists():
            raise SystemExit("Linux Node executable bundled in Android server")
        if glibc:
            for rel in glibc[:30]:
                print("GLIBC native object:", rel, file=sys.stderr)
            raise SystemExit("Native ELF components still target glibc, not Android/Bionic")
        print("PASS: Code OSS server has no detected active glibc native addons.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
