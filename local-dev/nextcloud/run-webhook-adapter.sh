#!/usr/bin/env bash
# Arranca el adaptador de webhook (versión "producción": Nextcloud empuja el evento acá, no sondeo).
set -euo pipefail
cd "$(dirname "$0")"

set -a
source ./.env
set +a

export PORT=8091
export NC_USER=audit-core
export NC_PASS="$NEXTCLOUD_SERVICE_PASSWORD"
export NC_BASE=https://192.168.0.11.sslip.io:8443
export BACKEND_BASE=http://localhost:4000
export ADAPTER_SECRET
export WEBHOOK_SECRET
WEBHOOK_SECRET=$(grep '^NEXTCLOUD_WEBHOOK_SECRET=' ../../.env | cut -d= -f2-)
ADAPTER_SECRET=$(grep '^WEBHOOK_ADAPTER_SECRET=' ./.env | cut -d= -f2-)
export NODE_EXTRA_CA_CERTS="$(pwd)/certs/mkcert-ca/rootCA.pem"

exec node webhook-adapter.mjs
