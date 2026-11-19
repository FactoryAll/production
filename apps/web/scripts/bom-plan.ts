/**
 * Загрузка спецификаций из 1С: разбор файла → план → отчёт. CLI для линии поддержки.
 *
 * Запуск (из каталога apps/web):
 *   DATABASE_URL=… node scripts/bom-plan.ts <файл.xlsx> [--csv out.csv]
 *
 * Почему CLI, а не экран: файл приходит из 1С как выгрузка, и обновление источника правды —
 * это повторяемая операция (файл → план → запись), а не разовая кнопка. Экран для НП/АДМ
 * появится вместе с полем привязки в схеме (см. docs/gp_mass_binding_analysis.md).
 *
 * Сейчас шаг записи намеренно отсутствует: в схеме ещё нет поля привязки ГП → Масса.
 * Скрипт доводит дело до плана и отчёта, чтобы решение принималось по цифрам, а не на словах.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { readFirstSheet } from '../src/lib/bom-import/xlsx.ts';
import { parseBom, type BomParseResult } from '../src/lib/bom-import/bom.ts';
import { buildBomPlan, describeBomPlan, type CatalogueEntry } from '../src/lib/bom-import/plan.ts';
import { applyBomPlan } from '../src/lib/bom-import/apply.ts';

function usage(): never {
  console.error('Использование: DATABASE_URL=… node scripts/bom-plan.ts <файл.xlsx> [--csv out.csv]');
  process.exit(2);
}

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith('--'));
if (!file) usage();
const csvIndex = args.indexOf('--csv');
const csvOut = csvIndex >= 0 ? args[csvIndex + 1] : undefined;
// Запись привязок в базу — только по явному --apply: план без флага ничего не меняет.
const apply = args.includes('--apply');

const prisma = new PrismaClient();
try {
  const buffer = readFileSync(file);
  const rows = readFirstSheet(buffer);

  const products = await prisma.product.findMany({
    select: { code: true, name: true, category: true, active: true },
  });
  const catalogue: CatalogueEntry[] = products.map((product) => ({
    code: product.code,
    name: product.name,
    category: product.category,
    active: product.active,
  }));
  const catalogueByCode = new Map(catalogue.map((entry) => [entry.code, entry]));

  let parsed: BomParseResult;
  try {
    parsed = parseBom(rows, catalogueByCode);
  } catch (error) {
    console.error(`Файл не принят: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log(`Файл: ${file}`);
  console.log(`Строк прочитано: ${parsed.stats.rows}`);
  console.log(`  отброшено как «не продукция» (Масса/Сырьё): ${parsed.stats.skippedNotProduct}`);
  console.log(`  отброшено как упаковка и прочее: ${parsed.stats.skippedOtherComponent}`);
  console.log(`  привязок «ГП → Масса»: ${parsed.stats.massBindings}`);
  console.log(`  привязок «ГП → Туба»: ${parsed.stats.tubeBindings}`);
  console.log('');
  console.log(describeBomPlan(buildBomPlan(parsed, catalogue), parsed.issues));

  if (csvOut) {
    const lines = ['gp_code;gp_name;mass_code;mass_name;share_kg;tube_code;tube_share'];
    for (const group of parsed.groups) {
      lines.push(
        [
          group.gpCode,
          group.gpName,
          group.mass?.componentCode ?? '',
          group.mass?.componentName ?? '',
          group.mass?.share ?? '',
          group.tube?.componentCode ?? '',
          group.tube?.share ?? '',
        ].join(';'),
      );
    }
    writeFileSync(csvOut, `${lines.join('\n')}\n`, 'utf8');
    console.log(`\nВыгружено в ${csvOut}: ${parsed.groups.length} позиций ГП`);
  }

  if (apply) {
    const plan = buildBomPlan(parsed, catalogue);
    const result = await applyBomPlan(
      prisma as never,
      plan,
      { fileName: file.split('/').pop() ?? file },
    );
    console.log('');
    console.log(`Записано: привязок Массы ${result.massBound}, привязок Тубы ${result.tubeBound}, ` +
      `без изменений ${result.massUnchanged}. Журнал запуска: ${result.runId}`);
  } else {
    console.log('\nЗапись не выполнялась. Чтобы записать привязки, повторите с флагом --apply.');
  }
} finally {
  await prisma.$disconnect();
}
