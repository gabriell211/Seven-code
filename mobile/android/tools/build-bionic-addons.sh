#!/usr/bin/env bash
set -euo pipefail

# Compile Code OSS's three critical Node addons for Android/Bionic, not glibc.
# The editor/core is unchanged; this replaces native runtime implementations
# with genuine NDK-compiled objects matching the packaged JavaScript versions.
#
# Usage: ANDROID_NDK_HOME=/path/to/ndk bash mobile/android/tools/build-bionic-addons.sh
#        <compiled-vscode-reh-web-linux-arm64> <verified-seven-bionic-dir>
# Requires Linux x86_64 host, npm, curl, readelf, Node 24 and NDK r27+.
#
# Builds to the server tree itself only after an exact version pairing check.
SERVER="${1:?first argument must be the Code OSS server tree}"
BIONIC="${2:?second argument must be the verified Bionic Node folder}"
SERVER="$(realpath "$SERVER")"
BIONIC="$(realpath "$BIONIC")"
test -s "$SERVER/out/server-main.js"
test -s "$BIONIC/libnode.so"
test -s "$BIONIC/provenance.json"

NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
test -n "$NDK" && test -d "$NDK" || { echo "Android NDK missing" >&2; exit 1; }
TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64"
test -x "$TOOLCHAIN/bin/aarch64-linux-android28-clang++"
CC="$TOOLCHAIN/bin/aarch64-linux-android28-clang"
CXX="$TOOLCHAIN/bin/aarch64-linux-android28-clang++"
STRIP="$TOOLCHAIN/bin/llvm-strip"

VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["node"])' "$BIONIC/provenance.json")"
case "$VERSION" in 24.*) ;; *) echo "Expected Bionic Node v24, got $VERSION" >&2; exit 1 ;; esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fL --retry 3 "https://nodejs.org/dist/v$VERSION/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
HEADERS="node-v$VERSION-headers.tar.gz"
EXPECTED="$(awk -v name="$HEADERS" '$2==name { print $1; exit }' "$WORK/SHASUMS256.txt")"
test "${#EXPECTED}" -eq 64 || { echo "Node release headers digest missing" >&2; exit 1; }
curl -fL --retry 3 "https://nodejs.org/dist/v$VERSION/$HEADERS" -o "$WORK/$HEADERS"
echo "$EXPECTED  $WORK/$HEADERS" | sha256sum -c -
tar xf "$WORK/$HEADERS" -C "$WORK"
HEADERS_DIR="$WORK/node-v$VERSION/include/node"
test -s "$HEADERS_DIR/node_api.h"

# Each package is fetched by its exact version from the server's package.json,
# not a floating version. npm pack verifies the registry's published integrity.
get_version() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$SERVER/node_modules/$1/package.json"
}
fetch_package() {
  local name="$1" version="$2" dest="$3"
  mkdir -p "$dest" "$WORK/cache"
  (cd "$WORK/cache" && npm pack "$name@$version" --silent --pack-destination "$WORK/cache" >/dev/null)
  local pkg
  pkg="$(find "$WORK/cache" -maxdepth 1 -type f -name '*.tgz' | sort | tail -1)"
  test -s "$pkg"
  tar xf "$pkg" --strip-components=1 -C "$dest"
  rm -f "$pkg"
  test -s "$dest/package.json"
  python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["version"]==sys.argv[2]' "$dest/package.json" "$version"
}
get_api() {
  local version="$1" dest="$2"
  fetch_package node-addon-api "$version" "$dest"
}

# Do not let two versions of one native module silently share a JS loader.
build_shared() {
  local src="$1" target="$2" api="$3"; shift 3
  local files=() defs=() separator=0
  for arg in "$@"; do
    if [[ "$arg" == "--" ]]; then separator=1; continue; fi
    if [[ "$separator" == 0 ]]; then files+=("$src/$arg"); else defs+=("$arg"); fi
  done
  mkdir -p "$(dirname "$target")"
  "$CXX" -shared -fPIC -std=c++17 -O2 -static-libstdc++ \
    -Wl,-Bsymbolic -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 \
    -DNAPI_VERSION=9 -I"$HEADERS_DIR" -I"$api" \
    "${defs[@]}" -o "$target" "${files[@]}"
  "$STRIP" "$target"
}
verify() {
  local file="$1"
  test -s "$file"
  readelf -h "$file" | grep -Eq 'Machine:.*AArch64'
  if readelf --version-info "$file" | grep -q 'GLIBC_'; then
    echo "Illegal GNU/Linux ELF addon: $file" >&2; exit 1
  fi
  if readelf -d "$file" | grep -Eq 'libc\.so\.6|libstdc\+\+\.so\.6'; then
    echo "Illegal glibc linkage: $file" >&2; exit 1
  fi
  readelf -Wl "$file" | awk '/LOAD/{if (strtonum($NF)<16384) bad=1} END{exit bad}' 2>/dev/null ||
    echo "::warning::Check ELF 16KB alignment for $file on the target Android device"
}

