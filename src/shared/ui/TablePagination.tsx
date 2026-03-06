interface TablePaginationProps {
  page: number;
  totalPages: number;
  totalRows: number;
  onPageChange: (page: number) => void;
}

export function TablePagination({ page, totalPages, totalRows, onPageChange }: TablePaginationProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dcc8ac] bg-[#f7eddc]/55 px-4 py-3 text-sm">
      <p className="text-[#765f4a]">إجمالي السجلات: {totalRows}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          السابق
        </button>
        <span className="rounded-md border border-[#c89d68] bg-[#fff0d6] px-3 py-1.5 font-bold text-[#8f5126]">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="btn-secondary rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          التالي
        </button>
      </div>
    </div>
  );
}
