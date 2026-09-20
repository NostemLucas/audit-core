/**
 * Los enums se declaran UNA vez, en `prisma/schema.prisma`. Este archivo es el único punto por el que el resto
 * del código los importa (nadie importa el cliente generado directamente). Si algún día se cambia de ORM, se
 * reemplaza solo este archivo por definiciones propias.
 * Un test verifica que aquí estén TODOS los enums del schema.
 */
export {
  AuditRole,
  AuditStatus,
  EvaluationStatus,
  ReportType,
  ReviewAction,
  Role,
  TemplateStatus,
} from '../generated/prisma/enums.js'
