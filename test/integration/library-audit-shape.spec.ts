import { beforeEach, describe, expect, it } from 'vitest'
import { createAuditFixture, directDb, resetDb } from './support/db.js'

const db = directDb()
beforeEach(() => resetDb(db))

describe('Escala: una lista de niveles, sin tipo ni presentación', () => {
  it('Scale guarda solo nombre y disponibilidad (sin code, type ni description)', async () => {
    const scale = await db.scale.create({ data: { name: 'COBIT 5' } })
    expect(Object.keys(scale).sort()).toEqual([
      'createdAt',
      'createdById',
      'id',
      'isActive',
      'name',
      'updatedAt',
      'updatedById',
    ])
    expect(scale.isActive).toBe(true)
  })

  it('ScaleLevel guarda lo que la lógica y los informes leen: value, label y description opcional', async () => {
    const scale = await db.scale.create({ data: { name: 'Binaria' } })
    const level = await db.scaleLevel.create({ data: { scaleId: scale.id, value: 0, label: 'No cumple' } })
    expect(Object.keys(level).sort()).toEqual([
      'createdAt',
      'description',
      'id',
      'label',
      'scaleId',
      'updatedAt',
      'value',
    ])
    expect(level.description).toBeNull()
  })

  it('"binaria" no es un tipo: es tener 2 niveles (se deriva, no se guarda)', async () => {
    const scale = await db.scale.create({
      data: {
        name: 'Binaria',
        levels: {
          create: [
            { value: 0, label: 'No cumple' },
            { value: 1, label: 'Cumple' },
          ],
        },
      },
      include: { levels: true },
    })
    expect(scale.levels).toHaveLength(2)
  })

  it('el orden de los niveles es el del valor (no hay position)', async () => {
    const scale = await db.scale.create({ data: { name: 'CMMI' } })
    await db.scaleLevel.createMany({
      data: [
        { scaleId: scale.id, value: 3, label: 'Definido' },
        { scaleId: scale.id, value: 1, label: 'Inicial' },
        { scaleId: scale.id, value: 2, label: 'Repetible' },
      ],
    })
    const ordered = await db.scaleLevel.findMany({ where: { scaleId: scale.id }, orderBy: { value: 'asc' } })
    expect(ordered.map((l) => l.label)).toEqual(['Inicial', 'Repetible', 'Definido'])
  })
})

describe('Plantilla', () => {
  it('Template guarda nombre y estado (sin description)', async () => {
    const tpl = await db.template.create({ data: { name: 'ISO/IEC 27001:2022' } })
    expect(Object.keys(tpl).sort()).toEqual([
      'createdAt',
      'createdById',
      'id',
      'name',
      'status',
      'updatedAt',
      'updatedById',
    ])
    expect(tpl.status).toBe('DRAFT')
  })
})

describe('Alcance: propio de la auditoría', () => {
  it('sin elementos = toda la organización; un elemento es solo un nombre dentro de ESA auditoría', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    const audit = await createAuditFixture(db, org.id)
    expect(await db.auditScopeItem.count({ where: { auditId: audit.id } })).toBe(0)
    const item = await db.auditScopeItem.create({ data: { auditId: audit.id, name: 'ERP' } })
    expect(Object.keys(item).sort()).toEqual(['auditId', 'createdAt', 'id', 'name'])
  })

  it('el alcance desaparece con su auditoría (cascada), sin dejar huérfanos', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    const audit = await createAuditFixture(db, org.id)
    await db.auditScopeItem.createMany({
      data: [
        { auditId: audit.id, name: 'ERP' },
        { auditId: audit.id, name: 'CRM' },
      ],
    })
    await db.audit.delete({ where: { id: audit.id } })
    expect(await db.auditScopeItem.count()).toBe(0)
  })

  it('la auditoría no guarda fecha de inicio real ni modo de alcance (se derivan de eventos / de los elementos)', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    const audit = await createAuditFixture(db, org.id)
    expect(audit).not.toHaveProperty('startedAt')
    expect(audit).not.toHaveProperty('scopeMode')
  })
})

describe('Equipo e informes: solo lo que se consume', () => {
  it('AuditMember no guarda notas', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    const audit = await createAuditFixture(db, org.id)
    const member = await db.auditMember.create({ data: { auditId: audit.id, userId: audit.managerId } })
    expect(Object.keys(member).sort()).toEqual(['auditId', 'createdAt', 'id', 'role', 'updatedAt', 'userId'])
  })

  it('Report no copia el nombre ni el tamaño del archivo (son de Nextcloud)', async () => {
    const org = await db.organization.create({ data: { name: 'ACME' } })
    const audit = await createAuditFixture(db, org.id)
    const report = await db.report.create({
      data: { auditId: audit.id, title: 'Informe final', storageFileId: 'nc-123' },
    })
    expect(report).not.toHaveProperty('fileName')
    expect(report).not.toHaveProperty('size')
  })
})
