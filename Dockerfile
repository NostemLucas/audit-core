# Multi-stage: `build` compila con TODAS las dependencias (incluida `prisma`, el CLI de migraciones);
# `runtime` solo lleva lo que hace falta para correr `node dist/main.js`. `docker-compose.yml` usa
# el target `build` como imagen efímera para `prisma migrate deploy` (así el runtime no carga el CLI).
#
# `openssl`: Prisma lo necesita para identificar la libc/libssl del sistema (si falta, solo avisa y asume una
# versión, pero mejor no depender de eso). `node:24-slim` (Debian) no lo trae por defecto.

FROM node:24-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# `--ignore-scripts`: `postinstall` (`prisma generate`) necesita `prisma/schema.prisma`, que todavía no existe en
# esta capa (solo se copió `package.json`, a propósito, para que cambios en el código no invaliden esta capa). El
# `build` de abajo corre `prisma generate` explícitamente (su propio `prebuild`) una vez que copia todo el código.
RUN npm ci --ignore-scripts

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Igual que arriba: sin `prisma` instalado aquí (es solo de `build`), así que también sin su `postinstall`. El
# cliente generado ya viaja compilado dentro de `dist/` (`nest build` lo compila como cualquier otro archivo de
# `src/`), así que no hace falta generarlo de nuevo.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
