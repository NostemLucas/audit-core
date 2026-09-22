import { describe, expect, it } from 'vitest'
import { buildDomainChartSvg, CHART_HEIGHT, CHART_WIDTH } from './domain-chart.js'

describe('buildDomainChartSvg', () => {
  it('es un SVG bien formado con un elemento raíz <svg>', () => {
    const svg = buildDomainChartSvg([{ title: 'Organizacionales', averageExpected: 100, averageAchieved: 75 }], 100)
    expect(svg.trim().startsWith('<svg')).toBe(true)
    expect(svg.trim().endsWith('</svg>')).toBe(true)
  })

  it('un dominio con datos dibuja dos barras: azul si alcanza o supera lo esperado', () => {
    const svg = buildDomainChartSvg([{ title: 'Cumple', averageExpected: 50, averageAchieved: 80 }], 100)
    expect(svg).toMatch(/<rect x="200" y="[\d.]+" width="[\d.]+" height="16" fill="#2563eb"\/>/)
    expect(svg).not.toMatch(/<rect x="200" y="[\d.]+" width="[\d.]+" height="16" fill="#dc2626"\/>/)
  })

  it('por debajo de lo esperado: la barra de alcanzado sale en rojo, no en azul', () => {
    const svg = buildDomainChartSvg([{ title: 'Bajo', averageExpected: 80, averageAchieved: 20 }], 100)
    expect(svg).toMatch(/<rect x="200" y="[\d.]+" width="[\d.]+" height="16" fill="#dc2626"\/>/)
    expect(svg).not.toMatch(/<rect x="200" y="[\d.]+" width="[\d.]+" height="16" fill="#2563eb"\/>/)
  })

  it('sin nada evaluado en el dominio (promedios null): "sin datos", sin barras ni NaN', () => {
    const svg = buildDomainChartSvg([{ title: 'Vacío', averageExpected: null, averageAchieved: null }], 100)
    expect(svg).toContain('sin datos')
    expect(svg).not.toContain('NaN')
    expect(svg).not.toMatch(/<rect[^>]*width="[^0-9-][^"]*"/)
  })

  it('sin ningún dominio: un SVG válido con el aviso "Sin dominios evaluados", no vacío ni roto', () => {
    const svg = buildDomainChartSvg([], 100)
    expect(svg).toContain('Sin dominios evaluados')
    expect(svg.trim().startsWith('<svg')).toBe(true)
  })

  it('el ancho de la barra es proporcional al valor sobre el máximo de la escala (no al máximo fijo de la escala anterior)', () => {
    const half = buildDomainChartSvg([{ title: 'A', averageExpected: 100, averageAchieved: 50 }], 100)
    const full = buildDomainChartSvg([{ title: 'A', averageExpected: 100, averageAchieved: 100 }], 100)
    const widthOf = (svg: string) => {
      const matches = [
        ...svg.matchAll(/<rect x="200" y="[\d.]+" width="([\d.]+)" height="16" fill="#(?:2563eb|dc2626)"\/>/g),
      ]
      return Number(matches[0]![1])
    }
    expect(widthOf(half)).toBeCloseTo(widthOf(full) / 2, 1)
  })

  it('escapa el título del dominio (& < > ") para que un nombre real no rompa el XML', () => {
    const svg = buildDomainChartSvg([{ title: 'A & B <script> "x"', averageExpected: 50, averageAchieved: 50 }], 100)
    expect(svg).toContain('A &amp; B &lt;script&gt; &quot;x&quot;')
    expect(svg).not.toContain('<script>')
  })

  it('un título muy largo se recorta con "…" para no desbordar la etiqueta', () => {
    const svg = buildDomainChartSvg(
      [
        {
          title: 'Un nombre de dominio extremadamente largo que no debería desbordar el gráfico',
          averageExpected: 50,
          averageAchieved: 50,
        },
      ],
      100,
    )
    expect(svg).toContain('…')
    expect(svg).not.toContain('Un nombre de dominio extremadamente largo que no debería desbordar el gráfico')
  })

  it('un scaleMax de 0 no produce división por cero (NaN/Infinity)', () => {
    const svg = buildDomainChartSvg([{ title: 'A', averageExpected: 0, averageAchieved: 0 }], 0)
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('Infinity')
  })

  it('el lienzo es de tamaño FIJO sin importar cuántos dominios haya (la plantilla del .docx declara un tamaño fijo)', () => {
    const one = buildDomainChartSvg([{ title: 'A', averageExpected: 1, averageAchieved: 1 }], 1)
    const three = buildDomainChartSvg(
      [
        { title: 'A', averageExpected: 1, averageAchieved: 1 },
        { title: 'B', averageExpected: 1, averageAchieved: 1 },
        { title: 'C', averageExpected: 1, averageAchieved: 1 },
      ],
      1,
    )
    const rootSizeOf = (svg: string) => svg.match(/^<svg[^>]*width="(\d+)" height="(\d+)"/)!.slice(1, 3)
    expect(rootSizeOf(three)).toEqual(rootSizeOf(one))
    expect(rootSizeOf(one)).toEqual([String(CHART_WIDTH), String(CHART_HEIGHT)])
  })
})
