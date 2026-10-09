/** Trang `/admin` là của người vận hành, không phải một máy bán: không chạy đồng bộ hay heartbeat ở đó. */
export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}
