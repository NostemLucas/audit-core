import { type Tx } from '../../../platform/db/index.js'
import { DomainError } from '../../../platform/errors/index.js'
import { AuditErrors } from '../domain/errors.js'

// `createdById` es un sello plano, SIN relación (docs/01: "ids planos, sin FK, rellenados por la extensión de Prisma"):
// quién subió una evidencia se resuelve viendo a quién está asignado el criterio (`evaluation.assignedUser`), no aquí.

export function listEvidence(tx: Tx, evaluationId: string) {
  return tx.evidence.findMany({
    where: { evaluationId, deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
}

export function findEvidenceByStorageFileId(tx: Tx, storageFileId: string) {
  return tx.evidence.findUnique({ where: { storageFileId } })
}

export async function loadEvidence(tx: Tx, evaluationId: string, evidenceId: string) {
  const row = await tx.evidence.findFirst({ where: { id: evidenceId, evaluationId, deletedAt: null } })
  if (!row) throw new DomainError(AuditErrors.EVIDENCE_NOT_FOUND, { evaluationId, evidenceId })
  return row
}
