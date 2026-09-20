import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'
import { baseRules, generatedImportRule, processEnvRule, srcRules, statusRule, typeAwareRules } from '../../eslint/rules.js'

/** Aplica TODAS las reglas a las fijaciones, sin el alcance por carpeta, para comprobar que cada regla funciona. */
export default defineConfig([
  {
    files: ['*.ts'],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { ...baseRules, ...typeAwareRules, ...srcRules, ...processEnvRule, ...generatedImportRule, ...statusRule },
  },
])
