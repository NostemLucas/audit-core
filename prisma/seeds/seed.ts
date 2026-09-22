/**
 * Datos de EJEMPLO para trabajar contra algo real (docs/08 §2), no fixtures de test (esas viven en
 * `test/integration/support/`). Corre dentro de un contexto de aplicación real, a través de los MISMOS casos de uso
 * que expone la API: lo que crea es exactamente lo que crearía alguien usando la interfaz. Idempotente (los nombres
 * únicos ya lo garantizan: volver a correrlo falla en `_NAME_TAKEN`, que este script trata como "ya existe, seguir").
 *
 * No crea usuarios (identity: la única fuente es el primer login por Authentik) ni auditorías de ejemplo (exigen un
 * manager real). `npm run seed`.
 */
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import '../../src/app-errors.js' // registra el catálogo de errores (lo necesita el traductor de errores de la BD)
import { OrganizationsModule } from '../../src/modules/organizations/index.js'
import { LibraryModule } from '../../src/modules/library/index.js'
import { ContextModule } from '../../src/platform/context/context.module.js'
import { ContextRunner } from '../../src/platform/context/context-runner.js'
import { EnvModule } from '../../src/platform/config/index.js'
import { DomainError } from '../../src/platform/errors/index.js'
import { CreateOrganizationUseCase } from '../../src/modules/organizations/use-cases/create-organization.use-case.js'
import { CreateScaleUseCase } from '../../src/modules/library/scales/use-cases/create-scale.use-case.js'
import { CreateTemplateUseCase } from '../../src/modules/library/templates/use-cases/create-template.use-case.js'
import { CreateControlUseCase } from '../../src/modules/library/templates/use-cases/create-control.use-case.js'
import { PublishTemplateUseCase } from '../../src/modules/library/templates/use-cases/publish-template.use-case.js'
import { SetSuggestedFindingUseCase } from '../../src/modules/library/templates/use-cases/set-suggested-finding.use-case.js'

/**
 * Solo lo que este script necesita: `EnvModule`/`ContextModule` (config, transacciones) y los dos módulos de negocio
 * que siembra. NO el `AppModule` completo — arrastraría `AuthGuard`/`AbilitiesGuard` (pensados para HTTP; fuera de un
 * `NestFactory.create` real, uno de sus proveedores queda `undefined` y el arranque falla) sin que este script los use.
 *
 * Se arranca con `NestFactory.create` (no `createApplicationContext`) SIN llamar nunca a `listen()`: `nestjs-cls`
 * exige `HttpAdapterHost` en el constructor de su módulo raíz aunque no vaya a usarlo (`middleware.mount` es `false`
 * por defecto, y así queda: el middleware real se monta a mano en `configure-app.ts`), y ese proveedor solo existe
 * cuando hay un adaptador HTTP de verdad detrás — `createApplicationContext` no lo trae. Se descubrió corriendo este
 * script: `ContextRunner` no tenía, hasta ahora, ningún punto de entrada que lo probara.
 */
@Module({ imports: [EnvModule, ContextModule, OrganizationsModule, LibraryModule] })
class SeedModule {}

interface ControlNode {
  readonly title: string
  readonly reference?: string
  readonly kids?: readonly ControlNode[]
}

/** Ya existe (nombre repetido): no es un fallo del seed, es que ya se corrió antes. Cualquier otro error, sí lo es. */
function alreadyExists(error: unknown): boolean {
  return error instanceof DomainError && error.code.endsWith('_NAME_TAKEN')
}

async function seedOrganizations(useCase: CreateOrganizationUseCase): Promise<void> {
  for (const name of ['Banco Ejemplo S.A.', 'Cooperativa Ejemplo R.L.', 'Fintech Ejemplo S.A.']) {
    try {
      await useCase.execute({ name })
      console.log(`  organización: ${name}`)
    } catch (error) {
      if (!alreadyExists(error)) throw error
    }
  }
}

/** Crea el árbol y devuelve el id de cada hoja por su título (alcanza para un seed curado, sin títulos repetidos). */
async function seedControls(
  useCase: CreateControlUseCase,
  templateId: string,
  nodes: readonly ControlNode[],
  parentId: string | null = null,
): Promise<Map<string, string>> {
  const leafIds = new Map<string, string>()
  for (const node of nodes) {
    const rows = await useCase.execute(templateId, { parentId, title: node.title, reference: node.reference })
    const created = rows.find((row) => row.parentId === parentId && row.title === node.title)!
    if (node.kids) {
      for (const [title, id] of await seedControls(useCase, templateId, node.kids, created.id)) leafIds.set(title, id)
    } else {
      leafIds.set(node.title, created.id)
    }
  }
  return leafIds
}

