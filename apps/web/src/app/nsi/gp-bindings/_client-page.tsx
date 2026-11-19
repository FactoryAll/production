'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Dialog, Input, Label, SearchSelect, Select } from '@prodtrack/ui';
import { formatQuantity } from '@/lib/quantity';

export interface GpBindingRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
  massCode: string | null;
  massName: string | null;
  massQuantity: string | null;
  tubeCode: string | null;
  tubeName: string | null;
  tubeQuantity: string | null;
  packagingCodes: string[];
}

export interface WorkCenterOption {
  code: string;
  label: string;
}

export interface MassOption {
  code: string;
  label: string;
}

export interface LastImport {
  fileName: string;
  startedAt: string;
  massBound: number;
  tubeBound: number;
  skipped: number;
  /** Отчёт сохранён в журнале запусков — его видно и после загрузки, а не только в момент. */
  report: string | null;
}

type Filter = 'all' | 'without-mass' | 'without-tube' | 'without-work-centers';

/**
 * Сводная по привязкам изделий (решение владельца 19.11.2026).
 *
 * Показывает всё, что нужно для работы: какая Масса и Туба закреплены за готовой продукцией,
 * нормы на единицу, на каких РЦ её фасуют — и отдельным фильтром то, где привязки нет.
 * Список «без привязки» — рабочий список владельца: 13 ГП в выгрузке 1С отсутствуют.
 */
