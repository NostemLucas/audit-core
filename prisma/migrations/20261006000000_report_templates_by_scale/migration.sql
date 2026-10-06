-- Las plantillas de informe pasan de colgar de la DIMENSIÓN de una escala a colgar de la ESCALA misma (tipo + escala).
-- Una plantilla con dimensión concreta no se puede convertir sola a una escala (puede haber varias escalas por
-- dimensión), así que la migración se niega a seguir si ya hay alguna: hay que decidir a mano a qué escala va.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "report_templates" WHERE "dimension" IS NOT NULL) THEN
    RAISE EXCEPTION 'report_templates tiene plantillas con dimensión: asignarlas a una escala antes de migrar';
  END IF;
END $$;

DROP INDEX IF EXISTS "report_templates_type_dimension_key";
DROP INDEX IF EXISTS "report_templates_one_wildcard";

ALTER TABLE "report_templates" DROP COLUMN "dimension";
ALTER TABLE "report_templates" ADD COLUMN "scaleId" UUID;

ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_scaleId_fkey"
  FOREIGN KEY ("scaleId") REFERENCES "scales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "report_templates_type_scaleId_key" ON "report_templates"("type", "scaleId");

-- Un solo comodín (scaleId = null) por tipo: mismo patrón que antes, Postgres no considera iguales dos NULL.
CREATE UNIQUE INDEX "report_templates_one_wildcard" ON "report_templates"("type") WHERE "scaleId" IS NULL;
