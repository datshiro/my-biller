// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissTopOverlay } from '@/ui/back-dismiss'
import { PaymentSheet } from '../payment-sheet'

afterEach(cleanup)

function renderPaymentSheet({ submitting, onClose }: { submitting: boolean; onClose: () => void }) {
  return render(
    <PaymentSheet
      lines={[]}
      count={0}
      customerName="Khách lẻ"
      subtotal={55_000}
      discount={0}
      surcharge={0}
      total={55_000}
      hasCustomer={false}
      method="cash"
      given={55_000}
      onMethodChange={() => {}}
      onGivenChange={() => {}}
      onConfirm={() => {}}
      onPickCustomer={() => {}}
      onEditOrder={() => {}}
      onClose={onClose}
      submitting={submitting}
      error={null}
    />,
  )
}

describe('Back khi Thu tiền', () => {
  it('đang lưu thì Back bị nuốt và sheet không đóng', () => {
    const onClose = vi.fn()
    renderPaymentSheet({ submitting: true, onClose })

    expect(dismissTopOverlay()).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('chưa lưu thì Back đóng sheet', () => {
    const onClose = vi.fn()
    renderPaymentSheet({ submitting: false, onClose })

    expect(dismissTopOverlay()).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
