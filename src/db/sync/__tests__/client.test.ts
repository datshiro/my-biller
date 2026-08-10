import { describe, expect, it } from 'vitest'
import { resolveDefaultSyncUrl } from '../client'

describe('resolveDefaultSyncUrl', () => {
  it.each(['localhost', '127.0.0.1'])('giữ Worker cục bộ khi chạy app ở %s', (hostname) => {
    expect(resolveDefaultSyncUrl(hostname, 'https://staging.example')).toBe('http://127.0.0.1:8787')
  })

  it('bản staging dùng Worker và Durable Object tách khỏi production', () => {
    expect(
      resolveDefaultSyncUrl(
        'release-staging-260811.an-quynh.pages.dev',
        'https://my-biller-sync-staging.datshiro.workers.dev',
      ),
    ).toBe('https://my-biller-sync-staging.datshiro.workers.dev')
  })

  it('bản production giữ URL Worker production được đóng vào lúc build', () => {
    expect(
      resolveDefaultSyncUrl(
        'an-quynh.pages.dev',
        'https://my-biller-sync.datshiro.workers.dev',
      ),
    ).toBe(
      'https://my-biller-sync.datshiro.workers.dev',
    )
  })
})
