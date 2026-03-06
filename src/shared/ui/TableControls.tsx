import type { SortDirection } from '@/shared/hooks/useDataView';

interface SortOption {
  value: string;
  label: string;
}

interface TableControlsProps {
  search: string;
  onSearchChange: (value: string) => void;
  sortBy: string;
  onSortByChange: (value: string) => void;
  sortDirection: SortDirection;
  onSortDirectionChange: (value: SortDirection) => void;
  sortOptions: SortOption[];
  searchPlaceholder?: string;
  searchLabel?: string;
  sortLabel?: string;
  directionLabel?: string;
}

export function TableControls({
  search,
  onSearchChange,
  sortBy,
  onSortByChange,
  sortDirection,
  onSortDirectionChange,
  sortOptions,
  searchPlaceholder = 'بحث...',
  searchLabel = 'حقل البحث',
  sortLabel = 'الترتيب حسب',
  directionLabel = 'اتجاه الترتيب',
}: TableControlsProps) {
  return (
    <div className="rounded-2xl border border-[#d5c3a6] bg-[#f8efdf] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
      <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_260px_180px]">
        <label>
          <span className="form-label">{searchLabel}</span>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="form-input"
          />
        </label>

        <label>
          <span className="form-label">{sortLabel}</span>
          <select
            value={sortBy}
            onChange={(event) => onSortByChange(event.target.value)}
            className="form-select"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="form-label">{directionLabel}</span>
          <button
            type="button"
            onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}
            className="btn-secondary w-full"
          >
            {sortDirection === 'asc' ? 'تصاعدي' : 'تنازلي'}
          </button>
        </div>
      </div>
    </div>
  );
}
