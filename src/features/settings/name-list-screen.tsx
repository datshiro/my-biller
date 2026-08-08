import { useState } from 'react'
import { Button } from '@/ui/button'
import { ConfirmDialog } from '@/ui/confirm-dialog'
import { EmptyState, ListSkeleton } from '@/ui/empty-state'
import { ListRow } from '@/ui/list-row'
import { ListScreen } from '@/ui/list-screen'
import { Sheet } from '@/ui/sheet'
import { TextField } from '@/ui/text-field'
import { useSubmitOnce } from '@/ui/use-submit-once'

export type NameRow = { id: number; name: string; usage: number }

type Props = {
  title: string
  hint: string
  addLabel: string
  emptyMessage: string
  rows: NameRow[] | undefined
  /** Dòng phụ của mỗi hàng, ví dụ `3 mặt hàng`. */
  describeUsage: (usage: number) => string
  /** Lý do không cho xoá, hoặc `null` nếu xoá được. Hiện sẵn thay vì để bấm rồi mới báo lỗi. */
  blockDelete: (row: NameRow) => string | null
  confirmDelete: (row: NameRow) => string
  onCreate: (name: string) => Promise<unknown>
  onRename: (id: number, name: string) => Promise<unknown>
  onDelete: (id: number) => Promise<unknown>
}

const message = (error: unknown) => (error instanceof Error ? error.message : 'Không lưu được. Thử lại.')

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('vi') === b.trim().toLocaleLowerCase('vi')

function NameSheet({
  row,
  others,
  blockedReason,
  onSave,
  onAskDelete,
  onClose,
}: {
  row: NameRow | null
  others: NameRow[]
  blockedReason: string | null
  onSave: (name: string) => Promise<unknown>
  onAskDelete: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(row?.name ?? '')
  const [invalid, setInvalid] = useState<string | undefined>()
  const { submitting: saving, error: saveError, run } = useSubmitOnce()

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setInvalid('Nhập tên.')
      return
    }
    if (others.some((other) => sameName(other.name, trimmed))) {
      setInvalid('Tên này đã có rồi.')
      return
    }
    setInvalid(undefined)

    void run(async () => {
      await onSave(trimmed)
      onClose()
    })
  }

  return (
    <Sheet
      title={row ? 'Sửa tên' : 'Thêm mới'}
      onClose={onClose}
      footer={
        <Button size="cta" disabled={saving} onClick={save}>
          {saving ? 'Đang lưu…' : 'LƯU'}
        </Button>
      }
    >
      <TextField
        label="Tên"
        value={name}
        autoFocus
        onChange={(event) => {
          setName(event.target.value)
          setInvalid(undefined)
        }}
        error={invalid ?? saveError ?? undefined}
      />

      {row ? (
        <div className="mt-6 border-t border-line pt-4">
          <Button variant="danger" disabled={blockedReason !== null} onClick={onAskDelete}>
            Xoá
          </Button>
          {blockedReason ? <p className="mt-2 text-[13px] text-muted">{blockedReason}</p> : null}
        </div>
      ) : null}
    </Sheet>
  )
}

export function NameListScreen({
  title,
  hint,
  addLabel,
  emptyMessage,
  rows,
  describeUsage,
  blockDelete,
  confirmDelete,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  // `undefined` = sheet đóng, `null` = đang thêm mới.
  const [editing, setEditing] = useState<NameRow | null | undefined>(undefined)
  const [confirming, setConfirming] = useState<NameRow | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const remove = async (row: NameRow) => {
    setConfirming(null)
    try {
      await onDelete(row.id)
      setEditing(undefined)
    } catch (caught) {
      setDeleteError(message(caught))
    }
  }

  return (
    <ListScreen
      title={title}
      count={rows ? `${rows.length}` : undefined}
      cta={
        <Button size="cta" disabled={rows === undefined} onClick={() => setEditing(null)}>
          ＋ {addLabel}
        </Button>
      }
    >
      <p className="px-4 py-3 text-[13px] text-muted">{hint}</p>

      {deleteError ? (
        <p role="alert" className="mx-4 mb-3 rounded-btn bg-danger-tint px-3 py-2 text-[13px] font-semibold text-danger">
          {deleteError}
        </p>
      ) : null}

      {rows === undefined ? (
        <ListSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState message={emptyMessage} actionLabel={`＋ ${addLabel}`} onAction={() => setEditing(null)} />
      ) : (
        <ul className="border-t border-line">
          {rows.map((row) => (
            <li key={row.id}>
              <ListRow
                title={row.name}
                subtitle={describeUsage(row.usage)}
                right={<span className="text-[20px] text-muted">›</span>}
                onClick={() => {
                  setDeleteError(null)
                  setEditing(row)
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {editing !== undefined ? (
        <NameSheet
          key={editing?.id ?? 'new'}
          row={editing}
          others={(rows ?? []).filter((row) => row.id !== editing?.id)}
          blockedReason={editing ? blockDelete(editing) : null}
          onSave={(name) => (editing ? onRename(editing.id, name) : onCreate(name))}
          onAskDelete={() => setConfirming(editing)}
          onClose={() => setEditing(undefined)}
        />
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title={`Xoá “${confirming.name}”?`}
          message={confirmDelete(confirming)}
          confirmLabel="Xoá"
          onConfirm={() => void remove(confirming)}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </ListScreen>
  )
}
