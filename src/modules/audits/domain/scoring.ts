/**
 * Qué muestra una auditoría de cómo va (docs/05 §6, docs/06 §7 3e). Función PURA: solo cuenta y compara niveles; no sabe de BD
 * ni de Nest. NO hay nota global ni pesos: cada criterio se lee por sí mismo (alcanzado frente a esperado) y lo que se
 * resume son CONTEOS y, por dominio, dos promedios en niveles. Todo se calcula al leer; nada se guarda.
 */
export interface ScoredLeaf {
  /** El dominio (primer nivel de la plantilla) al que pertenece el criterio. */
  readonly domainId: string
  readonly status: string
  readonly isNotApplicable: boolean
  readonly expected: number | null
  readonly achieved: number | null
  /** El nivel alcanzado, para la distribución (las escalas repiten puntajes solo si son de otra escala: aquí es una). */
  readonly achievedLevelId: string | null
}

export interface LevelRef {
  readonly id: string
  readonly value: number
  readonly label: string
}

/** Conteos de un conjunto de criterios. `evaluated + pending + notApplicable = total`. */
export interface Tally {
  readonly total: number
  /** Marcados "no aplica": quedan fuera de todo lo demás. */
  readonly notApplicable: number
  /** Aplicables aún sin nivel alcanzado. */
  readonly pending: number
  /** Aplicables con nivel alcanzado. */
  readonly evaluated: number
  /** Evaluados con alcanzado ≥ esperado. */
  readonly meets: number
  /** Evaluados con alcanzado < esperado (cada uno es una no conformidad de ESE criterio, no del dominio). */
  readonly below: number
}

export interface DomainAverages {
  /** Promedio de los niveles esperados / alcanzados de los MISMOS criterios (los evaluados), para que sean comparables. */
  readonly averageExpected: number | null
  readonly averageAchieved: number | null
  /** `averageAchieved − averageExpected`; negativo = por debajo de lo esperado en promedio. */
  readonly gap: number | null
}

export interface Distribution {
  readonly levelId: string
  readonly label: string
  readonly value: number
  readonly count: number
}

export interface AuditProgress {
  readonly total: number
  readonly notStarted: number
  readonly inProgress: number
  readonly completed: number
  readonly returned: number
  readonly approved: number
}

export interface DomainResult extends Tally, DomainAverages {
  readonly domainId: string
  readonly distribution: readonly Distribution[]
}

export interface AuditResults {
  readonly progress: AuditProgress
  readonly overall: Tally & { readonly distribution: readonly Distribution[] }
  /** En el orden en que se pasaron los dominios (el de lectura de la plantilla). */
  readonly domains: readonly DomainResult[]
}

/** Redondeo a 2 decimales (los puntajes son `Decimal(5,2)`): evita colas como 0.30000000000000004 en los promedios. */
const round2 = (n: number): number => Math.round(n * 100) / 100

const average = (values: readonly number[]): number | null =>
  values.length === 0 ? null : round2(values.reduce((sum, v) => sum + v, 0) / values.length)

/** Un criterio cuenta como evaluado si es aplicable y tiene nivel alcanzado Y esperado (el esperado siempre está tras iniciar). */
const isEvaluated = (leaf: ScoredLeaf): leaf is ScoredLeaf & { expected: number; achieved: number } =>
  !leaf.isNotApplicable && leaf.achieved !== null && leaf.expected !== null

/** Brecha de un criterio: `alcanzado − esperado`. Negativa = no conformidad de ese criterio. */
export function gapOf(expected: number, achieved: number): number {
  return round2(achieved - expected)
}

/** La brecha de un criterio si está evaluado (aplicable, con nivel alcanzado y esperado); `null` si no hay contra qué comparar. */
export function leafGap(leaf: ScoredLeaf): number | null {
  return isEvaluated(leaf) ? gapOf(leaf.expected, leaf.achieved) : null
}

export function tally(leaves: readonly ScoredLeaf[]): Tally {
  const notApplicable = leaves.filter((l) => l.isNotApplicable).length
  const evaluated = leaves.filter(isEvaluated)
  const below = evaluated.filter((l) => l.achieved < l.expected).length
  return {
    total: leaves.length,
    notApplicable,
    pending: leaves.length - notApplicable - evaluated.length,
    evaluated: evaluated.length,
    meets: evaluated.length - below,
    below,
  }
}

function distributionOf(leaves: readonly ScoredLeaf[], levels: readonly LevelRef[]): readonly Distribution[] {
  const counts = new Map<string, number>()
  for (const leaf of leaves.filter(isEvaluated)) {
    if (leaf.achievedLevelId) counts.set(leaf.achievedLevelId, (counts.get(leaf.achievedLevelId) ?? 0) + 1)
  }
  // Todas las opciones de la escala, también las que nadie eligió (para que las gráficas tengan siempre las mismas barras).
  return levels.map((level) => ({
    levelId: level.id,
    label: level.label,
    value: level.value,
    count: counts.get(level.id) ?? 0,
  }))
}

function averagesOf(leaves: readonly ScoredLeaf[]): DomainAverages {
  const evaluated = leaves.filter(isEvaluated)
  const averageExpected = average(evaluated.map((l) => l.expected))
  const averageAchieved = average(evaluated.map((l) => l.achieved))
  return {
    averageExpected,
    averageAchieved,
    gap: averageExpected === null || averageAchieved === null ? null : gapOf(averageExpected, averageAchieved),
  }
}

function progressOf(leaves: readonly ScoredLeaf[]): AuditProgress {
  const counts = new Map<string, number>()
  for (const leaf of leaves) counts.set(leaf.status, (counts.get(leaf.status) ?? 0) + 1)
  const count = (status: string) => counts.get(status) ?? 0
  return {
    total: leaves.length,
    notStarted: count('NOT_STARTED'),
    inProgress: count('IN_PROGRESS'),
    completed: count('COMPLETED'),
    returned: count('RETURNED'),
    approved: count('APPROVED'),
  }
}

/**
 * Los resultados de una auditoría: avance por estado, conteos y distribución del total, y por dominio sus conteos, la
 * distribución y los dos promedios. `domainIds` fija el orden y hace que aparezcan también los dominios sin criterios.
 */
export function computeResults(
  leaves: readonly ScoredLeaf[],
  domainIds: readonly string[],
  levels: readonly LevelRef[],
): AuditResults {
  return {
    progress: progressOf(leaves),
    overall: { ...tally(leaves), distribution: distributionOf(leaves, levels) },
    domains: domainIds.map((domainId) => {
      const own = leaves.filter((l) => l.domainId === domainId)
      return { domainId, ...tally(own), ...averagesOf(own), distribution: distributionOf(own, levels) }
    }),
  }
}
