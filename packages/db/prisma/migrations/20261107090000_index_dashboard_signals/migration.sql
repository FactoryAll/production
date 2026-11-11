-- Индексы под отпечаток состояния дашборда (переезд на 1 vCPU, 07.11.2026).
--
-- Дашборд открывает SSE-канал и каждые 5 секунд считает отпечаток: COUNT(*) + MAX(...) по
-- четырём таблицам. Ни по одной из этих колонок индекса не было, то есть каждый опрос —
-- четыре seq scan. На пустой базе это мгновение; через год — заметная нагрузка на одно
-- ядро, и тем более при нескольких открытых вкладках (каждая держит свой канал).
--
-- Индексы дешёвые: одна колонка, растущее значение, обновляется только при вставке.

CREATE INDEX "production_orders_updatedAt_idx" ON "production_orders"("updatedAt");

CREATE INDEX "production_order_lines_updatedAt_idx" ON "production_order_lines"("updatedAt");

CREATE INDEX "stage_timings_transitionedAt_idx" ON "stage_timings"("transitionedAt");

CREATE INDEX "stock_movements_createdAt_idx" ON "stock_movements"("createdAt");
