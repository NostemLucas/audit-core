#!/usr/bin/env bash
# Registra en Nextcloud (app nativa `webhook_listeners`) los dos eventos que el adaptador traduce para audit-core:
# subida (NodeCreatedEvent) y borrado (NodeDeletedEvent, solo como red de contención — ver webhook-adapter.mjs, la
# papelera de Nextcloud hace que este evento casi nunca dispare de verdad, por eso el adaptador TAMBIÉN reconcilia
# por sondeo). Correr una sola vez por instancia de Nextcloud (o de nuevo si se recrea desde cero); no es idempotente,
# una segunda corrida crea registros duplicados — revisar antes con `webhook_listeners:list` si no es la primera vez.
set -euo pipefail
cd "$(dirname "$0")"
source ./.env

BASE="https://192.168.0.11.sslip.io:8443"
ADMIN="admin:${NEXTCLOUD_ADMIN_PASSWORD}"
# Puerto/host donde escucha webhook-adapter.mjs (correrlo con ./run-webhook-adapter.sh antes de registrar esto, o
# los primeros eventos que lleguen antes de que arranque simplemente se pierden — Nextcloud no reintenta para
# siempre, solo durante la ventana normal de un QueuedJob).
ADAPTER_URI="http://192.168.0.11:8091/event"

register() {
  local event="$1"
  curl -sk -u "$ADMIN" -X POST "$BASE/ocs/v2.php/apps/webhook_listeners/api/v1/webhooks?format=json" \
    -H "OCS-APIRequest: true" -H "Content-Type: application/json" \
    -d "{
      \"httpMethod\": \"POST\",
      \"uri\": \"${ADAPTER_URI}\",
      \"event\": \"OCP\\\\Files\\\\Events\\\\Node\\\\${event}\",
      \"authMethod\": \"header\",
      \"authData\": {\"X-Adapter-Secret\": \"${WEBHOOK_ADAPTER_SECRET}\"}
    }"
  echo
}

echo "== Registrando NodeCreatedEvent =="
register NodeCreatedEvent
echo "== Registrando NodeDeletedEvent =="
register NodeDeletedEvent

echo
echo "Listado actual:"
docker compose exec -u www-data app php occ webhook_listeners:list
