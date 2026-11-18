#!/usr/bin/env bash
# sudo bash deploy-api.sh /home/ubuntu/api (the uploaded dist/api directory)
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
source_dir=$(realpath -- "${1:?Pass the uploaded dist/api directory}")
[[ -f ${source_dir}/server.mjs ]] || { echo 'server.mjs is missing.' >&2; exit 1; }
grep -Eq '^SUPABASE_SERVICE_ROLE_KEY=.+$' /etc/orica/api.env || {
  echo 'Set /etc/orica/api.env first.' >&2; exit 1;
}
/usr/local/bin/node --check "${source_dir}/server.mjs"
release_dir=$(mktemp -d /opt/orica/releases/release-XXXXXXXX)
chmod 755 "$release_dir"
# Only bundled JavaScript is deployed; no source repository, .env or static assets.
install -m 644 "${source_dir}/"*.mjs "$release_dir/"
previous=$(readlink -f /opt/orica/current || true)
ln -sfn "$release_dir" /opt/orica/current.next
mv -Tf /opt/orica/current.next /opt/orica/current
systemctl enable orica-api
if systemctl restart orica-api && curl -fsS --retry 8 --retry-delay 1 --retry-connrefused http://127.0.0.1:3000/healthz; then
  echo "API deployed: ${release_dir}"
else
  echo 'Startup failed; restoring the previous release if present.' >&2
  if [[ -n ${previous} && -d ${previous} ]]; then
    ln -sfn "$previous" /opt/orica/current.next
    mv -Tf /opt/orica/current.next /opt/orica/current
    systemctl restart orica-api
  else
    systemctl stop orica-api
  fi
  exit 1
fi
