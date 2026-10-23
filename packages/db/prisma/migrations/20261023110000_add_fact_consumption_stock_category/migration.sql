-- ОПЭ-34 (решение владельца 23.10.2026): строка потребления помнит, с какой категории остатка
-- она списывает. Масса и ПФ — разные остатки одной номенклатуры, и списание ПФ по категории
-- продукта (GP) уменьшало не тот остаток.

ALTER TABLE "fact_consumptions"
  ADD COLUMN "stockCategory" "StockCategory" NOT NULL DEFAULT 'GP';

-- Существующие строки: категория восстанавливается по категории продукта (так их и списывали).
UPDATE "fact_consumptions" c
SET "stockCategory" = CASE p."category"
    WHEN 'MASS' THEN 'MASS'::"StockCategory"
    ELSE 'GP'::"StockCategory"
  END
FROM "products" p
WHERE p."id" = c."productId";
