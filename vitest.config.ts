import { defineConfig } from 'vitest/config'

// Pruebas rápidas, sin base de datos. Las de integración (Postgres real) tienen su propia configuración.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
    environment: 'node',
  },
})
