export interface Env {
  SHOP_DO: DurableObjectNamespace<import('./shop-do').ShopDO>
  PAIR_RATE_LIMITER: RateLimit
  ADMIN_SECRET: string
}
