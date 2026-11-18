#!/usr/bin/env bash
# Initial setup for a fresh Always Free Ubuntu VM. Does not start the API yet.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
source /etc/os-release
[[ ${ID} == ubuntu ]] || { echo 'Ubuntu is required.' >&2; exit 1; }
case "$(uname -m)" in
  aarch64) node_arch=arm64 ;;
  x86_64) node_arch=x64 ;;
  *) echo 'Unsupported CPU architecture.' >&2; exit 1 ;;
esac
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
apt-get update
apt-get install -y ca-certificates curl gnupg xz-utils python3 debian-keyring debian-archive-keyring apt-transport-https

# Official Node 22 LTS distribution; verify the archive before installation.
node_version=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | sed -n "s/^.*  node-\(v[0-9.]*\)-linux-${node_arch}\.tar\.xz$/\1/p")
[[ ${node_version} =~ ^v22\.[0-9]+\.[0-9]+$ ]] || { echo 'Cannot resolve Node 22.' >&2; exit 1; }
archive="node-${node_version}-linux-${node_arch}.tar.xz"
download_dir=$(mktemp -d)
trap 'rm -rf -- "$download_dir"' EXIT
curl -fsSL "https://nodejs.org/dist/${node_version}/${archive}" -o "${download_dir}/${archive}"
curl -fsSL "https://nodejs.org/dist/${node_version}/SHASUMS256.txt" -o "${download_dir}/SHASUMS256.txt"
(cd "$download_dir" && grep -F "  ${archive}" SHASUMS256.txt | sha256sum -c -)
install -d /opt/orica-node
tar -xJf "${download_dir}/${archive}" -C /opt/orica-node
ln -sfn "/opt/orica-node/node-${node_version}-linux-${node_arch}/bin/node" /usr/local/bin/node

# Caddy's official apt package includes its systemd unit and certificate storage.
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

id orica >/dev/null 2>&1 || useradd --system --home-dir /opt/orica --shell /usr/sbin/nologin orica
install -d -m 755 /opt/orica/releases
install -d -m 700 /etc/orica
install -m 644 "${script_dir}/orica-api.service" /etc/systemd/system/orica-api.service
if [[ ! -e /etc/orica/api.env ]]; then
  install -m 600 "${script_dir}/api.env.example" /etc/orica/api.env
fi
systemctl daemon-reload
echo 'Installed. Set /etc/orica/api.env and Caddyfile, then deploy dist/api. The API is not started yet.'
