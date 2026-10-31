-- Канбан производственного контура (T-103, решение владельца 30.10.2026).
--
-- Перемещение не знало, из какого ПЗ оно выросло: GoodsTransfer хранил только склады,
-- TransferLine — номенклатуру и количество. Из-за этого этапы «перемещение создано /
-- отправлено / принято» нельзя было достоверно показать на карточке ПЗ — только угадать
-- по номенклатуре и складам, а догадку владелец не принял.
--
-- Поле необязательное: перемещения, созданные вручную из раздела «Перемещения», остаются
-- без привязки. ON DELETE SET NULL — удаление строки ПЗ не должно уносить перемещение:
-- складские движения уже произошли, документ остаётся документом.

ALTER TABLE "transfer_lines" ADD COLUMN "productionOrderLineId" TEXT;

CREATE INDEX "transfer_lines_productionOrderLineId_idx" ON "transfer_lines"("productionOrderLineId");

ALTER TABLE "transfer_lines"
    ADD CONSTRAINT "transfer_lines_productionOrderLineId_fkey"
    FOREIGN KEY ("productionOrderLineId") REFERENCES "production_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