export default function GpBindingsPage({
  rows,
  massOptions,
  workCenterOptions,
  canManage,
  lastImport,
}: {
  rows: GpBindingRow[];
  massOptions: MassOption[];
  workCenterOptions: WorkCenterOption[];
  canManage: boolean;
  lastImport: LastImport | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<GpBindingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (query && !row.code.toLowerCase().includes(query) && !row.name.toLowerCase().includes(query)) {
        return false;
      }
      if (filter === 'without-mass') return row.massCode === null;
      if (filter === 'without-tube') return row.tubeCode === null;
      if (filter === 'without-work-centers') return row.packagingCodes.length === 0;
      return true;
    });
  }, [rows, search, filter]);

  const withoutMass = rows.filter((row) => row.massCode === null && row.active).length;

  async function submit(binding: {
    massCode: string;
    massQuantity: string;
    tubeCode: string;
    tubeName: string;
    tubeQuantity: string;
    packagingWorkCenterCodes: string[];
  }) {
    if (!editing) return;
    setError(null);
    setIsPending(true);
    try {
      const { saveProductBindingAction } = await import('./actions');
      const formData = new FormData();
      formData.set('productId', editing.id);
      formData.set('massCode', binding.massCode);
      formData.set('massQuantity', binding.massQuantity);
      formData.set('tubeCode', binding.tubeCode);
      formData.set('tubeName', binding.tubeName);
      formData.set('tubeQuantity', binding.tubeQuantity);
      formData.set('packagingWorkCenterCodes', JSON.stringify(binding.packagingWorkCenterCodes));
      const result = await saveProductBindingAction(formData);
      if (!result.success) {
        setError(result.error ?? 'Не удалось сохранить привязку');
        return;
      }
      setEditing(null);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <main className="p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-graphite">Привязки изделий: ГП ↔ Масса и Туба</h1>
        <p className="text-sm text-machine-gray">
          ГП всего: {rows.length} · без привязки Массы: {withoutMass}
        </p>
      </div>

      {canManage && <BomUploadBlock />}

      {lastImport && (
        <div className="mb-4 text-sm text-machine-gray">
          <p>
            Последняя загрузка спецификаций: {lastImport.fileName} (
            {new Date(lastImport.startedAt).toLocaleString('ru-RU')}) — привязано Масс{' '}
            {lastImport.massBound}, Туб {lastImport.tubeBound}, пропущено {lastImport.skipped}
          </p>
          {lastImport.report && (
            <details className="mt-1">
              <summary className="cursor-pointer text-deep-industry-blue underline">
                Показать отчёт последней загрузки
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-100 p-3 text-xs">
                {lastImport.report}
              </pre>
            </details>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input
          placeholder="Поиск по коду или наименованию"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-sm"
        />
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as Filter)}
          className="h-[var(--button-height-sm)] rounded-md border border-mist-metal bg-white px-3 font-sans text-graphite"
        >
          <option value="all">Все</option>
          <option value="without-mass">Без Массы</option>
          <option value="without-tube">Без Тубы</option>
          <option value="without-work-centers">Без РЦ фасовки</option>
        </select>
      </div>

      <Card className="overflow-clip p-0">
        <div className="table-scroll">
          <table className="w-full text-left text-sm font-sans">
            <thead className="bg-graphite-surface">
              <tr>
                <th className="border-b border-mist-metal px-3 py-2 font-bold">Код</th>
                <th className="border-b border-mist-metal px-3 py-2 font-bold">Номенклатура</th>
                <th className="border-b border-mist-metal px-3 py-2 font-bold">Масса</th>
                <th className="border-b border-mist-metal px-3 py-2 font-bold">Норма, кг</th>
                <th className="border-b border-mist-metal px-3 py-2 font-bold">Туба</th>
                <th className="border-b border-mist-metal px-3 py-2 font-bold">Норма, шт</th>
                <th className="border-b border-mist-metal px-3 py-2 font-bold">РЦ фасовки</th>
                {canManage && <th className="border-b border-mist-metal px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className={row.active ? 'hover:bg-neutral-100' : 'bg-neutral-50 text-neutral-500'}>
                  <td className="border-b border-mist-metal px-3 py-2 font-mono text-xs">{row.code}</td>
                  <td className="border-b border-mist-metal px-3 py-2">{row.name}</td>
                  <td className="border-b border-mist-metal px-3 py-2">
                    {row.massCode ? (
                      `${row.massCode} — ${row.massName ?? ''}`
                    ) : (
                      <span className="text-[var(--color-signal-amber)]">не задана</span>
                    )}
                  </td>
                  <td className="border-b border-mist-metal px-3 py-2">
                    {row.massQuantity ? formatQuantity(row.massQuantity) : '—'}
                  </td>
                  <td className="border-b border-mist-metal px-3 py-2">
                    {row.tubeCode ? `${row.tubeCode} — ${row.tubeName ?? ''}` : '—'}
                  </td>
                  <td className="border-b border-mist-metal px-3 py-2">
                    {row.tubeQuantity ? formatQuantity(row.tubeQuantity) : '—'}
                  </td>
                  <td className="border-b border-mist-metal px-3 py-2">
                    {row.packagingCodes.length > 0 ? row.packagingCodes.join(', ') : 'все фасовочные'}
                  </td>
                  {canManage && (
                    <td className="border-b border-mist-metal px-3 py-2">
                      <Button type="button" variant="secondary" onClick={() => setEditing(row)}>
                        Изменить
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 8 : 7} className="px-4 py-6 text-center text-neutral-500">
                    Ничего не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <BindingDialog
          key={editing.id}
          row={editing}
          massOptions={massOptions}
          workCenterOptions={workCenterOptions}
          error={error}
          isPending={isPending}
          onSubmit={submit}
          onClose={() => {
            setEditing(null);
            setError(null);
          }}
        />
      )}
    </main>
  );
}

/**
 * Загрузка выгрузки 1С (19.11.2026). Два шага: проверка показывает последствия, загрузка пишет.
 * Файл передаётся заново — сервер между запросами ничего не держит.
 */
function BomUploadBlock() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ report: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [done, setDone] = useState(false);

  async function send(action: 'preview' | 'apply') {
    if (!file) return;
    setError(null);
    setDone(false);
    setIsPending(true);
    try {
      const { previewBomAction, applyBomAction } = await import('./bom-actions');
      const formData = new FormData();
      formData.set('file', file);
      const result = action === 'preview' ? await previewBomAction(formData) : await applyBomAction(formData);
      if (!result.success) {
        setPreview(null);
        setError(result.error ?? 'Не удалось разобрать файл');
        return;
      }
      setPreview({ report: result.report ?? '', name: result.fileName ?? file.name });
      if (action === 'apply') {
        setDone(true);
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-2 text-lg font-semibold text-graphite">Загрузить спецификации из 1С</h2>
      <p className="mb-3 text-sm text-machine-gray">
        Файл выгрузки (полная спецификация, .xlsx). Сначала «Проверить» — покажем, что привяжется,
        что пропущено и почему; запись происходит только после «Загрузить».
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".xlsx,.xlsm"
          id="bom-file"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setPreview(null);
            setError(null);
            setDone(false);
          }}
          className="text-sm text-graphite"
        />
        <Button type="button" variant="secondary" disabled={!file || isPending} onClick={() => send('preview')}>
          Проверить
        </Button>
        <Button type="button" variant="cta" disabled={!file || !preview || isPending} onClick={() => send('apply')}>
          {isPending ? 'Работаю...' : 'Загрузить привязки'}
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-signal-amber">{error}</p>}
      {done && (
        <p className="mt-3 text-sm text-graphite">
          Готово: привязки записаны. Список ниже обновлён.
        </p>
      )}
      {preview && (
        <div className="mt-4 rounded-md bg-neutral-100 p-3">
          <p className="mb-2 text-sm font-semibold text-graphite">Отчёт по файлу {preview.name}</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-graphite">{preview.report}</pre>
        </div>
      )}
    </Card>
  );
}

function BindingDialog({
  row,
  massOptions,
  workCenterOptions,
  error,
  isPending,
  onSubmit,
  onClose,
}: {
  row: GpBindingRow;
  massOptions: MassOption[];
  workCenterOptions: WorkCenterOption[];
  error: string | null;
  isPending: boolean;
  onSubmit: (binding: {
    massCode: string;
    massQuantity: string;
    tubeCode: string;
    tubeName: string;
    tubeQuantity: string;
    packagingWorkCenterCodes: string[];
  }) => void;
  onClose: () => void;
}) {
  const [massCode, setMassCode] = useState(row.massCode ?? '');
  const [massQuantity, setMassQuantity] = useState(row.massQuantity ?? '');
  const [tubeCode, setTubeCode] = useState(row.tubeCode ?? '');
  const [tubeName, setTubeName] = useState(row.tubeName ?? '');
  const [tubeQuantity, setTubeQuantity] = useState(row.tubeQuantity ?? '');
  const [packaging, setPackaging] = useState<string[]>(row.packagingCodes);

  return (
    <Dialog open onClose={onClose} size="lg" title={`Привязка: ${row.code} — ${row.name}`}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            massCode,
            massQuantity,
            tubeCode,
            tubeName,
            tubeQuantity,
            packagingWorkCenterCodes: packaging,
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="binding-mass">Масса</Label>
            <Select
              id="binding-mass"
              value={massCode}
              onChange={(event) => setMassCode(event.target.value)}
              options={massOptions.map((option) => ({ value: option.code, label: option.label }))}
              placeholder="Без привязки"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="binding-mass-qty">Норма Массы на единицу, кг</Label>
            <Input
              id="binding-mass-qty"
              type="number"
              step="0.0001"
              min="0"
              value={massQuantity}
              onChange={(event) => setMassQuantity(event.target.value)}
              placeholder="Например 0.088"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="binding-tube">Туба (код)</Label>
            <Input
              id="binding-tube"
              value={tubeCode}
              onChange={(event) => setTubeCode(event.target.value)}
              placeholder="Из спецификации 1С"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="binding-tube-name">Наименование Тубы</Label>
            <Input
              id="binding-tube-name"
              value={tubeName}
              onChange={(event) => setTubeName(event.target.value)}
              placeholder="Например Туба_М Крем, 100 мл"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="binding-tube-qty">Норма Тубы, шт</Label>
            <Input
              id="binding-tube-qty"
              type="number"
              step="0.0001"
              min="0"
              value={tubeQuantity}
              onChange={(event) => setTubeQuantity(event.target.value)}
              placeholder="Например 1"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="binding-work-centers">РЦ фасовки</Label>
          <SearchSelect
            id="binding-work-centers"
            value=""
            onChange={(value) => {
              if (value && !packaging.includes(value)) {
                setPackaging([...packaging, value]);
              }
            }}
            options={workCenterOptions
              .filter((option) => !packaging.includes(option.code))
              .map((option) => ({ value: option.code, label: option.label, keywords: option.code }))}
            placeholder="Добавить РЦ"
          />
          <div className="flex flex-wrap gap-2">
            {packaging.length === 0 && (
              <span className="text-sm text-machine-gray">
                Не задано — изделие можно планировать на любом фасовочном РЦ
              </span>
            )}
            {packaging.map((code) => (
              <button
                key={code}
                type="button"
                className="rounded-md border border-mist-metal px-2 py-1 text-sm text-graphite"
                onClick={() => setPackaging(packaging.filter((item) => item !== code))}
              >
                {code} ×
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-signal-amber">{error}</p>}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          <Button type="submit" variant="cta" disabled={isPending}>
            {isPending ? 'Сохранение...' : 'Сохранить привязку'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
