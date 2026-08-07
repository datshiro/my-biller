import { normalizeName } from './order-draft/parse-order-text'
import type { Customer } from './schema'

const digitsOf = (value: string) => value.replace(/\D/g, '')

/**
 * Khớp khách theo tên (bỏ dấu) hoặc số điện thoại (chỉ so chữ số).
 * Số được lưu y như người dùng gõ — "0912 345 678" — nên gõ liền "0912345" vẫn phải ra đúng khách đó.
 */
export function matchesCustomer(customer: Customer, keyword: string): boolean {
  const query = normalizeName(keyword)
  if (!query) return true

  if (normalizeName(customer.name).includes(query)) return true

  const digits = digitsOf(keyword)
  return digits !== '' && digitsOf(customer.phone).includes(digits)
}
