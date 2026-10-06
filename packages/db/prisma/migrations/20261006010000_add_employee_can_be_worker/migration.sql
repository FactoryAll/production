-- T-071 (M01 §4.1): признак «Может привлекаться работником РЦ».
-- DEFAULT true сохраняет текущее поведение для уже заведённых сотрудников: ограничение
-- вводится осознанно через НСИ, а не задним числом для всех.
ALTER TABLE "employees" ADD COLUMN "canBeWorker" BOOLEAN NOT NULL DEFAULT true;
