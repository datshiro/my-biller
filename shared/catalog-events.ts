import { z } from 'zod'
import { LEDGER_TABLE_NAMES, OptionGroupPayloadSchema, OptionGroupRowSchema, type LedgerTableName } from './ledger-schemas'
import { SyncOperationSchema } from './sync-events'

/**
 * Bảng đi luồng danh mục: oplog thứ hai, seq riêng, chỉ máy bản mới kéo/đẩy. Máy bản cũ đòi seq sổ chính liền nhau và
 * kẹt khi gặp bảng lạ, nên bảng mới không bao giờ được vào sổ chính.
 */
export const CatalogTableSchema = z.enum(['optionGroups'])

export type CatalogTableName = z.infer<typeof CatalogTableSchema>
export const CATALOG_TABLE_NAMES = CatalogTableSchema.options

/** Mọi bảng outbox bắt thay đổi; thứ tự là thứ tự nạp sổ lúc ghép máy (danh mục sau sổ chính). */
export const SYNCED_TABLE_NAMES: readonly (LedgerTableName | CatalogTableName)[] = [
  ...LEDGER_TABLE_NAMES,
  ...CATALOG_TABLE_NAMES,
]

export function isCatalogTable(table: string): table is CatalogTableName {
  return (CATALOG_TABLE_NAMES as readonly string[]).includes(table)
}

export const CatalogEventSchema = z.object({
  eventId: z.string().uuid(),
  txId: z.string().uuid(),
  txOrder: z.number().int().nonnegative(),
  table: CatalogTableSchema,
  entityKey: z.string().uuid(),
  entityGid: z.string().uuid(),
  operation: SyncOperationSchema,
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  // Danh mục trỏ nhau bằng gid trong payload, không có khoá ngoại cục bộ nào cần `refs`.
  refs: z.object({}).strict(),
})

export const CatalogServerEventSchema = CatalogEventSchema.extend({
  seq: z.number().int().positive(),
  deviceId: z.string().uuid(),
  serverAt: z.number().int(),
})

export type CatalogEvent = z.infer<typeof CatalogEventSchema>
export type CatalogServerEvent = z.infer<typeof CatalogServerEventSchema>

export function safeParseCatalogPayload(_table: CatalogTableName, payload: unknown) {
  return (OptionGroupPayloadSchema as z.ZodType<Record<string, unknown>>).safeParse(payload)
}

export function safeParseCatalogRow(_table: CatalogTableName, row: unknown) {
  return (OptionGroupRowSchema as z.ZodType<Record<string, unknown>>).safeParse(row)
}