const ISO27001_TREE: ControlNode[] = [
  {
    title: 'Organización de la seguridad de la información',
    reference: 'A.5',
    kids: [
      { title: 'Roles y responsabilidades de seguridad', reference: 'A.5.2' },
      { title: 'Segregación de funciones', reference: 'A.5.3' },
    ],
  },
  {
    title: 'Gestión de activos',
    reference: 'A.5.9',
    kids: [
      { title: 'Inventario de activos de información', reference: 'A.5.9' },
      { title: 'Uso aceptable de los activos', reference: 'A.5.10' },
    ],
  },
  {
    title: 'Control de acceso',
    reference: 'A.5.15',
    kids: [
      { title: 'Gestión de altas y bajas de usuarios', reference: 'A.5.16' },
      { title: 'Revisión periódica de accesos', reference: 'A.5.18' },
    ],
  },
]

const COBIT5_TREE: ControlNode[] = [
  {
    title: 'APO13 — Gestionar la seguridad',
    kids: [
      { title: 'Sistema de gestión de seguridad de la información establecido', reference: 'APO13.01' },
      { title: 'Plan de tratamiento de riesgos de seguridad', reference: 'APO13.02' },
    ],
  },
  {
    title: 'DSS05 — Gestionar los servicios de seguridad',
    kids: [
      { title: 'Protección contra software malicioso', reference: 'DSS05.01' },
      { title: 'Gestión de la seguridad de la red', reference: 'DSS05.02' },
    ],
  },
]

async function seedIso27001(
  templates: CreateTemplateUseCase,
  controls: CreateControlUseCase,
  publish: PublishTemplateUseCase,
  findings: SetSuggestedFindingUseCase,
  /** Nivel mínimo ("No cumple") de la escala de conformidad, si se pudo crear en esta corrida. */
  minLevelId: string | undefined,
): Promise<void> {
  const template = await templates.execute({ name: 'ISO/IEC 27001 (ejemplo)' })
  const leaves = await seedControls(controls, template.id, ISO27001_TREE)
  await publish.execute(template.id)
  const rolesId = leaves.get('Roles y responsabilidades de seguridad')
  if (rolesId && minLevelId) {
    await findings.execute(template.id, rolesId, minLevelId, {
      text: 'No hay un responsable de seguridad designado formalmente, ni evidencia de que sus funciones estén documentadas.',
    })
  }
  console.log(`  plantilla: ${template.name} (publicada, ${leaves.size} criterios)`)
}

async function seedCobit5(
  templates: CreateTemplateUseCase,
  controls: CreateControlUseCase,
  publish: PublishTemplateUseCase,
): Promise<void> {
  const template = await templates.execute({ name: 'COBIT 5 — Seguridad (ejemplo)' })
  const leaves = await seedControls(controls, template.id, COBIT5_TREE)
  await publish.execute(template.id)
  console.log(`  plantilla: ${template.name} (publicada, ${leaves.size} criterios)`)
}

async function seedLibrary(app: Awaited<ReturnType<typeof NestFactory.create>>): Promise<void> {
  const createScale = app.get(CreateScaleUseCase)
  const createTemplate = app.get(CreateTemplateUseCase)
  const createControl = app.get(CreateControlUseCase)
  const publishTemplate = app.get(PublishTemplateUseCase)
  const setSuggestedFinding = app.get(SetSuggestedFindingUseCase)

  let conformity: Awaited<ReturnType<typeof createScale.execute>> | undefined
  try {
    conformity = await createScale.execute({
      name: 'Conformidad ISO 27001 (ejemplo)',
      dimension: 'CONFORMITY',
      levels: [
        { value: 0, label: 'No cumple' },
        { value: 50, label: 'Cumple parcialmente' },
        { value: 100, label: 'Cumple' },
      ],
    })
    console.log(`  escala: ${conformity.name}`)
  } catch (error) {
    if (!alreadyExists(error)) throw error
  }

  try {
    const maturity = await createScale.execute({
      name: 'Capacidad COBIT 5 (ejemplo)',
      dimension: 'MATURITY',
      levels: [
        { value: 0, label: '0 — Incompleto' },
        { value: 1, label: '1 — Ejecutado' },
        { value: 2, label: '2 — Gestionado' },
        { value: 3, label: '3 — Establecido' },
        { value: 4, label: '4 — Predecible' },
        { value: 5, label: '5 — Optimizado' },
      ],
    })
    console.log(`  escala: ${maturity.name}`)
  } catch (error) {
    if (!alreadyExists(error)) throw error
  }

  const minLevel = conformity?.levels.find((level) => level.label === 'No cumple')
  try {
    await seedIso27001(createTemplate, createControl, publishTemplate, setSuggestedFinding, minLevel?.id)
  } catch (error) {
    if (!alreadyExists(error)) throw error
  }

  try {
    await seedCobit5(createTemplate, createControl, publishTemplate)
  } catch (error) {
    if (!alreadyExists(error)) throw error
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.create(SeedModule, { logger: ['warn', 'error'] })
  const runner = app.get(ContextRunner)
  await runner.run('seed', async () => {
    console.log('Organizaciones de ejemplo:')
    await seedOrganizations(app.get(CreateOrganizationUseCase))
    console.log('Biblioteca de ejemplo:')
    await seedLibrary(app)
  })
  await app.close()
  console.log('Listo.')
}

await main()
