import Link from 'next/link';
import { Card } from '@prodtrack/ui';

const NSI_CATALOGS = [
  { href: '/nsi/work-centers', title: 'Рабочие центры', description: '12 производственных центров (РЦ)' },
  { href: '/nsi/products', title: 'Номенклатура', description: 'Категории Масса / ГП и единицы измерения' },
  { href: '/nsi/employees', title: 'Сотрудники', description: 'ФИО и табельные номера' },
  { href: '/nsi/defect-reasons', title: 'Причины брака', description: 'Справочник причин брака' },
  { href: '/nsi/substitution-reasons', title: 'Причины ввода за Оператора', description: 'ILLNESS, NO_SHOW, LEFT_SHIFT, OTHER' },
  { href: '/nsi/shifts', title: 'Смены', description: 'Расписание 08:00–20:00 / 20:00–08:00' },
  { href: '/nsi/warehouses', title: 'Склады', description: 'Производственный склад и Склад ГП' },
];

export const metadata = {
  title: 'Справочники — ProdTrack',
};

export default function NsiIndexPage() {
  return (
    <main className="p-6">
      <h1 className="mb-2 text-3xl font-bold text-deep-industry-blue">Справочники (НСИ)</h1>
      <p className="mb-8 text-neutral-600">Выберите справочник для просмотра или редактирования.</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {NSI_CATALOGS.map((catalog) => (
          <Link
            key={catalog.href}
            href={catalog.href}
            className="group block transition-transform hover:-translate-y-0.5"
          >
            <Card className="h-full border-mist-metal bg-pure-white hover:border-deep-industry-blue hover:shadow-md">
              <h2 className="mb-1 text-lg font-semibold text-graphite group-hover:text-deep-industry-blue">
                {catalog.title}
              </h2>
              <p className="text-sm text-neutral-500">{catalog.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
