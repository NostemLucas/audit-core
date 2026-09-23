-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'GERENTE', 'AUDITOR');

-- CreateEnum
CREATE TYPE "ScaleDimension" AS ENUM ('CONFORMITY', 'MATURITY');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AuditRole" AS ENUM ('LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'RETURNED', 'APPROVED');

-- CreateEnum
CREATE TYPE "EvaluationSeverity" AS ENUM ('MAJOR', 'MINOR', 'OBSERVATION');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('COMPLIANCE', 'EXECUTIVE_SUMMARY', 'FINDINGS', 'GAP_ANALYSIS', 'OTHER');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "authentikId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" "Role"[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scales" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" "ScaleDimension" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scale_levels" (
    "id" UUID NOT NULL,
    "scaleId" UUID NOT NULL,
    "value" DECIMAL(5,2) NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scale_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controls" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "parentId" UUID,
    "reference" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggested_findings" (
    "id" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "levelId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suggested_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audits" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "introduction" TEXT,
    "scopeNotes" TEXT,
    "objectives" TEXT,
    "templateId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "scaleId" UUID NOT NULL,
    "managerId" UUID NOT NULL,
    "previousAuditId" UUID,
    "status" "AuditStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedStart" DATE,
    "plannedEnd" DATE,
    "closedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_scope_items" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_scope_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_members" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "AuditRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "controlId" UUID NOT NULL,
    "expectedLevelId" UUID,
    "guidance" TEXT,
    "assignedUserId" UUID,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "achievedLevelId" UUID,
    "findings" TEXT,
    "notes" TEXT,
    "severity" "EvaluationSeverity",
    "isNotApplicable" BOOLEAN NOT NULL DEFAULT false,
    "notApplicableReason" TEXT,
    "requiresFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "carriedFromId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidences" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "storageFileId" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "evidences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "type" "ReportType" NOT NULL DEFAULT 'COMPLIANCE',
    "title" TEXT NOT NULL,
    "storageFileId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" UUID NOT NULL,
    "type" "ReportType" NOT NULL,
    "dimension" "ScaleDimension",
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" UUID,
    "targetUserId" UUID,
    "subjectType" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_authentikId_key" ON "users"("authentikId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "scale_levels_scaleId_value_key" ON "scale_levels"("scaleId", "value");

-- CreateIndex
CREATE INDEX "controls_templateId_parentId_position_idx" ON "controls"("templateId", "parentId", "position");

-- CreateIndex
CREATE INDEX "controls_parentId_idx" ON "controls"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "controls_id_templateId_key" ON "controls"("id", "templateId");

-- CreateIndex
CREATE INDEX "suggested_findings_levelId_idx" ON "suggested_findings"("levelId");

-- CreateIndex
CREATE UNIQUE INDEX "suggested_findings_controlId_levelId_key" ON "suggested_findings"("controlId", "levelId");

-- CreateIndex
CREATE UNIQUE INDEX "audits_code_key" ON "audits"("code");

-- CreateIndex
CREATE INDEX "audits_organizationId_status_idx" ON "audits"("organizationId", "status");

-- CreateIndex
CREATE INDEX "audits_templateId_idx" ON "audits"("templateId");

-- CreateIndex
CREATE INDEX "audits_managerId_idx" ON "audits"("managerId");

-- CreateIndex
CREATE INDEX "audits_status_plannedEnd_idx" ON "audits"("status", "plannedEnd");

-- CreateIndex
CREATE UNIQUE INDEX "audit_scope_items_auditId_name_key" ON "audit_scope_items"("auditId", "name");

-- CreateIndex
CREATE INDEX "audit_members_userId_idx" ON "audit_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_members_auditId_userId_key" ON "audit_members"("auditId", "userId");

-- CreateIndex
CREATE INDEX "evaluations_carriedFromId_idx" ON "evaluations"("carriedFromId");

-- CreateIndex
CREATE INDEX "evaluations_auditId_status_idx" ON "evaluations"("auditId", "status");

-- CreateIndex
CREATE INDEX "evaluations_assignedUserId_status_idx" ON "evaluations"("assignedUserId", "status");

-- CreateIndex
CREATE INDEX "evaluations_controlId_idx" ON "evaluations"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_auditId_controlId_key" ON "evaluations"("auditId", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "evidences_storageFileId_key" ON "evidences"("storageFileId");

-- CreateIndex
CREATE INDEX "evidences_evaluationId_idx" ON "evidences"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "reports_storageFileId_key" ON "reports"("storageFileId");

-- CreateIndex
CREATE INDEX "reports_auditId_createdAt_idx" ON "reports"("auditId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_type_dimension_key" ON "report_templates"("type", "dimension");

-- CreateIndex
CREATE INDEX "audit_events_auditId_createdAt_idx" ON "audit_events"("auditId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_subjectType_subjectId_idx" ON "audit_events"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");

-- CreateIndex
CREATE INDEX "audit_events_targetUserId_idx" ON "audit_events"("targetUserId");

-- AddForeignKey
ALTER TABLE "scale_levels" ADD CONSTRAINT "scale_levels_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "scales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controls" ADD CONSTRAINT "controls_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "controls" ADD CONSTRAINT "controls_parentId_templateId_fkey" FOREIGN KEY ("parentId", "templateId") REFERENCES "controls"("id", "templateId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggested_findings" ADD CONSTRAINT "suggested_findings_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "controls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggested_findings" ADD CONSTRAINT "suggested_findings_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "scale_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "scales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_previousAuditId_fkey" FOREIGN KEY ("previousAuditId") REFERENCES "audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_scope_items" ADD CONSTRAINT "audit_scope_items_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_members" ADD CONSTRAINT "audit_members_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_members" ADD CONSTRAINT "audit_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_carriedFromId_fkey" FOREIGN KEY ("carriedFromId") REFERENCES "evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_expectedLevelId_fkey" FOREIGN KEY ("expectedLevelId") REFERENCES "scale_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_achievedLevelId_fkey" FOREIGN KEY ("achievedLevelId") REFERENCES "scale_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidences" ADD CONSTRAINT "evidences_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ════════════════════════════════════════════════════════════════════════════
-- Objetos que Prisma no modela (fuente única de estas reglas de integridad).
-- Cualquier cambio a estos objetos se hace en una migración nueva, a mano.
-- ════════════════════════════════════════════════════════════════════════════

-- Código legible de auditoría: la aplicación formatea `nextval('audit_code_seq')` (p. ej. AUD-2026-00042).
CREATE SEQUENCE "audit_code_seq" START WITH 1 INCREMENT BY 1;

-- Nombres de organización, escala y plantilla: (1) únicos SIN distinguir mayúsculas ("ACME" y "acme" son el mismo
-- auditado), y (2) ordenados con ICU raíz. Sin (2) el orden de un listado lo decide la collation con la que se creó la
-- base (en unas es "C": mayúsculas antes que minúsculas; en otras, la del idioma) y un listado paginado no puede
-- depender del servidor. "und-x-icu" es determinista: la comparación exacta sigue siendo por bytes.
-- Prisma no modela ni índices sobre expresiones ni collations de columna: esto no genera diferencias con schema.prisma.
ALTER TABLE "organizations" ALTER COLUMN "name" TYPE TEXT COLLATE "und-x-icu";
ALTER TABLE "scales"        ALTER COLUMN "name" TYPE TEXT COLLATE "und-x-icu";
ALTER TABLE "templates"     ALTER COLUMN "name" TYPE TEXT COLLATE "und-x-icu";
CREATE UNIQUE INDEX "organizations_name_lower_key" ON "organizations" (lower("name"));
CREATE UNIQUE INDEX "scales_name_lower_key"        ON "scales" (lower("name"));
CREATE UNIQUE INDEX "templates_name_lower_key"     ON "templates" (lower("name"));

-- users: el email se normaliza a minúsculas. El username NO: es el usuario de Nextcloud (distingue mayúsculas)
-- y debe coincidir tal cual con el `preferred_username` de Authentik.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- scale_levels: el puntaje no puede ser negativo (que el máximo sea > 0 y que haya >= 2 opciones lo valida el dominio).
ALTER TABLE "scale_levels"
  ADD CONSTRAINT "scale_levels_value_nonneg" CHECK ("value" >= 0);

-- audits
ALTER TABLE "audits"
  ADD CONSTRAINT "audits_not_own_previous"     CHECK ("previousAuditId" IS NULL OR "previousAuditId" <> "id"),
  ADD CONSTRAINT "audits_planned_dates"        CHECK ("plannedStart" IS NULL OR "plannedEnd" IS NULL OR "plannedEnd" >= "plannedStart");

-- audit_members: UN SOLO líder por auditoría (docs/06 §1). Índice único parcial: lo garantiza la BD, sin bloqueos de fila
-- (con dos designaciones simultáneas la segunda choca y se traduce a AUDIT_LEAD_ALREADY_ASSIGNED).
CREATE UNIQUE INDEX "audit_members_one_lead" ON "audit_members"("auditId") WHERE "role" = 'LEAD';

-- evaluations
ALTER TABLE "evaluations"
  ADD CONSTRAINT "evaluations_na_reason"     CHECK (NOT "isNotApplicable" OR "notApplicableReason" IS NOT NULL),
  ADD CONSTRAINT "evaluations_not_own_carry" CHECK ("carriedFromId" IS NULL OR "carriedFromId" <> "id");

-- evidences
ALTER TABLE "evidences"
  ADD CONSTRAINT "evidences_size_nonneg"   CHECK ("size" >= 0);

-- audit_events
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_payload_object" CHECK (jsonb_typeof("payload") = 'object');

-- report_templates: UN SOLO comodín (dimension = null) por tipo — Postgres no aplica UNIQUE(type, dimension) a dos
-- filas con dimension NULL (NULL nunca es "igual" a NULL). Índice único parcial, mismo patrón que audit_members_one_lead.
CREATE UNIQUE INDEX "report_templates_one_wildcard" ON "report_templates"("type") WHERE "dimension" IS NULL;
