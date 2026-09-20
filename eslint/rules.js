/**
 * ÚNICA definición de las reglas de calidad. `eslint.config.js` las aplica por carpeta y la prueba de reglas
 * (`test/lint/lint-rules.spec.ts`) las ejecuta contra fijaciones que las violan a propósito.
 *
 * Reglas CURADAS, no un preset: los presets `recommended-type-checked` traen decenas de reglas (`no-unsafe-*`,
 * `require-await`…) que chocan con el estilo de Prisma/Nest y ahogan las pocas que importan. Cada regla de aquí tiene un
 * motivo escrito.
 */

/** Un acceso `.status` no computado: `audit.status`. */
const STATUS = "MemberExpression[computed=false][property.name='status']"

/** Toda regla que necesita información de tipos. */
export const typeAwareRules = {
  // Un `await` olvidado en `bus.publish(...)` o en una llamada de Prisma deja al handler fuera del rollback o pierde el error.
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
  '@typescript-eslint/await-thenable': 'error',
  // Lanzar algo que no es un Error pierde el stack; el sistema lanza `DomainError` o `Error`.
  '@typescript-eslint/only-throw-error': 'error',
  // Agregar un estado o un valor a un enum debe obligar a decidir qué hace cada `switch`.
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
}

/** En todos los archivos, pruebas incluidas. */
export const baseRules = {
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
  ],
  // `@ts-ignore` esconde cualquier error futuro; `@ts-expect-error` exige que el error exista y una razón escrita.
  '@typescript-eslint/ban-ts-comment': [
    'error',
    { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, minimumDescriptionLength: 10 },
  ],
  eqeqeq: ['error', 'always'],
  'prefer-const': 'error',
  'no-var': 'error',
}

/** Solo en `src/`: el código de producción es estricto; las pruebas parsean JSON sin tipo y usan `any` con criterio. */
export const srcRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  // Se registra con `AppLogger` (docs/02 §13), nunca con `console`.
  'no-console': 'error',
  // Un archivo de más de 300 líneas mezcla responsabilidades (el proyecto anterior tenía servicios de 900).
  'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
}

/** `process.env` solo en `platform/config/env.ts` (única fuente de la configuración). */
export const processEnvRule = {
  'no-restricted-properties': [
    'error',
    {
      object: 'process',
      property: 'env',
      message: 'Lee la configuración de `platform/config` (Env), no de process.env.',
    },
  ],
}

/** El cliente generado de Prisma solo lo importan `platform/db`, `shared/enums.ts` y las `infrastructure/` de cada módulo. */
export const generatedImportRule = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['**/generated/prisma/**'],
          message:
            'El cliente generado solo lo importan platform/db, shared/enums.ts y */infrastructure/. Usa los enums de shared/enums.ts.',
        },
      ],
    },
  ],
}

/**
 * El estado de una entidad se consulta con su ciclo de vida (`lifecycle.can(...)` / `lifecycle.has(...)`), no
 * comparando `.status` (docs/03 §2.3, regla 1). Solo en el código de los módulos y fuera de los `*.lifecycle.ts`.
 */
export const statusRule = {
  'no-restricted-syntax': [
    'error',
    {
      selector: `BinaryExpression[operator=/^[!=]==?$/] > ${STATUS}`,
      message:
        'No compares `.status`: usa el ciclo de vida (`lifecycle.can` / `lifecycle.has`). Solo el `*.lifecycle.ts` conoce los estados.',
    },
    {
      selector: `SwitchStatement > ${STATUS}.discriminant`,
      message: 'No hagas `switch` sobre `.status`: usa el ciclo de vida (`lifecycle.can` / `lifecycle.has`).',
    },
  ],
}
