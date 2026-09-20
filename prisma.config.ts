import { defineConfig } from 'prisma/config'

// `prisma generate` no se conecta a la base: el marcador evita exigir DATABASE_URL en instalaciones y CI que solo
// generan el cliente. Los comandos que sí se conectan (migrate deploy…) fallan visiblemente con el marcador.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://sin-configurar:sin-configurar@localhost:5432/sin-configurar',
  },
})
