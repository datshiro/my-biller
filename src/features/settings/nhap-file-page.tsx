import { useState } from 'react'
import { describeSavedFile, saveToDownloads } from './download-sink'
import { applyCustomerImport, applyItemImport, type ImportResult } from '@/db/repositories/nhap-file'
import { listCustomers } from '@/db/repositories/customers'
import { listGroups, listItems } from '@/db/repositories/items'
import { CsvFileError, decodeCsvBytes, parseCsv } from '@/domain/csv'
import { formatVnd } from '@/domain/money'
import {
  CUSTOMER_TEMPLATE,
  effectiveCustomerWrites,
  effectiveItemWrites,
  ITEM_TEMPLATE,
  planCustomerImport,
  planItemImport,
  readCustomerRows,
  readItemRows,
  type CustomerPlan,
  type CustomerRow,
  type DuplicatePolicy,
  type ItemPlan,
  type ItemRow,
} from '@/domain/nhap-file'
import { Button } from '@/ui/button'
import { SelectChip } from '@/ui/chip'
import { ScreenHeader } from '@/ui/screen-header'
import { useSubmitOnce } from '@/ui/use-submit-once'

type Kind = 'mon' | 'khach'

const FILE_ACCEPT = '.csv,text/csv,text/comma-separated-values,application/vnd.ms-excel,text/plain'

const message = (error: unknown) => (error instanceof Error ? error.message : 'Không đọc được file. Thử lại.')

async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

function ItemPreview({ plan, policy, onPolicy }: { plan: ItemPlan; policy: DuplicatePolicy | null; onPolicy: (p: DuplicatePolicy) => void }) {
  const writes = effectiveItemWrites(plan, policy ?? 'skip')
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px]">
        {plan.creates.length} món mới · {plan.duplicates.length} món trùng · {plan.errors.length} dòng lỗi
      </p>
      {writes.groupsToCreate.length > 0 ? (
        <p className="text-[13px] text-muted">{writes.groupsToCreate.length} nhóm mới: {writes.groupsToCreate.join(', ')}</p>
      ) : null}
      {plan.errors.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[13px] text-danger" role="alert">
          {plan.errors.map((err) => (
            <li key={err.line}>{err.message}</li>
          ))}
        </ul>
      ) : null}
      {plan.creates.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[13px]">
          {plan.creates.map((entry) => (
            <li key={entry.row.line}>
              {entry.row.name} · {entry.row.group || '(không nhóm)'} · {formatVnd(entry.row.unitPrice)}
            </li>
          ))}
        </ul>
      ) : null}
      {plan.duplicates.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[13px]">
          {plan.duplicates.map((entry) => (
            <li key={entry.row.line}>
              {entry.row.name}
              {entry.existing.isActive === 0 ? ' (đang ngừng bán)' : ''}
              {Object.keys(entry.changes).length > 0
                ? ` · ${Object.entries(entry.changes)
                    .map(([key, value]) => (key === 'unitPrice' || key === 'costPrice' ? formatVnd(value as number) : String(value)))
                    .join(', ')}`
                : ' · không đổi'}
            </li>
          ))}
        </ul>
      ) : null}
      {plan.duplicates.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto">
          <SelectChip selected={policy === 'skip'} onClick={() => onPolicy('skip')}>
            Bỏ qua tất cả món trùng
          </SelectChip>
          <SelectChip selected={policy === 'update'} onClick={() => onPolicy('update')}>
            Cập nhật tất cả món trùng
          </SelectChip>
        </div>
      ) : null}
    </div>
  )
}

