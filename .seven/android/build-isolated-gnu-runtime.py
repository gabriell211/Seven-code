#!/usr/bin/env python3
"""Build a PROBE-ONLY glibc AArch64 userspace closure for the original Code OSS.

This does not make an Android APK, does not assert execution on Android, and
must never be used as a release acceptance signal. The goal is to keep GNU
ELFs in one *separate* process, instead of attempting to dlopen glibc objects
inside a Bionic/Android Node process.
"""
import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys

AARCH64 = 183
ELF_MAGIC = b"\x7fELF"
IGNORED_SUBTREES = (
    "/linux-x64/", "/win32-", "/darwin-", "/alpine-",
    "/ia32/", "/linux-armhf/", "/linux-arm/", "/x64/",
    "/x86_64/", "/i386/", "/amd64/", "/armeabi-v7a/",
)
REQUIRED_COPILOT = (
    "extensions/copilot/node_modules/@github/copilot/sdk/prebuilds/linux-arm64/runtime.node",
    "extensions/copilot/node_modules/@github/copilot/sdk/prebuilds/linux-arm64/cli-native.node",
    "node_modules/@github/copilot-sdk-linux-arm64/prebuilds/linux-arm64/runtime.node",
    "node_modules/@github/copilot-sdk-linux-arm64/prebuilds/linux-arm64/copilot-runtime",
)


