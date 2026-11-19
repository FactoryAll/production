/**
 * План загрузки спецификаций: что привяжется, что нет и почему — чистый модуль.
 *
 * Отдельный шаг нужен по той же причине, что и в импорте номенклатуры: спецификация — это
 * мастер-данные, и человек обязан увидеть последствия до записи. Загрузчик без плана
 * молча меняет привязки сотен позиций.
 */

import type { BomParseResult, BomProductGroup } from './bom';

export interface CatalogueEntry {
  code: string;
  name: string;
  category: string;
  active: boolean;
}

export type BomPlanAction =
  /** ГП и Масса есть в номенклатуре — привязку можно записывать. */
  | 'bind'
  /** Привязку записывать нельзя или незачем — причина в `reason`. */
  | 'skip';

export interface BomPlanItem {
  gpCode: string;
  gpName: string;
  massCode?: string;
  massName?: string;
  massShare?: number;
  tubeCode?: string;
  tubeName?: string;
  tubeShare?: number;
  action: BomPlanAction;
  reason?: string;
}

export interface BomPlan {
  /** Что будет привязано (Масса). */
  bind: BomPlanItem[];
  /** Что пропускаем: ГП или Массы нет в номенклатуре, противоречия и т. п. */
  skip: BomPlanItem[];
  /** Активные ГП нашего справочника, которых в файле нет вовсе — рабочий список для НП. */
  absentFromFile: CatalogueEntry[];
  /** Активные ГП, у которых в файле нет Массы (только упаковка или ничего). */
  withoutMassInFile: BomPlanItem[];
  counts: {
    fromFile: number;
    bind: number;
    skip: number;
    absentFromFile: number;
    withoutMassInFile: number;
  };
}

function describeGroup(group: BomProductGroup): BomPlanItem {
  return {
    gpCode: group.gpCode,
    gpName: group.gpName,
    massCode: group.mass?.componentCode,
    massName: group.mass?.componentName,
    massShare: group.mass?.share,
    tubeCode: group.tube?.componentCode,
    tubeName: group.tube?.componentName,
    tubeShare: group.tube?.share,
    action: 'skip',
  };
}

/**
 * Сравнивает разобранный файл с текущим справочником.
 *
 * Ничего не решает за человека про привязки, которых в файле нет: они попадают в
 * `absentFromFile` и `withoutMassInFile` — это рабочий список, а не повод удалять данные.
 */
export function buildBomPlan(parsed: BomParseResult, catalogue: CatalogueEntry[]): BomPlan {
  const byCode = new Map(catalogue.map((entry) => [entry.code, entry]));
  const bind: BomPlanItem[] = [];
  const skip: BomPlanItem[] = [];
  const withoutMassInFile: BomPlanItem[] = [];

  for (const group of parsed.groups) {
    const item = describeGroup(group);
    const gp = byCode.get(group.gpCode);

    if (!group.mass) {
      item.reason = 'В файле у этой ГП нет компонента «Масса»';
      withoutMassInFile.push(item);
      continue;
    }
    if (!gp) {
      item.reason = 'ГП нет в номенклатуре ProdTrack — сначала заводится номенклатура';
      skip.push(item);
      continue;
    }
    if (gp.category !== 'GP') {
      item.reason = `Код ${group.gpCode} в номенклатуре имеет категорию ${gp.category}, а не «ГП»`;
      skip.push(item);
      continue;
    }
    if (!gp.active) {
      item.reason = 'ГП деактивирована — привязку не заполняем';
      skip.push(item);
      continue;
    }

    const mass = byCode.get(group.mass.componentCode);
    if (!mass) {
      item.reason = `Массы ${group.mass.componentCode} нет в номенклатуре ProdTrack`;
      skip.push(item);
      continue;
    }
    if (mass.category !== 'MASS') {
      item.reason = `Код ${mass.code} в номенклатуре имеет категорию ${mass.category}, а не «Масса»`;
      skip.push(item);
      continue;
    }

    item.action = 'bind';
    bind.push(item);
  }

  const fileGpCodes = new Set(parsed.groups.map((group) => group.gpCode));
  const absentFromFile = catalogue
    .filter((entry) => entry.category === 'GP' && entry.active && !fileGpCodes.has(entry.code))
    .sort((left, right) => left.code.localeCompare(right.code));

  return {
    bind,
    skip,
    absentFromFile,
    withoutMassInFile,
    counts: {
      fromFile: parsed.groups.length,
      bind: bind.length,
      skip: skip.length,
      absentFromFile: absentFromFile.length,
      withoutMassInFile: withoutMassInFile.length,
    },
  };
}

/** Текст отчёта для человека: то, что он читает до нажатия «Загрузить». */
export function describeBomPlan(plan: BomPlan, issues: string[]): string {
  const lines: string[] = [];
  lines.push(`Позиций ГП в файле: ${plan.counts.fromFile}`);
  lines.push(`  привяжется (Масса): ${plan.counts.bind}`);
  lines.push(`  пропущено: ${plan.counts.skip}`);
  lines.push(`  без Массы в файле: ${plan.counts.withoutMassInFile}`);
  lines.push(`Активных ГП справочника вне файла: ${plan.counts.absentFromFile}`);

  if (plan.skip.length > 0) {
    lines.push('', 'Пропущено:');
    for (const item of plan.skip) {
      lines.push(`  ${item.gpCode} — ${item.reason ?? ''}`);
    }
  }
  if (issues.length > 0) {
    lines.push('', 'Противоречия в файле:');
    for (const issue of issues) {
      lines.push(`  ${issue}`);
    }
  }
  if (plan.absentFromFile.length > 0) {
    lines.push('', 'ГП справочника, которых нет в файле (останутся без привязки):');
    for (const entry of plan.absentFromFile.slice(0, 30)) {
      lines.push(`  ${entry.code} — ${entry.name}`);
    }
    if (plan.absentFromFile.length > 30) {
      lines.push(`  … и ещё ${plan.absentFromFile.length - 30}`);
    }
  }
  return lines.join('\n');
}
