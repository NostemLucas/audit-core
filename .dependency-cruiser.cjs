/**
 * ÚNICA fuente de las fronteras de arquitectura (docs/02 §2, §4 y §13). Reemplaza al test de arquitectura casero.
 * Se ejecuta con `npm run deps`. Nota: `tsPreCompilationDeps` hace que también cuenten los imports de solo tipos
 * (`import type { Request } from 'express'` ya es conocer Express).
 */

/** Contextos que NO pueden conocer HTTP (docs/02 §13): logger, contexto ambiental, eventos y base de datos. */
const NEUTRAL = '^src/platform/(logging|context|events|db)/'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'sin-ciclos',
      severity: 'error',
      comment:
        'Un ciclo entre archivos hace imposible razonar sobre la carga y rompe la inyección de dependencias en ESM. Los ciclos solo de tipos son inocuos.',
      from: {},
      to: { circular: true, dependencyTypesNot: ['type-only'] },
    },

    // ── Capas ──────────────────────────────────────────────────────────────────────────────────────────────────
    {
      name: 'platform-no-importa-modulos',
      severity: 'error',
      comment:
        'La plataforma no conoce el negocio; habla con él por puertos (p. ej. USER_RESOLVER). Solo la raíz de composición (src/app*.ts) ve ambos lados.',
      from: { path: '^src/platform/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'shared-no-importa-el-proyecto',
      severity: 'error',
      comment:
        'shared solo contiene tipos puros; su única dependencia es el cliente generado (para reexportar los enums).',
      from: { path: '^src/shared/' },
      to: { path: '^src/(platform|modules)/' },
    },
    {
      name: 'dominio-puro',
      severity: 'error',
      comment:
        'domain/ es TypeScript puro: sin Nest, Express, Prisma ni infraestructura. Solo puede usar shared y, de la plataforma, errores y ciclos de vida.',
      from: { path: '^src/modules/[^/]+/domain/' },
      to: {
        path: [
          '^node_modules/@nestjs/',
          '^node_modules/(@types/)?express',
          '^node_modules/pino',
          '^src/generated/',
          '^src/platform/',
        ],
        pathNot: '^src/platform/(errors|state)/',
      },
    },

    // ── Contextos separados: logging ≠ HTTP (docs/02 §13) ──────────────────────────────────────────────────────
    {
      name: 'contextos-neutrales-no-conocen-http',
      severity: 'error',
      comment:
        'Logger, contexto ambiental, eventos y base de datos funcionan igual en un job que en una petición: no pueden depender de HTTP. La dependencia va http → logging → context.',
      from: { path: NEUTRAL },
      to: {
        path: [
          '^src/platform/(http|auth|authz|health)/',
          '^node_modules/(@types/)?express',
          '^node_modules/@nestjs/platform-express',
          '^node_modules/helmet',
        ],
      },
    },

    // ── Fronteras entre módulos ────────────────────────────────────────────────────────────────────────────────
    {
      name: 'modulos-solo-por-su-index',
      severity: 'error',
      comment:
        'Un módulo solo importa a otro por su index.ts (API pública). Nadie toca los archivos internos de otro módulo.',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/([^/]+)/', pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index\\.ts$'] },
    },

    // ── El cliente generado ────────────────────────────────────────────────────────────────────────────────────
    {
      name: 'cliente-generado-solo-donde-corresponde',
      severity: 'error',
      comment:
        'El cliente generado de Prisma solo lo importan platform/db, shared/enums.ts y las infrastructure/ de cada módulo. El resto usa shared/enums.ts.',
      from: {
        path: '^src/',
        pathNot: [
          '^src/generated/',
          '^src/platform/db/',
          '^src/shared/enums\\.ts$',
          '^src/modules/[^/]+/infrastructure/',
        ],
      },
      to: { path: '^src/generated/' },
    },
  ],

  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    // El cliente generado SÍ está en el grafo (para poder prohibir quién lo importa) pero no se recorre por dentro.
    doNotFollow: { path: ['node_modules', '^src/generated/'] },
    moduleSystems: ['es6', 'cjs'],
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
