# Nextcloud local (real, no mock)

Postgres + Nextcloud (apache) + un proxy nginx que termina TLS y agrega los headers CORS que Nextcloud nunca pone
solo (necesario porque el navegador sube evidencia directo a un share público de Nextcloud — `docs/07` §1.1 de
`audit-core`) + un worker de background jobs + el adaptador que traduce el webhook nativo de Nextcloud al contrato
que `audit-core` exige.

## 0. Encontrar tu propia IP LAN y reemplazarla

Todo esto usa `192.168.0.11.sslip.io` como nombre — resuelve por DNS público a `192.168.0.11`, la IP LAN de la
máquina donde se armó esto. **sslip.io no aloja nada tuyo ni necesita configurarse**: cualquier nombre con forma
`<ip>.sslip.io` resuelve a esa IP para cualquiera, siempre — es solo una forma de tener un nombre DNS de verdad sin
depender de "`localhost`" (que significa una cosa distinta en el host y en cada contenedor; ver `../README.md`).

```bash
hostname -I | awk '{print $1}'   # tu IP LAN
```

Reemplazar `192.168.0.11` por esa IP (buscar y reemplazar literal) en estos 4 archivos antes de seguir:

- `docker-compose.yml` (`OVERWRITEHOST`, `OVERWRITECLIURL`, `NEXTCLOUD_TRUSTED_DOMAINS`)
- `nginx-cors.conf` (`server_name`)
- `run-webhook-adapter.sh` (`NC_BASE`)
- `register-webhooks.sh` (`BASE`, `ADAPTER_URI`)

## 1. Certificado

```bash
# instalar mkcert si hace falta: https://github.com/FiloSottile/mkcert#installation
mkdir -p certs
CAROOT="$(pwd)/certs/mkcert-ca" mkcert -install=false -cert-file certs/nextcloud.pem -key-file certs/nextcloud-key.pem <tu-ip>.sslip.io
```

(`-install=false`: no lo instala en el almacén de certificados del sistema/navegador — queda como certificado
autofirmado normal. Si querés que el navegador no muestre la advertencia, correr `mkcert -install` en cambio y
reiniciar el navegador; en Linux con Chrome hace falta además `sudo` para el almacén del sistema, no alcanza con la
base NSS del usuario — Chrome moderno no la usa para esto.)

## 2. Levantar todo

```bash
cp .env.example .env   # completar los 4 valores, ver el propio archivo
docker compose up -d
```

Nextcloud tarda un minuto en instalarse solo (usa `NEXTCLOUD_ADMIN_USER=admin` + `NEXTCLOUD_ADMIN_PASSWORD` de
`.env`). Verificar con `curl -k https://<tu-ip>.sslip.io:8443/status.php` (`"installed":true`).

## 3. Usuario de servicio (el que usa `audit-core` para hablarle a Nextcloud)

```bash
docker compose exec -u www-data app php occ user:add --password-from-env --display-name "Audit Core Service" audit-core
# (pide NEXTCLOUD_SERVICE_PASSWORD por variable de entorno OC_PASS, no por stdin normal:)
#   docker compose exec -u www-data -e OC_PASS="$NEXTCLOUD_SERVICE_PASSWORD" app php occ user:add --password-from-env --display-name "Audit Core Service" audit-core

docker compose exec -u www-data app php occ config:app:set core shareapi_allow_public_upload --value=yes
docker compose exec -u www-data app php occ config:app:set core shareapi_allow_links --value=yes
docker compose exec -u www-data app php occ config:app:set core shareapi_enforce_links_password --value=no
```

## 4. Login de Nextcloud vía Authentik (opcional — `audit-core` no lo necesita, ver más abajo)

```bash
docker compose exec -u www-data app php occ app:install user_oidc   # ya viene instalada en NC 30, por si acaso
docker compose exec -u www-data app php occ config:system:set allow_local_remote_servers --value=true --type=boolean
# ^ Nextcloud bloquea por defecto pedirle algo a una IP privada (protección SSRF) — Authentik local ES una IP
#   privada, así que hace falta esto para que Nextcloud pueda llegar a buscar el discovery document.

docker compose exec -u www-data app php occ user_oidc:provider authentik \
  --clientid=<client_id que imprimió ../authentik/setup.py> \
  --clientsecret=<client_secret que imprimió ../authentik/setup.py> \
  --discoveryuri="http://<tu-ip>:9000/application/o/nextcloud/.well-known/openid-configuration" \
  --mapping-uid=preferred_username --mapping-display-name=name --mapping-email=email --unique-uid=0
```

