import type { Env } from './env'

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shops (
    shopId TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    via TEXT NOT NULL,
    indexedAt INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS heartbeats (
    installId TEXT PRIMARY KEY,
    shopName TEXT NOT NULL,
    appVersion TEXT NOT NULL,
    platform TEXT NOT NULL,
    orderCount INTEGER NOT NULL,
    customerCount INTEGER NOT NULL,
    debtTotal INTEGER NOT NULL,
    firstSeenAt INTEGER NOT NULL,
    lastSeenAt INTEGER NOT NULL,
    pairedShopId TEXT,
    pairedAt INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS heartbeats_seen ON heartbeats(lastSeenAt)',
  'CREATE INDEX IF NOT EXISTS heartbeats_first_seen ON heartbeats(firstSeenAt)',
]

let schemaReady: Promise<void> | null = null

/** Sổ đã ghi lượt chạm trong isolate này; mỗi sổ chỉ tốn một câu D1 cho tới khi isolate bị thay. */
export const touchedShops = new Set<string>()

export function ensureAdminDb(env: Env): Promise<void> {
  schemaReady ??= env.ADMIN_DB.batch(SCHEMA.map((sql) => env.ADMIN_DB.prepare(sql))).then(
    () => undefined,
    (error: unknown) => {
      schemaReady = null
      throw error
    },
  )
  return schemaReady
}

/**
 * Mọi truy vấn D1 của Worker đi qua đây. DDL chỉ chạy một lần mỗi isolate, nên bảng bị xoá sau đó sẽ làm câu
 * truy vấn hỏng với `no such table`: khi đó tạo lại bảng và thử đúng một lần nữa.
 */
export async function withAdminDb<T>(env: Env, run: (db: D1Database) => Promise<T>): Promise<T> {
  await ensureAdminDb(env)
  try {
    return await run(env.ADMIN_DB)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('no such table')) throw error
    schemaReady = null
    await ensureAdminDb(env)
    return run(env.ADMIN_DB)
  }
}
