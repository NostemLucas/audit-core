# Audit Core

Backend de auditorías de seguridad y cumplimiento (NestJS + Prisma). La autenticación se delega por completo a
**Authentik** (OAuth2/OIDC) y el almacenamiento de archivos a **Nextcloud** (editados con **OnlyOffice**): este
backend no gestiona login, contraseñas ni archivos — solo valida el JWT de Authentik y habla con Nextcloud por su
API. Ver `docs/` para el diseño completo (`01-domain-model.md` es el punto de partida).

## Requisitos

- Node.js ≥ 22 (probado en 24) y npm.
- Docker + el plugin `compose` (para Postgres en desarrollo, o el stack completo en producción).
- Una instancia de **Authentik** con una aplicación OAuth2/OIDC ya creada, y una de **Nextcloud** con una cuenta de
  servicio — ninguna de las dos vive en este repositorio; se configuran aparte y solo se apunta a ellas por URL.

## Ejecutar

```bash
cp .env.example .env   # completar los valores reales (Authentik, Nextcloud, secretos)
```

### Desarrollo (recarga en caliente)

```bash
docker compose up -d postgres      # solo la base de datos
npm install
npx prisma migrate deploy          # aplica las migraciones
npm run dev                        # http://localhost:3000/api
```

`npm run seed` carga datos de ejemplo (organizaciones, escalas, plantillas ISO 27001/ASFI) — opcional, idempotente.

### Producción (todo en contenedores)

```bash
docker compose --profile prod up -d --build
```

Levanta Postgres, aplica las migraciones (`migrate`, una imagen que corre una vez y sale) y arranca la app
(`app`, que no empieza a aceptar tráfico hasta que `migrate` termina bien). Es el MISMO `docker-compose.yml` que en
desarrollo — la diferencia es el perfil (`prod`), no un archivo aparte. `docker compose logs -f app` para ver los
logs; `docker compose --profile prod down` para bajarlo (agregar `-v` para borrar también el volumen de Postgres).

Para regenerar las migraciones o el cliente de Prisma tras un cambio de esquema:
`npx prisma migrate dev --name <nombre>` (en desarrollo, contra el Postgres del compose).

## Comandos

```bash
npm run dev              # desarrollo con recarga en caliente
npm run build             # compila a dist/
npm run start:prod        # corre el build (lo que hace el contenedor `app`)
npm test                  # unitarios (mocks, sin BD)
npm run test:integration  # integración (Postgres real vía testcontainers — no hace falta levantar nada a mano)
npm run test:all          # ambos
npm run check              # tipos + lint + formato + fronteras de arquitectura + código muerto + unitarios (= CI)
npm run check:all          # check + integración
```

## Documentación

- `docs/01-domain-model.md` en adelante: diseño por fase, decisiones y su porqué.
- Swagger: `http://localhost:3000/api/docs` con el servidor corriendo.
- `GET /health/live` (el proceso responde) y `GET /health/ready` (BD obligatoria, Nextcloud informativo) — sin
  prefijo `/api`, para que un balanceador los consulte directo.