Nextcloud aprovisiona la cuenta local sola en el primer login, con el mismo username que Authentik (`auditor1` →
`auditor1`, etc.) — probado en navegador, ver el botón "Login with authentik" en `/login`.

**Por qué esto es aparte, no algo que `audit-core` necesite:** la integración real nunca pasa por el login web de
Nextcloud — solo WebDAV/OCS con la cuenta de servicio del paso 3, o links de un solo uso por token. Esto es una
demostración de que Nextcloud PUEDE compartir identidad con Authentik, útil si alguna vez alguien necesita entrar a
la interfaz de Nextcloud directamente.

## 5. El webhook de evidencia (la parte que hace que subir un archivo se refleje en `audit-core`)

```bash
docker compose exec -u www-data app php occ background:cron   # backgroundjobs_mode=cron — el worker del compose hace el resto
./run-webhook-adapter.sh &     # deja esto corriendo (o systemd/pm2/lo que prefieras en un entorno más permanente)
./register-webhooks.sh         # una sola vez por instancia de Nextcloud — ver el propio script
```

`webhook-adapter.mjs` documenta en sus propios comentarios el porqué de cada pieza (traduce el evento nativo de
Nextcloud al contrato de `audit-core`, por qué hace falta un worker de background jobs dedicado, y por qué el
borrado usa sondeo cada 60s en vez de push — la papelera de Nextcloud no dispara el evento nativo de borrado,
comprobado en vivo, no es una limitación de este adaptador).

## 6. Apuntar `audit-core` acá

En `audit-core/.env` (raíz del repo):

```
NEXTCLOUD_BASE_URL=https://<tu-ip>.sslip.io:8443
NEXTCLOUD_SERVICE_USER=audit-core
NEXTCLOUD_SERVICE_PASSWORD=<el de este .env>
NEXTCLOUD_WEBHOOK_SECRET=<cualquier valor — el mismo que lee run-webhook-adapter.sh de audit-core/.env>
NODE_EXTRA_CA_CERTS=<ruta absoluta a>/local-dev/nextcloud/certs/mkcert-ca/rootCA.pem
```

Verificar con `curl http://localhost:4000/health/ready` → `"nextcloud":"up"`.

## 7. OnlyOffice (editar los informes generados — Reportes → Abrir)

`audit-core` ya sube el `.docx` generado a `/Auditorias/{code}/Informes/` (paso 6); esto es solo para que el botón
"Abrir" del frontend lo abra editable en vez de solo descargable. El Document Server (`onlyoffice`, puerto 8444 del
proxy) y Nextcloud necesitan el **mismo** `ONLYOFFICE_JWT_SECRET` en **tres** lugares — si falta alguno, el editor
carga (JS/toolbar se ven) pero falla al abrir el documento, con un error distinto según cuál:

