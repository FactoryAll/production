import * as React from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef
} from '@tanstack/react-table';

export interface TableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
}

export function Table<TData>({ data, columns }: TableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  return (
    <div className="overflow-x-auto rounded-md border border-mist-metal">
      <table className="w-full text-left text-base">
        <thead className="bg-graphite-surface">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="border-b border-mist-metal px-4 py-3 font-bold text-graphite">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-neutral-100">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="border-b border-mist-metal px-4 py-3 text-graphite">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
