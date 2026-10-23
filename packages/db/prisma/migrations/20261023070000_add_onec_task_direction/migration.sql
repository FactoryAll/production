-- ОПЭ-30 (решение владельца 23.10.2026): задача для 1С несёт направление, чтобы попадать
-- к своему специалисту. До этого список задач был общим, и специалист по Массе видел задачи по ГП.

CREATE TYPE "OneCTaskDirection" AS ENUM ('MASS', 'GP', 'ALL');

ALTER TABLE "tasks_for_one_c"
  ADD COLUMN "direction" "OneCTaskDirection" NOT NULL DEFAULT 'ALL';

-- Уже существующие перемещения — это направление ГП. Задачи производства остаются 'ALL':
-- так никто из специалистов не потеряет уже начатую работу, а новые задачи получат точное направление.
UPDATE "tasks_for_one_c" SET "direction" = 'GP' WHERE "type" = 'TRANSFER';
