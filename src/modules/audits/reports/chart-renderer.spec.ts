import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { renderChartPng } from './chart-renderer.js'
import { buildDomainChartSvg, CHART_HEIGHT, CHART_WIDTH } from './domain-chart.js'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('renderChartPng', () => {
  it('produce un PNG real (no solo bytes cualquiera) con las MISMAS dimensiones que declara la plantilla del .docx', async () => {
    const svg = buildDomainChartSvg(
      [
        { title: 'Organizacionales', averageExpected: 100, averageAchieved: 75 },
        { title: 'Personas', averageExpected: 50, averageAchieved: 50 },
      ],
      100,
    )
    const png = await renderChartPng(svg)
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC)
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(CHART_WIDTH)
    expect(meta.height).toBe(CHART_HEIGHT)
  })

  it('un SVG sin dominios también rasteriza (no lanza): el gráfico "vacío" es un PNG válido', async () => {
    const svg = buildDomainChartSvg([], 100)
    const png = await renderChartPng(svg)
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC)
  })
})
