-- ОПЭ-32 (решение владельца 23.10.2026): количество во всей системе — целое число.
-- До этого количества строились из Number() и в документах появлялись значения вида 2591.9999
-- (вместо 2592). Новые записи проверяются на входе; уже введённые — округляем здесь,
-- как решил владелец: «округлить при миграции».

UPDATE "production_order_lines" SET "plannedQuantity" = ROUND("plannedQuantity");
UPDATE "production_facts" SET "quantity" = ROUND("quantity"), "defectQuantity" = ROUND("defectQuantity");
UPDATE "fact_consumptions" SET "quantity" = ROUND("quantity");
UPDATE "stock_movements" SET "quantity" = ROUND("quantity");
UPDATE "stock_balances" SET "quantity" = ROUND("quantity");
UPDATE "shift_summaries" SET "plannedQuantity" = ROUND("plannedQuantity"), "defectQuantity" = ROUND("defectQuantity");
UPDATE "shift_summary_consumptions" SET "quantity" = ROUND("quantity");
UPDATE "transfer_lines" SET "plannedQuantity" = ROUND("plannedQuantity"),
                            "actualQuantity" = ROUND("actualQuantity");
UPDATE "discrepancies" SET "plannedQuantity" = ROUND("plannedQuantity"),
                           "actualQuantity" = ROUND("actualQuantity"),
                           "difference" = ROUND("difference");
