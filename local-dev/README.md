# Entorno local: Authentik + Nextcloud reales

Cómo levantar, desde cero, las dos dependencias externas de `audit-core` (identidad y almacenamiento de archivos) tal
como se probaron de punta a punta el 2026-09-27/28: Authentik real (no un stub de JWT) y Nextcloud real (no un mock de
sus respuestas) con el webhook de evidencia funcionando por push, no por sondeo.

Esto vive **dentro de este repo a propósito**, aunque `docs/07` §1.2 decía "el runbook de despliegue, no este repo":
esa nota describía una situación hipotética (Nextcloud administrado por otro equipo); acá se decidió que, mientras el
entorno de referencia para probar el backend sea este mismo, el cómo reproducirlo va junto al código que lo necesita.

## Por qué esto no es "otro docker-compose más"

Las dos partes difíciles, ya resueltas acá:

1. **Un solo nombre que signifique lo mismo en todos lados.** Authentik corre en el host, Nextcloud en contenedores;
   el navegador necesita hablarles a los dos, y el proceso de Nextcloud (server-side, para el intercambio de tokens
   OIDC) necesita hablarle a Authentik también. "`localhost`" significa una cosa distinta según quién lo use — no
   sirve. La solución es `<tu-ip-lan>.sslip.io`: un nombre DNS público de verdad que resuelve a tu propia IP LAN desde
   cualquier lado (el navegador del host, cualquier contenedor). Ver `nextcloud/README.md`.
2. **El webhook de evidencia, andando de verdad, no simulado.** `audit-core` exige un contrato propio (`docs/07`
   §1.2); Nextcloud no lo habla nativo. `nextcloud/webhook-adapter.mjs` es el traductor — ver ese README para el
   porqué de cada pieza (un worker de background jobs dedicado, el sondeo de 60s solo para borrados porque la
   papelera de Nextcloud no dispara el evento nativo de borrado, etc.).

## Orden para levantar todo desde cero

1. `authentik/` — Authentik + los dos providers OIDC (audit-core, nextcloud) + grupos/usuarios de prueba.
2. `nextcloud/` — Nextcloud + certificado + CORS + el webhook funcionando.
3. Volver a `audit-core/.env` (raíz del repo) y `frontend-v2/.env` con los valores que los scripts de arriba imprimen.

Cada subcarpeta tiene su propio README con los comandos exactos.
