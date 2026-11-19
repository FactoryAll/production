-- 19.11.2026 (фидбэк НП): сломался РЦ — итог внести некому, а закрыть ПЗ нельзя, потому что
-- закрытие требует «все РЦ внесли итоги». Отмена всего ПЗ для этого не годится: остальные РЦ
-- уже работали и отчитались.
--
-- Решение владельца: НП (и АДМ) может отменить задание на конкретном РЦ. Движений по складу
-- при этом нет — ни выпуска, ни расхода: строка просто помечается отменённой с причиной.
-- В 1С отменённая строка не уходит (там только факты), и это правильно: причина поломки —
-- не компетенция 1С.

ALTER TYPE "ProductionOrderLineStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "production_order_lines"
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId" TEXT;

ALTER TABLE "production_order_lines"
  ADD CONSTRAINT "production_order_lines_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
