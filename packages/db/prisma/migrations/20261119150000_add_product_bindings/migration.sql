-- 19.11.2026: привязки изделия — одна Масса и одна Туба на готовую продукцию, плюс РЦ фасовки
-- и журнал запусков загрузки спецификаций (решение владельца, постановка —
-- docs/gp_mass_binding_analysis.md).
--
-- Почему сейчас: привязки пришли выгрузкой спецификаций из 1С (473 ГП, 471 Масса, 104 Тубы),
-- и их надо где-то хранить. Ручной ввод 176 позиций не нужен — данные есть.
--
-- Существующие таблицы не меняются, кроме трёх новых столбцов у products: до заполнения они
-- пустые, и правило «одна Масса» просто не действует (поведение как до релиза).

ALTER TABLE "products"
  ADD COLUMN "massProductId" TEXT,
  ADD COLUMN "tubeProductId" TEXT,
  ADD COLUMN "massQuantity" DECIMAL(18,4),
  ADD COLUMN "tubeQuantity" DECIMAL(18,4);

ALTER TABLE "products"
  ADD CONSTRAINT "products_massProductId_fkey"
  FOREIGN KEY ("massProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD CONSTRAINT "products_tubeProductId_fkey"
  FOREIGN KEY ("tubeProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "product_packaging_work_centers" (
    "productId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,

    CONSTRAINT "product_packaging_work_centers_pkey" PRIMARY KEY ("productId", "workCenterId")
);

ALTER TABLE "product_packaging_work_centers"
  ADD CONSTRAINT "product_packaging_work_centers_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_packaging_work_centers"
  ADD CONSTRAINT "product_packaging_work_centers_workCenterId_fkey"
  FOREIGN KEY ("workCenterId") REFERENCES "work_centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "bom_import_runs" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "massBound" INTEGER NOT NULL DEFAULT 0,
    "tubeBound" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "issues" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bom_import_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "bom_import_runs"
  ADD CONSTRAINT "bom_import_runs_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
