-- Выписка аудита по фактам одного ПЗ (расследование ОПЭ-78: «ввёл 150 — вижу 148»).
--
-- Использование: подставить номер или часть id ПЗ вместо :pattern и выполнить:
--   docker compose exec -T postgres psql -U prodtrack -d prodtrack \
--     -v pattern='%ВАШ_НОМЕР%' -f /dev/stdin < scripts/audit-fact-by-order.sql
--
-- Что показывает: все записи аудита по фактам строк этого ПЗ в порядке времени —
-- действие, кто, что было и что стало. По ним видно, легло ли введённое число
-- и не перезаписал ли его кто-то потом.

\set pattern :'pattern'

SELECT
    a."createdAt" AT TIME ZONE 'Europe/Moscow' AS "время MSK",
    a.action                                    AS "действие",
    u.login                                     AS "кто",
    a.role                                      AS "роль",
    l."workCenterId"                            AS "РЦ",
    f."factCategory"                            AS "категория",
    a.field                                     AS "поле",
    a."oldValue"                                AS "было",
    a."newValue"                                AS "стало"
FROM audit_records a
JOIN production_facts f ON f.id = a."objectId" AND a."objectType" = 'ProductionFact'
JOIN production_order_lines l ON l.id = f."lineId"
JOIN production_orders o ON o.id = l."orderId"
LEFT JOIN users u ON u.id = a."userId"
WHERE o.id ILIKE :'pattern'
ORDER BY a."createdAt";
