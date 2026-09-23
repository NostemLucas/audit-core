// Genera `src/modules/audits/reports/assets/compliance-report.docx`: la plantilla POR DEFECTO del informe (docs/07
// §2). Un .docx mínimo, sin diseño institucional, con los marcadores que `docxtemplater` rellena. Se ejecuta UNA VEZ
// (o cuando cambian los marcadores); el resultado se versiona como un archivo binario normal. No es parte del build.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'
import sharp from 'sharp'

// Debe coincidir con CHART_WIDTH/CHART_HEIGHT de `domain-chart.ts` (este script no puede importar TypeScript
// directamente: se ejecuta con `node` plano, sin paso de compilación).
const CHART_WIDTH = 720
const CHART_HEIGHT = 380

const OUT = fileURLToPath(new URL('../src/modules/audits/reports/assets/compliance-report.docx', import.meta.url))

const paragraph = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

// 96 dpi: 9525 EMU por píxel.
const EMU_PER_PX = 9525
const CHART_EXTENT_EMU = { cx: CHART_WIDTH * EMU_PER_PX, cy: CHART_HEIGHT * EMU_PER_PX }
const chartDrawing = `<w:p><w:r><w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
    <wp:extent cx="${CHART_EXTENT_EMU.cx}" cy="${CHART_EXTENT_EMU.cy}"/>
    <wp:docPr id="1" name="Gráfico por dominio"/>
    <wp:cNvGraphicFramePr>
      <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
    </wp:cNvGraphicFramePr>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr>
            <pic:cNvPr id="1" name="Gráfico por dominio"/>
            <pic:cNvPicPr/>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${CHART_EXTENT_EMU.cx}" cy="${CHART_EXTENT_EMU.cy}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing></w:r></w:p>`

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraph('Informe de auditoría', 'Title')}
    ${paragraph('{auditCode} — {auditName}', 'Heading1')}
    ${paragraph('Organización: {organizationName}')}
    ${paragraph('Generado: {generatedAt}')}
    ${paragraph('Resultados', 'Heading1')}
    ${paragraph('Evaluados: {evaluated} · Cumplen: {meets} · Por debajo: {below} · No aplica: {notApplicable} · Pendientes: {pending}')}
    ${paragraph('Gravedad de las brechas: {majorCount} mayor(es) · {minorCount} menor(es) · {observationCount} observación(es)')}
    ${paragraph('Nivel esperado vs. alcanzado por dominio', 'Heading1')}
    ${chartDrawing}
    ${paragraph('Por dominio', 'Heading1')}
    ${paragraph('{#domains}')}
    ${paragraph('{title}: esperado {averageExpected}, alcanzado {averageAchieved}, brecha {gap}')}
    ${paragraph('{/domains}')}
    ${paragraph('Criterios por debajo de lo esperado', 'Heading1')}
    ${paragraph('{#gaps}')}
    ${paragraph('[{severity}] {domain} / {reference} {title}: esperado {expectedLabel}, alcanzado {achievedLabel}. {findings}')}
    ${paragraph('{/gaps}')}
    ${paragraph('Todos los resultados', 'Heading1')}
    ${paragraph('{#results}')}
    ${paragraph('[{severity}] {domain} / {reference} {title}: esperado {expectedLabel}, alcanzado {achievedLabel} ({#meetsExpected}cumple{/meetsExpected}{^meetsExpected}no cumple{/meetsExpected}). {findings}')}
    ${paragraph('{/results}')}
    ${paragraph('Catálogo de controles', 'Heading1')}
    ${paragraph('{#controls}')}
    ${paragraph('{domain} / {reference} {title} — nivel {depth} ({#isLeaf}evaluable{/isLeaf}{^isLeaf}agrupador{/isLeaf})')}
    ${paragraph('{/controls}')}
    <w:sectPr/>
  </w:body>
</w:document>`

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`

// El propio `word/document.xml` también tiene su hoja de relaciones (docs/07): `rId1` es la imagen del gráfico
// (`report-renderer.ts` reemplaza sus bytes por el PNG real de cada informe; aquí solo hace falta un PNG válido).
const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart1.png"/>
</Relationships>`

const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Informe de auditoría (plantilla por defecto)</dc:title>
  <dc:creator>Audit Core</dc:creator>
</cp:coreProperties>`

const placeholderChart = await sharp({
  create: { width: CHART_WIDTH, height: CHART_HEIGHT, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
})
  .png()
  .toBuffer()

const zip = new PizZip()
zip.file('[Content_Types].xml', contentTypesXml)
zip.file('_rels/.rels', rootRelsXml)
zip.file('docProps/core.xml', coreXml)
zip.file('word/document.xml', documentXml)
zip.file('word/_rels/document.xml.rels', documentRelsXml)
zip.file('word/media/chart1.png', placeholderChart)
writeFileSync(OUT, zip.generate({ type: 'nodebuffer' }))
console.log(`Escrito ${OUT}`)