PTY_VERSION="$(get_version node-pty)"
WATCH_VERSION="$(get_version @parcel/watcher)"
SQLITE_VERSION="$(get_version @vscode/sqlite3)"
echo "Native Code OSS addons: node-pty=$PTY_VERSION watcher=$WATCH_VERSION sqlite=$SQLITE_VERSION"

# Fetch N-API headers under separate trees: SQLite uses newer node-addon-api.
get_api 7.1.1 "$WORK/api7"
get_api 8.9.2 "$WORK/api8"
fetch_package node-pty "$PTY_VERSION" "$WORK/pty"
fetch_package @parcel/watcher "$WATCH_VERSION" "$WORK/watcher"
fetch_package @vscode/sqlite3 "$SQLITE_VERSION" "$WORK/sqlite"

OUT="$WORK/out"
build_shared "$WORK/pty" "$OUT/node-pty/pty.node" "$WORK/api7" \
  src/unix/pty.cc -- -DNODE_ADDON_API_DISABLE_DEPRECATED -DNODE_GYP_MODULE_NAME=pty
verify "$OUT/node-pty/pty.node"

build_shared "$WORK/watcher" "$OUT/watcher/watcher.node" "$WORK/api7" \
  src/binding.cc src/Watcher.cc src/Backend.cc src/DirTree.cc src/Glob.cc \
  src/Debounce.cc src/watchman/BSER.cc src/watchman/WatchmanBackend.cc \
  src/shared/BruteForceBackend.cc src/linux/InotifyBackend.cc src/unix/legacy.cc \
  -- -fexceptions -DNAPI_DISABLE_CPP_EXCEPTIONS -DWATCHMAN -DINOTIFY \
  -DBRUTE_FORCE -DNODE_GYP_MODULE_NAME=watcher
verify "$OUT/watcher/watcher.node"

SQLITE_AMALGAMATION="$WORK/sqlite/sqlite-autoconf-3390400"
if [[ ! -d "$SQLITE_AMALGAMATION" ]]; then
  tar xf "$WORK/sqlite/deps/sqlite-autoconf-3390400.tar.gz" -C "$WORK/sqlite"
fi
DEFINES=(-DNDEBUG -D_REENTRANT=1 -DSQLITE_THREADSAFE=1 -DHAVE_USLEEP=1
  -DSQLITE_ENABLE_FTS3 -DSQLITE_ENABLE_FTS4 -DSQLITE_ENABLE_FTS5
  -DSQLITE_ENABLE_RTREE -DSQLITE_ENABLE_DBSTAT_VTAB=1 -DSQLITE_ENABLE_MATH_FUNCTIONS)
"$CC" -c -fPIC -O2 "${DEFINES[@]}" -o "$WORK/sqlite3.o" "$SQLITE_AMALGAMATION/sqlite3.c"
"$CXX" -shared -fPIC -std=c++17 -O2 -fexceptions -static-libstdc++ \
  -Wl,-Bsymbolic -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384 \
  -DNAPI_VERSION=8 -DNODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS "${DEFINES[@]}" \
  -I"$HEADERS_DIR" -I"$WORK/api8" -I"$SQLITE_AMALGAMATION" \
  -o "$OUT/sqlite/vscode-sqlite3.node" \
  "$WORK/sqlite/src/backup.cc" "$WORK/sqlite/src/database.cc" \
  "$WORK/sqlite/src/node_sqlite3.cc" "$WORK/sqlite/src/statement.cc" "$WORK/sqlite3.o"
"$STRIP" "$OUT/sqlite/vscode-sqlite3.node"
verify "$OUT/sqlite/vscode-sqlite3.node"

cp "$OUT/node-pty/pty.node" "$SERVER/node_modules/node-pty/build/Release/pty.node"
cp "$OUT/watcher/watcher.node" "$SERVER/node_modules/@parcel/watcher/build/Release/watcher.node"
cp "$OUT/sqlite/vscode-sqlite3.node" "$SERVER/node_modules/@vscode/sqlite3/build/Release/vscode-sqlite3.node"
echo "Compiled and installed native Code OSS Android/Bionic PTY, watcher and SQLite3 modules."
