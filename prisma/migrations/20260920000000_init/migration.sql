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
CREATE TYPE "AuditRole" AS ENUM ('LEAD_AUDITOR', 'INSPECTOR');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'RETURNED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('APPROVE', 'RETURN', 'REASSIGN', 'REOPEN', 'RESTORE');

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
    "parentAuditId" UUID,
    "followUpNumber" INTEGER NOT NULL DEFAULT 0,
    "status" "AuditStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedStart" DATE,
    "plannedEnd" DATE,
    "closedAt" TIMESTAMPTZ(3),
    "storageFolderId" TEXT,
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
    "role" "AuditRole" NOT NULL DEFAULT 'INSPECTOR',
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
    "expectedLevelReason" TEXT,
    "assignedUserId" UUID,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "round" INTEGER NOT NULL DEFAULT 1,
    "achievedLevelId" UUID,
    "findings" TEXT,
    "notes" TEXT,
    "isNotApplicable" BOOLEAN NOT NULL DEFAULT false,
    "notApplicableReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID,
    "updatedById" UUID,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_reviews" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "comments" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluation_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidences" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
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
CREATE UNIQUE INDEX "organizations_name_key" ON "organizations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "scales_name_key" ON "scales"("name");

-- CreateIndex
CREATE UNIQUE INDEX "scale_levels_scaleId_value_key" ON "scale_levels"("scaleId", "value");

-- CreateIndex
CREATE UNIQUE INDEX "templates_name_key" ON "templates"("name");

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
CREATE UNIQUE INDEX "audits_parentAuditId_followUpNumber_key" ON "audits"("parentAuditId", "followUpNumber");

-- CreateIndex
CREATE UNIQUE INDEX "audit_scope_items_auditId_name_key" ON "audit_scope_items"("auditId", "name");

-- CreateIndex
CREATE INDEX "audit_members_userId_idx" ON "audit_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_members_auditId_userId_key" ON "audit_members"("auditId", "userId");

-- CreateIndex
CREATE INDEX "evaluations_auditId_status_idx" ON "evaluations"("auditId", "status");

-- CreateIndex
CREATE INDEX "evaluations_assignedUserId_status_idx" ON "evaluations"("assignedUserId", "status");

-- CreateIndex
CREATE INDEX "evaluations_controlId_idx" ON "evaluations"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_auditId_controlId_key" ON "evaluations"("auditId", "controlId");

-- CreateIndex
CREATE INDEX "evaluation_reviews_evaluationId_createdAt_idx" ON "evaluation_reviews"("evaluationId", "createdAt");

-- CreateIndex
CREATE INDEX "evaluation_reviews_actorId_createdAt_idx" ON "evaluation_reviews"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "evidences_storageFileId_key" ON "evidences"("storageFileId");

-- CreateIndex
CREATE INDEX "evidences_evaluationId_round_idx" ON "evidences"("evaluationId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "reports_storageFileId_key" ON "reports"("storageFileId");

-- CreateIndex
CREATE INDEX "reports_auditId_createdAt_idx" ON "reports"("auditId", "createdAt");

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
ALTER TABLE "suggested_findings" ADD CONSTRAINT "suggested_findings_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "scale_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_scaleId_fkey" FOREIGN KEY ("scaleId") REFERENCES "scales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audits" ADD CONSTRAINT "audits_parentAuditId_fkey" FOREIGN KEY ("parentAuditId") REFERENCES "audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_scope_items" ADD CONSTRAINT "audit_scope_items_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_members" ADD CONSTRAINT "audit_members_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_members" ADD CONSTRAINT "audit_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_expectedLevelId_fkey" FOREIGN KEY ("expectedLevelId") REFERENCES "scale_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_achievedLevelId_fkey" FOREIGN KEY ("achievedLevelId") REFERENCES "scale_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_reviews" ADD CONSTRAINT "evaluation_reviews_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_reviews" ADD CONSTRAINT "evaluation_reviews_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- users: el email se normaliza a minúsculas. El username NO: es el usuario de Nextcloud (distingue mayúsculas)
-- y debe coincidir tal cual con el `preferred_username` de Authentik.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- scale_levels: el puntaje no puede ser negativo (que el máximo sea > 0 y que haya >= 2 opciones lo valida el dominio).
ALTER TABLE "scale_levels"
  ADD CONSTRAINT "scale_levels_value_nonneg" CHECK ("value" >= 0);

-- audits
ALTER TABLE "audits"
  ADD CONSTRAINT "audits_followup_consistency" CHECK (("parentAuditId" IS NULL) = ("followUpNumber" = 0)),
  ADD CONSTRAINT "audits_not_own_parent"       CHECK ("parentAuditId" IS NULL OR "parentAuditId" <> "id"),
  ADD CONSTRAINT "audits_planned_dates"        CHECK ("plannedStart" IS NULL OR "plannedEnd" IS NULL OR "plannedEnd" >= "plannedStart");

-- evaluations
ALTER TABLE "evaluations"
  ADD CONSTRAINT "evaluations_round_min"     CHECK ("round" >= 1),
  ADD CONSTRAINT "evaluations_na_reason"     CHECK (NOT "isNotApplicable" OR "notApplicableReason" IS NOT NULL);

-- evaluation_reviews
ALTER TABLE "evaluation_reviews"
  ADD CONSTRAINT "evaluation_reviews_round_min"        CHECK ("round" >= 1),
  ADD CONSTRAINT "evaluation_reviews_snapshot_object"  CHECK (jsonb_typeof("snapshot") = 'object');

-- evidences
ALTER TABLE "evidences"
  ADD CONSTRAINT "evidences_round_min"     CHECK ("round" >= 1),
  ADD CONSTRAINT "evidences_size_nonneg"   CHECK ("size" >= 0);

-- audit_events
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_payload_object" CHECK (jsonb_typeof("payload") = 'object');