function CustomerPreview({ plan, policy, onPolicy }: { plan: CustomerPlan; policy: DuplicatePolicy | null; onPolicy: (p: DuplicatePolicy) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px]">
        {plan.creates.length} khách mới · {plan.duplicates.length} khách trùng · {plan.errors.length} dòng lỗi
      </p>
      {plan.errors.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[13px] text-danger" role="alert">
          {plan.errors.map((err) => (
            <li key={err.line}>{err.message}</li>
          ))}
        </ul>
      ) : null}
      {plan.duplicates.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto">
          <SelectChip selected={policy === 'skip'} onClick={() => onPolicy('skip')}>
            Bỏ qua tất cả khách trùng
          </SelectChip>
          <SelectChip selected={policy === 'update'} onClick={() => onPolicy('update')}>
            Cập nhật tất cả khách trùng
          </SelectChip>
        </div>
      ) : null}
    </div>
  )
}

function resultLine(result: ImportResult): string {
  const parts = [
    `Đã thêm ${result.created}`,
    `cập nhật ${result.updated}`,
    `bỏ qua ${result.skipped}`,
    `không đổi ${result.unchanged}`,
  ]
  if (result.groupsCreated > 0) parts.push(`nhóm mới ${result.groupsCreated}`)
  let line = parts.join(' · ')
  if (result.queued) {
    line +=
      '. Đã ghi trên máy này, đang đưa lên sổ chung từng thay đổi. Món trùng tên với món máy khác vừa thêm sẽ được nối sang món đó. Nếu sổ chung từ chối một dòng vì lý do khác (ví dụ nhóm vừa bị máy khác xoá), các dòng trước đó vẫn giữ, từ dòng đó trở đi sẽ được hoàn lại và báo ở thanh trên cùng.'
  }
  if (result.duplicatesInactive > 0) {
    line += ` ${result.duplicatesInactive} món trùng đang ngừng bán — vào Mặt hàng bấm "Bán lại mặt hàng này" để đưa lên menu.`
  }
  return line
}

type PickedFile = { kind: Kind; rows: ItemRow[] | CustomerRow[]; itemPlan: ItemPlan | null; customerPlan: CustomerPlan | null }

