-- Табель учёта рабочего времени (T-093, решение владельца 26.10.2026).
--
-- Нужно два объекта:
--   1. справочник причин неявки — как DefectReason и SubstitutionReason;
--   2. фактический состав работников по факту: назначение (план) живёт в строке ПЗ,
--      а выход (факт) хранится здесь, потому что назначение после правок меняться не должно.
--
-- Строки состава пишутся один раз на линию (на факт основной категории), а не в каждый
-- факт: тот же урок, что ОПЭ-38 у потребления — иначе состав задваивался бы.

CREATE TABLE "absence_reasons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "absence_reasons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "absence_reasons_code_key" ON "absence_reasons"("code");

CREATE TABLE "production_fact_workers" (
    "id" TEXT NOT NULL,
    "productionFactId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "planned" BOOLEAN NOT NULL DEFAULT false,
    "worked" BOOLEAN NOT NULL DEFAULT true,
    "absenceReasonId" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_fact_workers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "production_fact_workers_productionFactId_employeeId_key"
    ON "production_fact_workers"("productionFactId", "employeeId");

CREATE INDEX "production_fact_workers_employeeId_idx" ON "production_fact_workers"("employeeId");

ALTER TABLE "production_fact_workers"
    ADD CONSTRAINT "production_fact_workers_productionFactId_fkey"
    FOREIGN KEY ("productionFactId") REFERENCES "production_facts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "production_fact_workers"
    ADD CONSTRAINT "production_fact_workers_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "production_fact_workers"
    ADD CONSTRAINT "production_fact_workers_absenceReasonId_fkey"
    FOREIGN KEY ("absenceReasonId") REFERENCES "absence_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
