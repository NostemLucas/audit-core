# Authentik local

Identidad para todo lo demás: `audit-core` valida el JWT contra esto, y Nextcloud (opcional, ver `../nextcloud/`)
delega su propio login acá también, con el mismo usuario.

## 1. Levantar el contenedor

```bash
cp .env.example .env
# completar PG_PASS y AUTHENTIK_SECRET_KEY (openssl rand -base64 36 para cada uno)
docker compose up -d
```

Esperar a que responda `http://localhost:9000/if/flow/initial-setup/` — la PRIMERA vez, Authentik pide crear la
cuenta `akadmin` ahí mismo (contraseña a elección; no hay forma de saltarse este paso por API, es el único manual).

## 2. Generar un token de administrador

Admin UI → **Directory → Tokens** → crear uno nuevo, tipo API, para el usuario `akadmin`. Copiar el valor a `.env`
como `AUTHENTIK_BOOTSTRAP_TOKEN` (no hace falta reiniciar nada, `setup.py` lo lee del entorno al correr).

## 3. Aprovisionar todo lo demás

```bash
set -a && source .env && set +a
python3 setup.py
```

Es **idempotente**: crea grupos (`ADMIN`/`GERENTE`/`AUDITOR`), los tres usuarios de prueba (`gerente1`, `auditor1`,
`auditor2`, contraseña = `TEST_USERS_PASSWORD` de `.env`), el property mapping `audit-core: groups claim` (mete los
grupos del usuario en el claim `profile` del JWT — es lo que `audit-core` lee para mapear `Role`), y los dos
providers OIDC + sus aplicaciones (`audit-core`, `nextcloud`). Correrlo de nuevo después de tocar algo a mano no
rompe nada — cada paso primero busca por nombre, y si ya existe, no lo toca.

Si tu Nextcloud (ver `../nextcloud/`) va a vivir en otra IP LAN que no sea `192.168.0.11`, exportar
`NEXTCLOUD_PUBLIC_URL=https://<tu-ip>.sslip.io:8443` antes de correr `setup.py` para que el `redirect_uri` del
provider "nextcloud" quede bien desde el principio (si no, se puede corregir después con un
`PATCH /api/v3/providers/oauth2/<id>/` a mano).

Al final imprime los `client_id`/`client_secret` a copiar en `audit-core/.env`, `frontend-v2/.env`, y el comando
`occ user_oidc:provider` de Nextcloud.