function FilePreview({ picked }: { picked: PickedFile }) {
  const [policy, setPolicy] = useState<DuplicatePolicy | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const { submitting, error, run } = useSubmitOnce('Không nhập được. Thử lại.')

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[15px]">{resultLine(result)}</p>
      </div>
    )
  }

  const itemPlan = picked.itemPlan
  const customerPlan = picked.customerPlan
  const hasDuplicates = itemPlan ? itemPlan.duplicates.length > 0 : (customerPlan?.duplicates.length ?? 0) > 0
  const hasErrors = itemPlan ? itemPlan.errors.length > 0 : (customerPlan?.errors.length ?? 0) > 0
  // Có ít nhất một dòng hợp lệ trong file (mới hoặc trùng) — file hoàn toàn rỗng thì không có gì để bấm.
  const hasRows = itemPlan
    ? itemPlan.creates.length + itemPlan.duplicates.length > 0
    : (customerPlan?.creates.length ?? 0) + (customerPlan?.duplicates.length ?? 0) > 0
  const effectivePolicy = policy ?? 'skip'
  const count = itemPlan
    ? effectiveItemWrites(itemPlan, effectivePolicy).creates.length + effectiveItemWrites(itemPlan, effectivePolicy).updates.length
    : customerPlan
      ? effectiveCustomerWrites(customerPlan, effectivePolicy).creates.length +
        effectiveCustomerWrites(customerPlan, effectivePolicy).updates.length
      : 0
  const locked = submitting || hasErrors || (hasDuplicates && policy === null) || !hasRows

  const submit = () => {
    void run(async () => {
      if (itemPlan) {
        setResult(await applyItemImport(picked.rows as ItemRow[], effectivePolicy))
      } else {
        setResult(await applyCustomerImport(picked.rows as CustomerRow[], effectivePolicy))
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {itemPlan ? (
        <ItemPreview plan={itemPlan} policy={policy} onPolicy={setPolicy} />
      ) : customerPlan ? (
        <CustomerPreview plan={customerPlan} policy={policy} onPolicy={setPolicy} />
      ) : null}
      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button size="cta" disabled={locked} onClick={submit}>
        {submitting ? 'ĐANG NHẬP…' : `NHẬP ${count} ${picked.kind === 'mon' ? 'MÓN' : 'KHÁCH'}`}
      </Button>
    </div>
  )
}

export function NhapFilePage() {
  const [kind, setKind] = useState<Kind>('mon')
  const [picked, setPicked] = useState<PickedFile | null>(null)
  const [pickKey, setPickKey] = useState(0)
  const [fileError, setFileError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null)

  const changeKind = (next: Kind) => {
    setKind(next)
    setPicked(null)
    setFileError(null)
  }

  const downloadTemplate = async () => {
    setDownloading(true)
    setDownloadNotice(null)
    try {
      const template = kind === 'mon' ? ITEM_TEMPLATE : CUSTOMER_TEMPLATE
      const saved = await saveToDownloads({ filename: template.filename, mimeType: 'text/csv;charset=utf-8', text: template.text })
      setDownloadNotice(describeSavedFile(saved, 'file mẫu'))
    } catch (caught) {
      setDownloadNotice(message(caught))
    } finally {
      setDownloading(false)
    }
  }

  const pickFile = async (file: File) => {
    setFileError(null)
    setPicked(null)
    try {
      const bytes = await readFileBytes(file)
      const text = decodeCsvBytes(bytes)
      const records = parseCsv(text)
      if (kind === 'mon') {
        const { rows, errors } = readItemRows(records)
        const [items, groups] = await Promise.all([listItems(), listGroups()])
        const itemPlan = planItemImport(rows, items, groups)
        itemPlan.errors.push(...errors)
        setPicked({ kind, rows, itemPlan, customerPlan: null })
      } else {
        const { rows, errors } = readCustomerRows(records)
        const customers = await listCustomers()
        const customerPlan = planCustomerImport(rows, customers)
        customerPlan.errors.push(...errors)
        setPicked({ kind, rows, itemPlan: null, customerPlan })
      }
      setPickKey((key) => key + 1)
    } catch (caught) {
      setFileError(caught instanceof CsvFileError ? caught.message : message(caught))
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Nhập từ file" back="close" />
      <div className="flex flex-col gap-5 px-4 py-4">
        <div className="flex gap-2">
          <SelectChip selected={kind === 'mon'} onClick={() => changeKind('mon')}>
            Món
          </SelectChip>
          <SelectChip selected={kind === 'khach'} onClick={() => changeKind('khach')}>
            Khách
          </SelectChip>
        </div>

        <div className="text-[13px] text-muted">
          <p>
            Cột bắt buộc: {kind === 'mon' ? '"Tên món", "Giá bán"' : '"Tên"'}. Lưu từ Excel bằng{' '}
            <strong>CSV UTF-8</strong>. {kind === 'khach' ? 'Định dạng cột SĐT là Văn bản. ' : ''}
            Nhập là thêm/cập nhật, không xoá gì.
          </p>
        </div>

        <Button variant="secondary" disabled={downloading} onClick={() => void downloadTemplate()}>
          {downloading ? 'ĐANG TẢI…' : 'Tải file mẫu'}
        </Button>
        {downloadNotice ? <p className="text-[13px] text-muted">{downloadNotice}</p> : null}

        <div>
          <Button variant="secondary" onClick={() => document.getElementById('nhap-file-input')?.click()}>
            Chọn file CSV
          </Button>
          <input
            id="nhap-file-input"
            type="file"
            className="hidden"
            accept={FILE_ACCEPT}
            aria-label="Chọn file CSV"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void pickFile(file)
            }}
          />
        </div>

        {fileError ? (
          <p className="text-[13px] text-danger" role="alert">
            {fileError}
          </p>
        ) : null}

        {picked ? <FilePreview key={pickKey} picked={picked} /> : null}
      </div>
    </div>
  )
}
