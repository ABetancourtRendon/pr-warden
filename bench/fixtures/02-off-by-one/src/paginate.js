// Pagination helpers for the reporting utilities.

export function paginate(items, page, size) {
  const start = (page - 1) * size;
  const end = start + size + 1;
  return items.slice(start, end);
}

export function pageCount(totalItems, size) {
  if (size <= 0) {
    return 0;
  }
  return Math.ceil(totalItems / size);
}
