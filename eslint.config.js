import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import { baseRules, generatedImportRule, processEnvRule, srcRules, statusRule, typeAwareRules } from './eslint/rules.js'

/** Las reglas viven en `eslint/rules.js`; aquí solo se decide EN QUÉ CARPETAS aplica cada una (probado en test/lint). */
export default defineConfig([
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'src/generated/**',
      'prisma/migrations/**',
      'test/lint-fixtures/**',
    ],
  },

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { ...baseRules, ...typeAwareRules },
  },

  { files: ['src/**/*.ts'], rules: { ...srcRules, ...processEnvRule, ...generatedImportRule } },

  // Excepciones de ubicación (cada una es la razón de ser de la regla):
  { files: ['src/platform/config/env.ts'], rules: { 'no-restricted-properties': 'off' } },
  {
    files: ['src/platform/db/**/*.ts', 'src/shared/enums.ts', 'src/modules/*/infrastructure/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // El estado solo lo conoce el ciclo de vida de cada entidad.
  { files: ['src/modules/**/*.ts'], ignores: ['**/*.lifecycle.ts'], rules: statusRule },

  // Las pruebas son largas por naturaleza.
  {
    files: ['test/**/*.ts', 'src/**/*.spec.ts'],
    rules: {
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
