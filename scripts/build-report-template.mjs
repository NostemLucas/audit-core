// Genera `src/modules/audits/reports/assets/compliance-report.docx`: la plantilla POR DEFECTO del informe (docs/07
// §2). Un .docx mínimo, sin diseño institucional, con los marcadores que `docxtemplater` rellena. Se ejecuta UNA VEZ
// (o cuando cambian los marcadores); el resultado se versiona como un archivo binario normal. No es parte del build.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'

const OUT = fileURLToPath(new URL('../src/modules/audits/reports/assets/compliance-report.docx', import.meta.url))

const paragraph = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraph('Informe de auditoría', 'Title')}
    ${paragraph('{auditCode} — {auditName}', 'Heading1')}
    ${paragraph('Organización: {organizationName}')}
    ${paragraph('Generado: {generatedAt}')}
    ${paragraph('Resultados', 'Heading1')}
    ${paragraph('Evaluados: {evaluated} · Cumplen: {meets} · Por debajo: {below} · No aplica: {notApplicable} · Pendientes: {pending}')}
    ${paragraph('Por dominio', 'Heading1')}
    ${paragraph('{#domains}')}
    ${paragraph('{title}: esperado {averageExpected}, alcanzado {averageAchieved}, brecha {gap}')}
    ${paragraph('{/domains}')}
    ${paragraph('Criterios por debajo de lo esperado', 'Heading1')}
    ${paragraph('{#gaps}')}
    ${paragraph('[{severity}] {domain} / {reference} {title}: esperado {expectedLabel}, alcanzado {achievedLabel}. {findings}')}
    ${paragraph('{/gaps}')}
    <w:sectPr/>
  </w:body>
</w:document>`

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`

const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Informe de auditoría (plantilla por defecto)</dc:title>
  <dc:creator>Audit Core</dc:creator>
</cp:coreProperties>`

const zip = new PizZip()
zip.file('[Content_Types].xml', contentTypesXml)
zip.file('_rels/.rels', rootRelsXml)
zip.file('docProps/core.xml', coreXml)
zip.file('word/document.xml', documentXml)
writeFileSync(OUT, zip.generate({ type: 'nodebuffer' }))
console.log(`Escrito ${OUT}`)
