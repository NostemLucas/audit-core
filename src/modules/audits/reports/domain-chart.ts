/**
 * El gráfico "nivel esperado vs alcanzado por dominio" del informe, como SVG. Función PURA (ni `sharp` ni ningún I/O):
 * solo construye texto. `chart-renderer.ts` lo rasteriza a PNG para incrustarlo en el `.docx`.
 *
 * El fallo del proyecto anterior (docs/04, "Fallo encontrado…") era usar el máximo de la escala como el nivel
 * objetivo de TODOS los dominios; aquí cada barra sale de `results.domains` (`GET /results`, la MISMA fuente que el
 * resto del informe): el esperado y el alcanzado son el promedio REAL de los criterios de ese dominio.
 *
 * El lienzo es de tamaño FIJO (no crece con la cantidad de dominios): la plantilla (`build-report-template.mjs`)
 * declara un `<wp:extent>` fijo para el marcador de la imagen, así que el PNG que se incrusta debe tener siempre las
 * mismas dimensiones o Word lo estira y deforma. Con muchos dominios las filas se angostan; no hay paginación.
 */
export interface DomainChartDatum {
  readonly title: string
  readonly averageExpected: number | null
  readonly averageAchieved: number | null
}

export const CHART_WIDTH = 720
export const CHART_HEIGHT = 380
const MARGIN = { top: 34, right: 24, bottom: 16, left: 200 }
const COLOR = { expected: '#9ca3af', achieved: '#2563eb', below: '#dc2626', axis: '#374151', text: '#111827' }

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Recorta un título largo para que quepa en la etiqueta (el nombre completo no es crítico aquí: el informe ya lo lista). */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function buildDomainChartSvg(domains: readonly DomainChartDatum[], scaleMax: number): string {
  const plotWidth = CHART_WIDTH - MARGIN.left - MARGIN.right
  const plotHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom
  const rows = Math.max(domains.length, 1)
  const rowHeight = plotHeight / rows
  const barHeight = Math.min(16, rowHeight * 0.32)
  const barGap = Math.min(6, rowHeight * 0.1)
  const max = scaleMax > 0 ? scaleMax : 1
  const x = (value: number) => MARGIN.left + (Math.max(0, Math.min(value, max)) / max) * plotWidth

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(fraction * max))
  const axis = ticks
    .map((tick) => {
      const tickX = x(tick)
      return `<line x1="${tickX}" y1="${MARGIN.top - 6}" x2="${tickX}" y2="${CHART_HEIGHT - MARGIN.bottom}" stroke="#e5e7eb"/>
        <text x="${tickX}" y="${MARGIN.top - 12}" font-size="11" fill="${COLOR.axis}" text-anchor="middle">${tick}</text>`
    })
    .join('')

  const rowsSvg =
    domains.length === 0
      ? `<text x="${CHART_WIDTH / 2}" y="${CHART_HEIGHT / 2}" font-size="13" fill="${COLOR.text}" text-anchor="middle">Sin dominios evaluados</text>`
      : domains
          .map((domain, index) => {
            const rowY = MARGIN.top + index * rowHeight
            const label = `<text x="${MARGIN.left - 10}" y="${rowY + rowHeight / 2 + 4}" font-size="12" fill="${COLOR.text}" text-anchor="end">${escapeXml(truncate(domain.title, 26))}</text>`
            if (domain.averageExpected === null || domain.averageAchieved === null) {
              return `${label}<text x="${MARGIN.left + 4}" y="${rowY + rowHeight / 2 + 4}" font-size="11" fill="${COLOR.expected}">sin datos</text>`
            }
            const achievedColor = domain.averageAchieved >= domain.averageExpected ? COLOR.achieved : COLOR.below
            const expectedY = rowY + rowHeight / 2 - barGap / 2 - barHeight
            const achievedY = rowY + rowHeight / 2 + barGap / 2
            return `${label}
        <rect x="${MARGIN.left}" y="${expectedY}" width="${x(domain.averageExpected) - MARGIN.left}" height="${barHeight}" fill="${COLOR.expected}"/>
        <rect x="${MARGIN.left}" y="${achievedY}" width="${x(domain.averageAchieved) - MARGIN.left}" height="${barHeight}" fill="${achievedColor}"/>`
          })
          .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
    <rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#ffffff"/>
    <text x="${MARGIN.left}" y="16" font-size="12" fill="${COLOR.text}">
      <tspan fill="${COLOR.expected}">■</tspan> Esperado &#160;&#160;
      <tspan fill="${COLOR.achieved}">■</tspan> Alcanzado &#160;&#160;
      <tspan fill="${COLOR.below}">■</tspan> Alcanzado (por debajo)
    </text>
    ${axis}
    ${rowsSvg}
  </svg>`
}
