import { defineConfig } from 'vitest/config'

// Postgres real en un contenedor (testcontainers). Se ejecuta en serie: todos los archivos comparten una base.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.spec.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
