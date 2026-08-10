/** Mã toàn cục dùng để chống ghi trùng giữa các máy. */
export function newGid(): string {
  return crypto.randomUUID()
}