```bash
SECRET=$(grep ONLYOFFICE_JWT_SECRET .env | cut -d= -f2-)

# 1. Nextcloud → Document Server (qué token firma Nextcloud en el config que le manda al navegador). Si falta:
#    el editor abre y al cargar el documento tira "El 'token' de seguridad del documento tiene un formato incorrecto".
docker compose exec -u www-data app php occ config:app:set onlyoffice jwt_secret --value="$SECRET"

# 2. Document Server → Nextcloud (qué header manda el Document Server al pedir el archivo/avisar que se guardó — debe
#    ser el MISMO nombre que JWT_HEADER del servicio `onlyoffice` en docker-compose.yml, acá "Authorization"). Si
#    jwt_header queda vacío, Nextcloud usa su propio default ("AuthorizationJwt") en vez de "Authorization", el
#    Document Server manda el header con el nombre que SÍ configuramos y Nextcloud nunca lo encuentra: log de
#    Nextcloud dice "Download without jwt", el editor tira "Error de descarga" — NO un error de secreto, uno de
#    nombre de header. Fácil de confundir con el punto 1 porque el síntoma en el navegador es casi el mismo.
docker compose exec -u www-data app php occ config:app:set onlyoffice jwt_header --value="Authorization"

# 3. URLs de ida y vuelta (el mismo problema de "localhost significa otra cosa en cada lado" que el resto de este
#    directorio): DocumentServerUrl es lo que el NAVEGADOR carga; DocumentServerInternalUrl es Nextcloud → Document
#    Server (nombre del servicio en la red docker); StorageUrl es Document Server → Nextcloud (ídem).
docker compose exec -u www-data app php occ config:app:set onlyoffice DocumentServerUrl --value="https://<tu-ip>.sslip.io:8444/"
docker compose exec -u www-data app php occ config:app:set onlyoffice DocumentServerInternalUrl --value="http://onlyoffice/"
docker compose exec -u www-data app php occ config:app:set onlyoffice StorageUrl --value="http://app/"
```

Para diagnosticar un fallo real (no solo los dos de arriba): `docker compose exec -u www-data app tail -n 50
/var/www/html/data/nextcloud.log` filtrando por `"app":"onlyoffice"` tiene el mensaje exacto (`Download: <fileid>`,
`Download without jwt`, `Track: ... status 1 result 0`, etc.) — mucho más útil que los logs del propio Document
Server (`docker compose exec onlyoffice tail -n 40 /var/log/onlyoffice/documentserver/docservice/out.log`), que solo
registra a nivel WARN y casi nunca tiene el error real de una sesión de edición fallida.

**4. Postgres/Redis/RabbitMQ propios del Document Server** (`onlyoffice-db`/`onlyoffice-redis`/`onlyoffice-rabbitmq`
en `docker-compose.yml`, no están en `local-dev/authentik/` ni comparten nada con el Postgres de Nextcloud): sin
estos tres, `onlyoffice` cae a "memory runtime" (log: `convertermaster: memory runtime detected ... no workers will
be forked`) — `ConvertService.ashx` (conversión de un solo tiro, sin sesión) sigue funcionando perfecto, pero abrir
una sesión real de edición completa falla. Comprobado en vivo con `nc -zv 127.0.0.1 5432/6379/5672` DENTRO del
contenedor `onlyoffice`: los tres dan "connection refused" — no vienen incluidos en la imagen, hace falta levantarlos
aparte (ya están en el compose de este repo).

**5. `NODE_EXTRA_CA_CERTS` en el propio contenedor `onlyoffice`**: sin esto, su proceso Node no confía en el
certificado mkcert y cualquier llamada HTTPS que haga hacia el proxy falla con `UNABLE_TO_VERIFY_LEAF_SIGNATURE` —
mismo patrón que `NODE_EXTRA_CA_CERTS` en `audit-core/.env` (ver paso 6), acá del lado del Document Server. Ya está
montado en el compose de este repo (`./certs/mkcert-ca:/certs/mkcert-ca:ro`).

**Estado al momento de escribir esto**: con el JWT (puntos 1-3) Y los tres servicios propios (punto 4) Y la CA
(punto 5) todos correctos — confirmado cada uno por separado, con pruebas directas (`ConvertService.ashx` da
`Percent:100, EndConvert:true`; `nc -zv` confirma los tres puertos abiertos; los logs de Nextcloud confirman
`Download:` y `Track: ... result 0` sin error) — el botón "Abrir" TODAVÍA mostraba "Error de descarga" en el
navegador en la última prueba, sin ningún error nuevo en ninguno de los dos logs. La transferencia real del
documento pasa por WebSocket (socket.io) una vez que la sesión abre, fuera del alcance de lo que estas herramientas
pueden inspeccionar frame por frame — quedó sin diagnosticar más allá de este punto. Si esto vuelve a pasar: revisar
los logs del Document Server en nivel DEBUG (no solo WARN, que es el default) y/o las herramientas de desarrollador
del navegador en la pestaña Network filtrando por `ws`/`wss`, no solo HTTP.
