export interface Env {
  SHOP_DO: DurableObjectNamespace<import('./shop-do').ShopDO>
  PAIR_RATE_LIMITER: RateLimit
  ADMIN_SECRET: string
  ADMIN_VIEW_SECRET?: string
  ADMIN_DB: D1Database
  HEARTBEAT_RATE_LIMITER: RateLimit
}
