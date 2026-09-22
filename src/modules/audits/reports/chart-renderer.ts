import sharp from 'sharp'

/**
 * Rasteriza un SVG (`domain-chart.ts`) a PNG, en el mismo tamaño que declara el SVG. Es lo único de `reports/` que
 * sabe de `sharp`: mantiene el resto (el dibujo del gráfico, el armado del `.docx`) sin ninguna dependencia nativa.
 */
export async function renderChartPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg, 'utf8')).png().toBuffer()
}
