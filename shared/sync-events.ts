import { z } from 'zod'
import { LedgerTableSchema } from './ledger-schemas'

export {
  LEDGER_TABLE_NAMES,
  LedgerTableSchema,
  type LedgerTableName,
} from './ledger-schemas'

export const SyncOperationSchema = z.enum(['create', 'put', 'delete'])

export const SyncEventSchema = z.object({
  eventId: z.string().uuid(),
  txId: z.string().uuid(),
  txOrder: z.number().int().nonnegative(),
  table: LedgerTableSchema,
  entityKey: z.string().min(1),
  entityGid: z.string().uuid().nullable(),
  operation: SyncOperationSchema,
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  refs: z.record(z.string(), z.string().uuid().nullable()),
})

export const ServerEventSchema = SyncEventSchema.extend({
  seq: z.number().int().positive(),
  deviceId: z.string().uuid(),
  serverAt: z.number().int(),
})

export type SyncOperation = z.infer<typeof SyncOperationSchema>
export type SyncEvent = z.infer<typeof SyncEventSchema>
export type ServerEvent = z.infer<typeof ServerEventSchema>
