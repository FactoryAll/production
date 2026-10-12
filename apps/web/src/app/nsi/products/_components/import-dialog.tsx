'use client';

// Диалог загрузки номенклатуры из файла (этап 5, задание владельца 12.10.2026).
//
// Порядок работы: выбрать файл → «Проверить файл» (сервер считает последствия и показывает их) →
// «Загрузить». Пока в файле есть ошибки, кнопка загрузки выключена: частично загруженный
// справочник хуже, чем незагруженный.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog } from '@prodtrack/ui';
import { PREVIEW_ROWS } from '@/lib/nsi-import/product-import';
import {
  applyProductImportAction,
  checkProductImportAction,
  type ProductImportCheckResult,
} from '../import-actions';

interface ImportProductsDialogProps {
  open: boolean;
  onClose: () => void;
}

type ImportMode = 'add-only' | 'upsert';

const CATEGORY_LABELS: Record<string, string> = { MASS: 'Масса', GP: 'ГП' };

const ACTION_LABELS: Record<string, string> = {
  create: 'создание',
  update: 'изменение',
  unchanged: 'без изменений',
  skip: 'пропуск',
};

export function ImportProductsDialog({ open, onClose }: ImportProductsDialogProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>('add-only');
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [report, setReport] = useState<ProductImportCheckResult | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = (report?.counts.create ?? 0) + (report?.counts.update ?? 0);
  const busy = checking || applying;

  function startOver() {
    setReport(null);
    setDone(null);
    setError(null);
  }

  async function handleCheck() {
    if (!file) {
      setError('Выберите файл .xlsx');
      return;
    }
    setChecking(true);
    startOver();

    const formData = new FormData();
    formData.set('file', file);
    formData.set('mode', mode);

    const response = await checkProductImportAction(formData);
    setReport(response);
    if (!response.ok && response.error) {
      setError(response.error);
    }
    setChecking(false);
  }

  async function handleApply() {
    if (!file) {
      setError('Выберите файл .xlsx');
      return;
    }
    setApplying(true);
    setError(null);
    setDone(null);

    const formData = new FormData();
    formData.set('file', file);
    formData.set('mode', mode);

    const response = await applyProductImportAction(formData);
    if (response.success) {
      const parts = [
        'создано: ' + (response.created ?? 0),
        'обновлено: ' + (response.updated ?? 0),
        'пропущено: ' + (response.skipped ?? 0),
        'без изменений: ' + (response.unchanged ?? 0),
      ];
      setDone('Загрузка выполнена — ' + parts.join(', ') + '.');
      setReport(null);
      router.refresh();
    } else {
      setError(response.error ?? 'Не удалось загрузить файл');
    }
    setApplying(false);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Загрузка номенклатуры из файла" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-machine-gray">
          Файл .xlsx с колонками «Код», «Наименование», «Категория» (Масса или ГП) и «Единица измерения».
          Порядок колонок любой, незнакомые колонки игнорируются.{' '}
          <a className="underline" href="/nsi/products/template" download>
            Скачать шаблон
          </a>
        </p>

        <div className="space-y-2">
          <label htmlFor="import-file" className="block text-base font-medium text-graphite">
            Файл
          </label>
          <input
            id="import-file"
            type="file"
            accept=".xlsx,.xlsm"
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              startOver();
            }}
            className="block w-full text-base text-graphite file:mr-3 file:rounded-md file:border file:border-mist-metal file:bg-white file:px-3 file:py-1.5"
          />
        </div>

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="text-base font-medium text-graphite">
            Что делать с кодами, которые уже есть в справочнике
          </legend>
          <label className="flex items-center gap-2 text-base text-graphite">
            <input
              type="radio"
              name="import-mode"
              checked={mode === 'add-only'}
              onChange={() => {
                setMode('add-only');
                startOver();
              }}
            />
            Только добавлять новые (рекомендуется)
          </label>
          <label className="flex items-center gap-2 text-base text-graphite">
            <input
              type="radio"
              name="import-mode"
              checked={mode === 'upsert'}
              onChange={() => {
                setMode('upsert');
                startOver();
              }}
            />
            Добавлять и обновлять существующие: наименование, категория, единица измерения
          </label>
          <p className="text-sm text-machine-gray">
            Признак активности импорт не меняет: деактивированные позиции в работу не возвращаются.
          </p>
        </fieldset>

        {error && <p className="text-sm text-signal-amber">{error}</p>}

        {report?.ok && (
          <div className="space-y-3 rounded-md border border-mist-metal p-3">
            <p className="text-base text-graphite">
              {'Строк с данными: ' + report.totalRows + ' · новых: ' + report.counts.create +
                ' · к обновлению: ' + report.counts.update +
                ' · без изменений: ' + report.counts.unchanged +
                ' · пропущено: ' + report.counts.skip +
                ' · с ошибками: ' + report.counts.errors}
            </p>

            {report.ignoredHeaders.length > 0 && (
              <p className="text-sm text-machine-gray">
                Незнакомые колонки пропущены: {report.ignoredHeaders.join(', ')}
              </p>
            )}

            {report.rowErrors.length > 0 && (
              <div className="text-sm text-signal-amber">
                <p className="font-medium">
                  Строки с ошибками — загрузка заблокирована:
                </p>
                <ul className="list-disc pl-5">
                  {report.rowErrors.map((rowError) => (
                    <li key={rowError.rowNumber}>
                      Строка {rowError.rowNumber}: {rowError.messages.join('; ')}
                    </li>
                  ))}
                </ul>
                {report.counts.errors > report.rowErrors.length && (
                  <p>Показаны первые {PREVIEW_ROWS} из {report.counts.errors}.</p>
                )}
              </div>
            )}

            {report.preview.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm font-sans">
                  <thead>
                    <tr className="text-machine-gray">
                      <th className="border-b border-mist-metal px-2 py-1">Строка</th>
                      <th className="border-b border-mist-metal px-2 py-1">Код</th>
                      <th className="border-b border-mist-metal px-2 py-1">Наименование</th>
                      <th className="border-b border-mist-metal px-2 py-1">Категория</th>
                      <th className="border-b border-mist-metal px-2 py-1">ЕИ</th>
                      <th className="border-b border-mist-metal px-2 py-1">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.preview.map((item) => (
                      <tr key={item.rowNumber}>
                        <td className="border-b border-mist-metal px-2 py-1 text-machine-gray">
                          {item.rowNumber}
                        </td>
                        <td className="border-b border-mist-metal px-2 py-1">{item.code}</td>
                        <td className="border-b border-mist-metal px-2 py-1">{item.name}</td>
                        <td className="border-b border-mist-metal px-2 py-1">
                          {CATEGORY_LABELS[item.category] ?? item.category}
                        </td>
                        <td className="border-b border-mist-metal px-2 py-1">{item.unit}</td>
                        <td className="border-b border-mist-metal px-2 py-1">
                          {ACTION_LABELS[item.action] ?? item.action}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.totalRows > report.preview.length && (
                  <p className="pt-2 text-sm text-machine-gray">
                    Показаны первые {report.preview.length} строк из {report.totalRows}.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {done && <p className="text-sm text-graphite">{done}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Закрыть
          </Button>
          <Button type="button" variant="secondary" onClick={handleCheck} disabled={!file || busy}>
            {checking ? 'Проверка...' : 'Проверить файл'}
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={!report?.ok || pending === 0 || busy}
          >
            {applying ? 'Загрузка...' : 'Загрузить (' + pending + ')'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
