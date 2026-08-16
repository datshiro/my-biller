import { db } from '../db'
import { getAppState, saveAppState } from './settings'
import { newGid } from '@/domain/gid'
import {
  ExpenseCategorySchema,
  ExpenseSchema,
  type Expense,
  type ExpenseCategory,
} from '@/domain/schema'
import { syncTransaction } from '../sync/outbox'

export type ExpenseInput = Omit<Expense, 'id' | 'gid' | 'createdAt' | 'updatedAt'>
export type ExpenseCategoryInput = Omit<ExpenseCategory, 'id' | 'gid' | 'createdAt' | 'updatedAt'>

const now = () => Date.now()

export function listExpensesBetween(from: number, to: number): Promise<Expense[]> {
  return db.expenses.where('spentAt').between(from, to, true, true).toArray()
}

export async function createExpense(input: ExpenseInput): Promise<number> {
  const stamp = now()
  return syncTransaction(() =>
    db.expenses.add(
      ExpenseSchema.parse({ ...input, gid: newGid(), createdAt: stamp, updatedAt: stamp }),
    ),
  )
}

export async function updateExpense(id: number, patch: Partial<ExpenseInput>): Promise<void> {
  const current = await db.expenses.get(id)
  if (!current) throw new Error(`Không tìm thấy khoản chi #${id}`)
  await syncTransaction(() =>
    db.expenses.put(ExpenseSchema.parse({ ...current, ...patch, id, updatedAt: now() })),
  )
}

export async function deleteExpense(id: number): Promise<void> {
  await syncTransaction(() => db.expenses.delete(id))
}

export function listExpenseCategories(): Promise<ExpenseCategory[]> {
  return db.expenseCategories.orderBy('name').toArray()
}

export async function createExpenseCategory(input: ExpenseCategoryInput): Promise<number> {
  const stamp = now()
  return syncTransaction(() =>
    db.expenseCategories.add(
      ExpenseCategorySchema.parse({ ...input, gid: newGid(), createdAt: stamp, updatedAt: stamp }),
    ),
  )
}

export async function updateExpenseCategory(
  id: number,
  patch: Partial<ExpenseCategoryInput>,
): Promise<void> {
  const current = await db.expenseCategories.get(id)
  if (!current) throw new Error(`Không tìm thấy loại chi phí #${id}`)
  await syncTransaction(() =>
    db.expenseCategories.put(
      ExpenseCategorySchema.parse({ ...current, ...patch, id, updatedAt: now() }),
    ),
  )
}

export function countExpensesInCategory(id: number): Promise<number> {
  return db.expenses.where('categoryId').equals(id).count()
}

/**
 * Chặn thay vì âm thầm gỡ nhãn: khoản chi mất loại là mất luôn thông tin người bán đã bỏ công ghi,
 * và tổng theo loại của những tháng cũ sẽ đổi mà không ai biết vì sao.
 */
export async function deleteExpenseCategory(id: number): Promise<void> {
  await syncTransaction(async () => {
    const used = await db.expenses.where('categoryId').equals(id).count()
    if (used > 0) {
      throw new Error(`Loại này đang có ${used} khoản chi. Xoá hoặc đổi loại các khoản đó trước.`)
    }
    await db.expenseCategories.delete(id)
  })
}

export const DEFAULT_EXPENSE_CATEGORIES = ['Nguyên liệu', 'Thuê', 'Khác'] as const

/**
 * Tạo sẵn vài loại cho lần đầu mở màn Chi phí — bắt người bán tự nghĩ ra tên loại trước khi ghi
 * được đồng chi phí đầu tiên là cách nhanh nhất để họ bỏ luôn.
 *
 * Chốt bằng cờ trong `settings` chứ không bằng "bảng loại đang rỗng": từ khi có màn quản lý loại,
 * người bán xoá sạch loại vì không muốn dùng thì chúng phải ở yên chỗ đã xoá.
 */
export async function ensureDefaultExpenseCategories(): Promise<void> {
  if ((await getAppState()).seededExpenseCategories) return

  // Transaction chỉ bao đúng bảng loại và đúng lúc cần ghi: màn Chi phí đang đọc bảng này ngay khi
  // mở, giữ khoá lâu hơn mức cần là để hàng chip loại hiện chậm ngay lần mở đầu.
  await syncTransaction(async () => {
    if ((await db.expenseCategories.count()) > 0) return
    const stamp = now()
    await db.expenseCategories.bulkAdd(
      DEFAULT_EXPENSE_CATEGORIES.map((name) =>
        ExpenseCategorySchema.parse({ name, gid: newGid(), createdAt: stamp, updatedAt: stamp }),
      ),
    )
  })

  await saveAppState({ seededExpenseCategories: true })
}
