type PaginationProps = {
  currentPage: number;
  getPageHref: (page: number) => string;
  label?: string;
  totalPages: number;
};

function getVisiblePages(currentPage: number, totalPages: number) {
  const pages = new Set<number>([1, totalPages]);

  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page >= 1 && page <= totalPages) {
      pages.add(page);
    }
  }

  return [...pages].sort((a, b) => a - b);
}

export function Pagination({ currentPage, getPageHref, label = "페이지 이동", totalPages }: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const visiblePages = getVisiblePages(currentPage, totalPages);

  return (
    <nav className="pagination" aria-label={label}>
      <a className={currentPage <= 1 ? "pagination-link disabled" : "pagination-link"} href={currentPage <= 1 ? undefined : getPageHref(currentPage - 1)}>
        이전
      </a>

      <div className="pagination-pages">
        {visiblePages.map((page, index) => {
          const previousPage = visiblePages[index - 1];
          const hasGap = previousPage !== undefined && page - previousPage > 1;

          return (
            <span className="pagination-page-group" key={page}>
              {hasGap ? <span className="pagination-ellipsis">…</span> : null}
              <a className={page === currentPage ? "pagination-link active" : "pagination-link"} href={page === currentPage ? undefined : getPageHref(page)}>
                {page}
              </a>
            </span>
          );
        })}
      </div>

      <a
        className={currentPage >= totalPages ? "pagination-link disabled" : "pagination-link"}
        href={currentPage >= totalPages ? undefined : getPageHref(currentPage + 1)}
      >
        다음
      </a>
    </nav>
  );
}
