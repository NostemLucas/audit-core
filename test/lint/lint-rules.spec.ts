import { join } from 'node:path'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Prueba de las REGLAS de calidad (no del código del proyecto):
 *  - cada regla se ejecuta contra una fijación que la viola a propósito y debe dar EXACTAMENTE esos hallazgos;
 *  - el código correcto y el código Nest con decoradores no deben dar ninguno (sin falsos positivos);
 *  - el alcance por carpeta (dónde aplica cada regla) queda fijado.
 * Si alguien desactiva una regla, o una actualización de ESLint/typescript-eslint cambia su comportamiento, falla aquí.
 */
const ROOT = join(import.meta.dirname, '..', '..')
const FIXTURES = join(ROOT, 'test', 'lint-fixtures')

describe('reglas de calidad contra fijaciones que las violan', () => {
  let found: Map<string, string[]>

  beforeAll(async () => {
    const eslint = new ESLint({ cwd: FIXTURES, overrideConfigFile: 'eslint.config.js' })
    const results = await eslint.lintFiles(['*.ts'])
    found = new Map(
      results.map((r) => [
        r.filePath.split('/').pop()!,
        r.messages.map((m) => `${m.ruleId ?? 'ERROR-DE-ANÁLISIS'}:${m.line}`),
      ]),
    )
  }, 60_000)

  const expectFindings = (file: string, expected: string[]) => expect(found.get(file)).toEqual(expected)

  it('sin falsos positivos: código correcto (await, Promise.all, void explícito)', () => {
    expectFindings('clean.ts', [])
  })

  it('sin falsos positivos: controlador Nest con decoradores y parámetros con @Inject', () => {
    expectFindings('r6-nest.ts', [])
  })

  it('.status: prohíbe comparar (=== y !==) y hacer switch, para forzar el uso del ciclo de vida', () => {
    expectFindings('r1-status.ts', [
      'no-restricted-syntax:2',
      'no-restricted-syntax:3',
      '@typescript-eslint/switch-exhaustiveness-check:4',
      'no-restricted-syntax:4',
    ])
  })

  it('process.env: prohibido (la configuración sale de platform/config)', () => {
    expectFindings('r2-env.ts', ['no-restricted-properties:1', 'no-restricted-properties:2'])
  })

  it('any y @ts-ignore: prohibidos', () => {
    expectFindings('r3-any.ts', ['@typescript-eslint/no-explicit-any:1', '@typescript-eslint/ban-ts-comment:2'])
  })

  it('promesas: flotante (sin await ni catch), condicional con promesa y await de un valor que no lo es', () => {
    expectFindings('r4-promises.ts', [
      '@typescript-eslint/no-floating-promises:7',
      '@typescript-eslint/no-floating-promises:11',
      '@typescript-eslint/no-misused-promises:15',
      '@typescript-eslint/await-thenable:18',
    ])
  })

  it('promesas con los tipos REALES del proyecto: Prisma ($extends), el bus de eventos, $transaction y cls.run', () => {
    // Es lo que Biome NO detectaba (su inferencia de tipos no resuelve estos tipos) y por lo que se descartó.
    // Un `await` olvidado aquí deja a un handler fuera del rollback o pierde el error sin avisar.
    expectFindings('r9-real-floating.ts', [
      '@typescript-eslint/no-unused-vars:4',
      '@typescript-eslint/no-floating-promises:9',
      '@typescript-eslint/no-floating-promises:10',
      '@typescript-eslint/no-floating-promises:11',
      '@typescript-eslint/no-floating-promises:12',
    ])
  })

  it('cliente generado de Prisma: import restringido', () => {
    expectFindings('r5-import.ts', ['no-restricted-imports:1'])
  })

  it('imports y variables sin usar', () => {
    expectFindings('r7-unused.ts', ['@typescript-eslint/no-unused-vars:1', '@typescript-eslint/no-unused-vars:4'])
  })

  it('archivos de más de 300 líneas', () => {
    expectFindings('r8-long.ts', ['max-lines:301'])
  })
})

describe('alcance por carpeta: dónde aplica cada regla', () => {
  const eslint = new ESLint({ cwd: ROOT })
  type Config = Awaited<ReturnType<ESLint['calculateConfigForFile']>>

  const severity = (config: Config, rule: string): 'error' | 'off' => {
    const value = config.rules?.[rule] as unknown
    const level = Array.isArray(value) ? value[0] : value
    return level === 2 || level === 'error' ? 'error' : 'off'
  }
  const rule = async (file: string, name: string) => severity(await eslint.calculateConfigForFile(file), name)
  const maxLines = async (file: string) =>
    (await eslint.calculateConfigForFile(file)).rules?.['max-lines']?.[1]?.max as number

  it('.status: solo en el código de los módulos, y NO en los *.lifecycle.ts', async () => {
    expect(await rule('src/modules/audits/audit.service.ts', 'no-restricted-syntax')).toBe('error')
    expect(await rule('src/modules/audits/domain/audit.lifecycle.ts', 'no-restricted-syntax')).toBe('off')
    // `res.status` (HTTP) y `result.status` (Promise.allSettled) no son estados de una entidad:
    expect(await rule('src/platform/http/access-log.ts', 'no-restricted-syntax')).toBe('off')
    expect(await rule('test/http.spec.ts', 'no-restricted-syntax')).toBe('off')
  })

  it('process.env: prohibido en src, salvo en platform/config/env.ts; libre en pruebas y herramientas', async () => {
    expect(await rule('src/platform/http/request-id.ts', 'no-restricted-properties')).toBe('error')
    expect(await rule('src/platform/config/env.ts', 'no-restricted-properties')).toBe('off')
    expect(await rule('test/integration/global-setup.ts', 'no-restricted-properties')).toBe('off')
    expect(await rule('prisma.config.ts', 'no-restricted-properties')).toBe('off')
  })

  it('cliente de Prisma: solo platform/db, shared/enums.ts y */infrastructure/', async () => {
    expect(await rule('src/modules/audits/audit.service.ts', 'no-restricted-imports')).toBe('error')
    expect(await rule('src/platform/http/problem.ts', 'no-restricted-imports')).toBe('error')
    for (const allowed of [
      'src/platform/db/create-db.ts',
      'src/shared/enums.ts',
      'src/modules/audits/infrastructure/audit.repository.ts',
    ]) {
      expect(await rule(allowed, 'no-restricted-imports'), allowed).toBe('off')
    }
  })

  it('any, console y tamaño de archivo: estrictos en src, más holgados en pruebas', async () => {
    expect(await rule('src/platform/http/problem.ts', '@typescript-eslint/no-explicit-any')).toBe('error')
    expect(await rule('src/platform/http/problem.ts', 'no-console')).toBe('error')
    expect(await maxLines('src/platform/http/problem.ts')).toBe(300)
    expect(await rule('test/http.spec.ts', '@typescript-eslint/no-explicit-any')).toBe('off')
    expect(await rule('src/platform/logging/logging.spec.ts', '@typescript-eslint/no-explicit-any')).toBe('off')
    expect(await maxLines('test/http.spec.ts')).toBe(600)
  })

  it('las reglas con tipos aplican en todo el código, pruebas incluidas', async () => {
    for (const file of ['src/platform/http/problem.ts', 'test/http.spec.ts', 'test/integration/db-errors.spec.ts']) {
      expect(await rule(file, '@typescript-eslint/no-floating-promises'), file).toBe('error')
    }
  })
})
