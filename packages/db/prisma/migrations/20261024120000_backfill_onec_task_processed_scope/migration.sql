-- ОПЭ-36 довели до существующих задач (решение владельца 24.10.2026).
--
-- Снимок «проведено» появился в v2.2.0, и у задач, отмеченных обработанными раньше, его нет.
-- Без снимка задача, обновившись новыми данными, снова показывает и то, что уже проведено в 1С, —
-- то самое задвоение, от которого мы защищались.
--
-- Восстанавливаем снимок по времени: проведённым считается то, что было отчитано до отметки
-- «обработано» (processedAt). Ничего не удаляем и не создаём — только заполняем пустое поле.

UPDATE "tasks_for_one_c" t
SET "processedScope" = jsonb_build_object(
  'factIds',
  COALESCE(
    (
      SELECT jsonb_agg(pf."id")
      FROM "production_facts" pf
      JOIN "production_order_lines" pol ON pol."id" = pf."lineId"
      WHERE pol."orderId" = t."sourceId"
        AND t."processedAt" IS NOT NULL
        AND pf."reportedAt" <= t."processedAt"
    ),
    '[]'::jsonb
  )
)
WHERE t."type" = 'PRODUCTION'
  AND t."status" = 'PROCESSED'
  AND t."processedScope" IS NULL;
