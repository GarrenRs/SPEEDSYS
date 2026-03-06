import { useMemo } from 'react';

export type SortDirection = 'asc' | 'desc';

interface UseDataViewOptions<T> {
  rows: T[];
  search: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDirection: SortDirection;
  searchAccessor: (row: T) => string;
  sortAccessors: Record<string, (row: T) => string | number>;
}

export function useDataView<T>({
  rows,
  search,
  page,
  pageSize,
  sortBy,
  sortDirection,
  searchAccessor,
  sortAccessors,
}: UseDataViewOptions<T>) {
  return useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter((row) => searchAccessor(row).toLowerCase().includes(q))
      : rows;

    const sorter = sortAccessors[sortBy];
    const sorted = [...filtered].sort((a, b) => {
      const va = sorter?.(a);
      const vb = sorter?.(b);
      if (va === vb) return 0;
      if (va === undefined || va === null) return 1;
      if (vb === undefined || vb === null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDirection === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va);
      const sb = String(vb);
      return sortDirection === 'asc' ? sa.localeCompare(sb, 'ar') : sb.localeCompare(sa, 'ar');
    });

    const totalRows = sorted.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    const pageRows = sorted.slice(start, start + pageSize);

    return { rows: pageRows, totalRows, totalPages, page: safePage };
  }, [rows, search, page, pageSize, sortBy, sortDirection, searchAccessor, sortAccessors]);
}

