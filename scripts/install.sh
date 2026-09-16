#!/usr/bin/env bash
set -euo pipefail
# Release automation replaces both markers before uploading this script.
release='__ONTRACK_RELEASE__'
bootstrap_sha='__ONTRACK_BOOTSTRAP_SHA256__'
manifest_sha='__ONTRACK_MANIFEST_SHA256__'
if [[ ${1:-} == --help ]]; then
  echo 'Usage: bash install.sh [--root PATH] [--data-dir PATH] [--port N] [--adopt-from PATH] [--no-profile] [--no-open]'
  exit 0
fi
case "$release" in __*) echo 'Use an installer generated for a published release; manual setup remains npm run quickstart.' >&2; exit 1;; esac
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin-arm64; hash=a1a54f46a750d2523d628d924aab61758a51c9dad3e0238beb14141be9615dd3;;
  Darwin-x86_64) platform=darwin-x64; hash=f2879eb810e25993a0578e5d878930266fd2eafcffe9f2839b3d8db354d4879e;;
  Linux-x86_64) platform=linux-x64; hash=dbf5b8665dec15e59e6359a517fefb47b23fdb9152d8def975b9bca3dfc6d355;;
  *) echo 'This managed platform is not supported. Use manual installation.' >&2; exit 1;;
esac
for utility in curl tar unzip zipinfo mktemp; do command -v "$utility" >/dev/null || { echo "Required utility missing: $utility. Use manual installation." >&2; exit 1; }; done
if command -v shasum >/dev/null; then hash_command=(shasum -a 256); elif command -v sha256sum >/dev/null; then hash_command=(sha256sum); else echo 'A SHA256 utility is required.' >&2; exit 1; fi
if [[ $platform == darwin-* ]]; then root="$HOME/Library/Application Support/On Track Runtime"; else root="${XDG_DATA_HOME:-$HOME/.local/share}/on-track-runtime"; fi
forward=()
while (($#)); do
 case "$1" in
  --root) [[ $# -ge 2 ]] || exit 2; root=$2; shift 2;;
  --data-dir|--port|--adopt-from) [[ $# -ge 2 ]] || exit 2; forward+=("$1" "$2"); shift 2;;
  --no-profile|--no-open) forward+=("$1"); shift;;
  *) echo "Unsupported installer option." >&2; exit 2;;
 esac
done
[[ $root == /* && ! -L $root ]] || { echo 'Use an absolute, non-symlink installation root.' >&2; exit 1; }
umask 077
mkdir -p "$root"
chmod 700 "$root"
claim="$root/.bootstrap-claim"
mkdir "$claim" 2>/dev/null || { echo 'Setup is already running or was interrupted. Preserve logs and inspect the bootstrap claim before retrying.' >&2; exit 1; }
trap 'rmdir "$claim" 2>/dev/null || true' EXIT
stage=$(mktemp -d "$root/bootstrap.XXXXXXXX")
node_name="node-v24.14.0-$platform"
archive="$stage/node.tar.gz"
echo 'Preparing the private Node runtime…'
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --location --max-redirs 3 --connect-timeout 15 --max-time 180 --max-filesize 70000000 "https://nodejs.org/download/release/v24.14.0/$node_name.tar.gz" -o "$archive"
actual=$("${hash_command[@]}" "$archive"); actual=${actual%% *}
[[ $actual == "$hash" ]] || { echo 'Node checksum verification failed.' >&2; exit 1; }
# Exact official archive hash is verified before using the platform extractor.
tar -xzf "$archive" -C "$stage"
node_dir="$stage/$node_name"
[[ -x $node_dir/bin/node ]] || { echo 'Private Node runtime is unavailable.' >&2; exit 1; }
bootstrap="$stage/managed-bootstrap.mjs"
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --silent --show-error --location --max-redirs 3 --connect-timeout 15 --max-time 120 --max-filesize 1000000 "https://github.com/satankov/on-track/releases/download/$release/managed-bootstrap.mjs" -o "$bootstrap"
actual=$("${hash_command[@]}" "$bootstrap"); actual=${actual%% *}
[[ $actual == "$bootstrap_sha" ]] || { echo 'Bootstrap checksum verification failed.' >&2; exit 1; }
unset NODE_OPTIONS NODE_PATH
# Bash 3.2 treats an empty array as unset under nounset. Expand only when set,
# retaining one argument per array element and no argument for an empty array.
ONTRACK_BOOTSTRAP_MANIFEST_SHA256="$manifest_sha" ONTRACK_BOOTSTRAP_RELEASE="$release" "$node_dir/bin/node" "$bootstrap" "$root" "$node_dir" ${forward[@]+"${forward[@]}"}
rm -rf -- "$stage"
echo 'On Track is ready. Open a new terminal to use ontrack.'
