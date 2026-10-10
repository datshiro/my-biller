/** Mã sổ / mã máy rút gọn để người bán đọc và so bằng mắt: `3f9a…c21`. */
export function shortId(id: string): string {
  if (id.length < 8) return id
  return `${id.slice(0, 4)}…${id.slice(-3)}`
}
