-- 14.11.2026: видимый статус «Ожидает закрытия НП» между вводом итогов и закрытием ПЗ.
ALTER TYPE "ProductionOrderStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_CLOSE';
