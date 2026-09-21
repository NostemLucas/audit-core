import { defineErrors } from '../../platform/errors/index.js'

export const LibraryErrors = defineErrors({
  // ── Escalas ────────────────────────────────────────────────────────────────
  SCALE_NOT_FOUND: { http: 404, message: 'Escala no encontrada' },
  SCALE_INACTIVE: { http: 422, message: 'La escala está inactiva' },
  SCALE_NAME_TAKEN: { http: 409, message: 'Ya existe una escala con ese nombre', onUnique: 'scales_name_lower_key' },
  SCALE_IN_USE: {
    http: 409,
    message: 'La escala está en uso (por auditorías o por hallazgos sugeridos); desactívala en lugar de eliminarla',
    onForeignKeyDelete: 'audits_scaleId_fkey',
  },
  /**
   * La escala viola una invariante (`details.rule`): MIN_LEVELS (al menos 2 opciones), DUPLICATE_VALUE o
   * DUPLICATE_LABEL (sin distinguir mayúsculas ni espacios). Es lo único que queda de los antiguos tipos
   * RANGE/BINARY/QUALITATIVE.
   */
  SCALE_LEVELS_INVALID: { http: 422, message: 'Las opciones de la escala no son válidas' },
  /**
   * Una vez usada en una auditoría, la estructura de la escala (agregar o quitar opciones, cambiar un puntaje) queda
   * congelada: cambiaría el significado de lo ya evaluado. Solo se corrigen etiquetas y descripciones; para otra
   * estructura se crea otra escala (igual que una plantilla publicada: clonar para corregir).
   */
  SCALE_STRUCTURE_LOCKED: {
    http: 409,
    message: 'La escala ya se usó en una auditoría; solo pueden editarse las etiquetas y descripciones de sus opciones',
  },
  SCALE_LEVEL_NOT_FOUND: { http: 404, message: 'Nivel de escala no encontrado' },
  SCALE_LEVEL_VALUE_TAKEN: {
    http: 409,
    message: 'La escala ya tiene un nivel con ese valor',
    onUnique: 'scale_levels_scaleId_value_key',
  },
  SCALE_LEVEL_IN_USE: {
    http: 409,
    message: 'La opción está en uso (por evaluaciones o por hallazgos sugeridos)',
    onForeignKeyDelete: [
      'evaluations_expectedLevelId_fkey',
      'evaluations_achievedLevelId_fkey',
      'suggested_findings_levelId_fkey',
    ],
  },

  // ── Plantillas ─────────────────────────────────────────────────────────────
  TEMPLATE_NOT_FOUND: { http: 404, message: 'Plantilla no encontrada' },
  TEMPLATE_NAME_TAKEN: {
    http: 409,
    message: 'Ya existe una plantilla con ese nombre',
    onUnique: 'templates_name_lower_key',
  },
  TEMPLATE_IN_USE: {
    http: 409,
    message: 'La plantilla está en uso por alguna auditoría; archívala en lugar de eliminarla',
    onForeignKeyDelete: 'audits_templateId_fkey',
  },
  /** Solo DRAFT admite cambios de estructura o contenido; PUBLISHED es inmutable (clonar para corregir). */
  TEMPLATE_NOT_EDITABLE: {
    http: 409,
    message: 'Solo una plantilla en borrador puede modificarse; clónala para corregirla',
  },
  /** Publicar/archivar desde un estado que no lo permite. Lo decide el ciclo de vida de la plantilla (docs/03). */
  TEMPLATE_INVALID_STATE: { http: 409, message: 'La plantilla no admite esa operación en su estado actual' },
  /** Para auditar hay que usar una plantilla PUBLISHED. */
  TEMPLATE_NOT_PUBLISHED: { http: 409, message: 'Solo se puede auditar con una plantilla publicada' },
  TEMPLATE_EMPTY: { http: 422, message: 'La plantilla no tiene controles' },
  /**
   * No se puede publicar: hay dominios (capítulos de primer nivel) sin hijos — `details.roots` = ids. El primer nivel es
   * el dominio que se mide; una plantilla plana no tiene dominios. (Que haya al menos una hoja y que todo control tenga
   * título no son reglas: lo primero se cumple siempre que la plantilla no esté vacía y lo segundo lo exige la entrada.)
   */
  TEMPLATE_INVALID_STRUCTURE: { http: 422, message: 'La estructura de la plantilla no permite publicarla' },
  TEMPLATE_IMPORT_INVALID: { http: 422, message: 'El archivo de importación contiene errores' },

  // ── Controles ──────────────────────────────────────────────────────────────
  CONTROL_NOT_FOUND: { http: 404, message: 'Control no encontrado' },
  /** El árbol excedería `LIMITS.controlDepth` niveles. */
  CONTROL_DEPTH_EXCEEDED: { http: 422, message: 'El control quedaría a demasiada profundidad en el árbol' },
  CONTROL_HAS_CHILDREN: { http: 409, message: 'El control tiene subcontroles; elimínalos primero' },
  /** Padre de otra plantilla o movimiento que crea un ciclo. */
  CONTROL_PARENT_INVALID: { http: 422, message: 'El control padre no es válido' },
  CONTROL_IN_USE: {
    http: 409,
    message: 'El control está siendo evaluado en alguna auditoría',
    onForeignKeyDelete: 'evaluations_controlId_fkey',
  },

  // ── Hallazgos sugeridos ────────────────────────────────────────────────────
  /** Solo los controles hoja (evaluables) admiten hallazgos sugeridos. */
  SUGGESTED_FINDING_CONTROL_NOT_LEAF: {
    http: 422,
    message: 'Solo los controles evaluables admiten hallazgos sugeridos',
  },
})