def sha256(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def is_foreign_architecture_path(relative_path):
    """Only ignore explicitly architecture-qualified, unused vendor binaries.

    An ELF with the wrong architecture in a *generic* path remains a hard
    error: it could be reached by the ARM64 extension host at runtime.
    """
    normalized = "/" + relative_path.replace("\\\\", "/").strip("/")
    return any(part in normalized for part in IGNORED_SUBTREES)


def tool(name, *args):
    return subprocess.run([name, *map(str, args)], capture_output=True,
                          text=True, check=True).stdout


def elf(path):
    with path.open("rb") as stream:
        header = stream.read(20)
    if not header.startswith(ELF_MAGIC):
        return False
    if len(header) < 20 or header[4] != 2 or header[5] != 1 or int.from_bytes(header[18:20], "little") != AARCH64:
        raise ValueError("Non-AArch64 ELF in userspace closure: " + str(path))
    return True


def needed(path):
    output = tool("readelf", "-Wd", path)
    return set(re.findall(r"\(NEEDED\)\s+Shared library: \[([^\]]+)\]", output))


def interpreter(path):
    output = tool("readelf", "-Wl", path)
    match = re.search(r"Requesting program interpreter:\s*([^\]]+)", output)
    return match.group(1) if match else None


def system_libraries():
    # Only aarch64 Ubuntu host libraries; never link against x86 or Android.
    output = tool("ldconfig", "-p")
    result = {}
    for line in output.splitlines():
        match = re.match(r"\s*(\S+)\s+\(([^)]+)\)\s+=>\s+(\S+)", line)
        if not match:
            continue
        name, abi, path = match.groups()
        if "AArch64" not in abi and "aarch64" not in path:
            continue
        if pathlib.Path(path).is_file():
            result.setdefault(name, pathlib.Path(path).resolve())
    return result


def find_copyright(package_file, notices):
    # Derive ownership from installed packages and preserve original notices.
    query = subprocess.run(["dpkg-query", "-S", str(package_file)],
                           capture_output=True, text=True, check=False)
    if query.returncode != 0:
        return None
    names = []
    for line in query.stdout.splitlines():
        if ": " not in line:
            continue
        names.extend(line.split(": ", 1)[0].split(", "))
    for pkg in names:
        pkg = pkg.strip().split(":")[0]
        notice = pathlib.Path("/usr/share/doc") / pkg / "copyright"
        if notice.is_file():
            target = notices / (pkg + ".copyright")
            shutil.copyfile(notice, target)
            return str(target.name)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("server", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    server = args.server.resolve()
    out = args.output.resolve()
    node = server / "node"
    if not node.is_file() or not elf(node):
        raise ValueError("Original compiled Linux AArch64 Node executable is missing")
    interp = interpreter(node)
    if not interp or pathlib.PurePosixPath(interp).name != "ld-linux-aarch64.so.1":
        raise ValueError("Compiled Node has no GNU/Linux ARM64 dynamic interpreter: " + str(interp))
    loader = pathlib.Path(interp)
    if not loader.is_file() or not elf(loader):
        raise ValueError("Original native ARM64 glibc loader not found on host")

    for path in REQUIRED_COPILOT:
        candidate = server / path
        if not candidate.is_file() or not elf(candidate):
            raise ValueError("Missing original native GitHub Copilot ELF: " + path)

    base = out / "lib"
    notices = out / "notices"
    base.mkdir(parents=True, exist_ok=True)
    notices.mkdir(parents=True, exist_ok=True)
    binaries = [node]
    for path in server.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        rel = str(path.relative_to(server))
        with path.open("rb") as source:
            if source.read(4) != ELF_MAGIC:
                continue
        if is_foreign_architecture_path(rel):
            continue
        # Keep all unqualified ELF objects under scrutiny. In particular,
        # Copilot's Linux/ARM64 .node files must NOT be skipped.
        if not elf(path):
            raise ValueError("Unexpected incompatible native ELF: " + rel)
        binaries.append(path)

    system = system_libraries()
    pending = set()
    for path in binaries:
        pending.update(needed(path))
    # NSS modules are loaded by glibc at runtime (dlopen, not DT_NEEDED).
    pending.update(name for name in ("libnss_dns.so.2", "libnss_files.so.2", "libresolv.so.2")
                   if name in system)
    collected = {}
    licenses = {}
    while pending:
        name = pending.pop()
        if "/" in name or name in (".", "..") or len(name) > 140:
            raise ValueError("Invalid dynamic dependency: " + name)
        if name in collected:
            continue
        path = system.get(name)
        if not path or not path.is_file():
            raise ValueError("Missing native ARM64 GNU library dependency: " + name)
        if not elf(path):
            raise ValueError("GNU userspace dependency is not AArch64: " + str(path))
        target = base / name
        shutil.copyfile(path, target)
        collected[name] = {"sha256": sha256(target), "source": str(path)}
        license_name = find_copyright(path, notices)
        if license_name:
            licenses[name] = license_name
        pending.update(needed(path) - collected.keys())

    libc = collected.get("libc.so.6")
    if libc is None:
        raise ValueError("glibc libc.so.6 absent from closure")
    shutil.copyfile(loader, out / "ld-linux-aarch64.so.1")
    shutil.copyfile(node, out / "node")
    # The loader is an executable, not a Bionic .node addon. Keep GNU and
    # Bionic runtimes isolated in different processes and namespaces.
    manifest = {
        "mode": "research-only-gnu-aarch64-separate-process",
        "androidVerified": False,
        "releaseEligible": False,
        "nodeSha256": sha256(out / "node"),
        "loaderSha256": sha256(out / "ld-linux-aarch64.so.1"),
        "originalCopilotElf": {p: sha256(server / p) for p in REQUIRED_COPILOT},
        "libraries": collected,
        "licenses": licenses,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    # Actually execute the original glibc Node through the bundled loader.
    smoke = subprocess.run([
        str(out / "ld-linux-aarch64.so.1"), "--library-path", str(base),
        str(out / "node"), "--version",
    ], capture_output=True, text=True, timeout=20, check=True)
    print("Original GNU/Linux Node via bundled ARM64 GNU loader:", smoke.stdout.strip())
    print("GNU closure libraries:", len(collected))
    print("Original unmodified Copilot ELF objects:", len(REQUIRED_COPILOT))
    print("RESEARCH ONLY: Android execution, extension host and OAuth are NOT verified.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        print("GNU ARM64 isolation probe FAILED:", e, file=sys.stderr)
        sys.exit(1)
