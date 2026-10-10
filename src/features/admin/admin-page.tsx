import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router'
import type { AdminShopsPage } from '@shared/admin-contract'
import { Button } from '@/ui/button'
import { TextField } from '@/ui/text-field'
import { createAdminClient, type AdminClient } from './admin-client'
import { LAG_NOTE, errorText } from './admin-format'
import { ShopBlock, type ShopEntry } from './admin-shop-block'
import { ShopDetailScreen } from './admin-shop-detail'
import { UnpairedScreen } from './admin-unpaired'

type ShopList = { shops: ShopEntry[]; next: string | null }

/** Secret chỉ sống trong closure của client nằm ở state này: tải lại trang hay bấm Thoát là phải nhập lại. */
type Session = { client: AdminClient }

function appendShops(prev: ShopEntry[], page: AdminShopsPage): ShopEntry[] {
  const seen = new Set(prev.map((shop) => shop.shopId))
  return [...prev, ...page.shops.filter((shop) => !seen.has(shop.shopId))]
}

export default function AdminPage() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [session, setSession] = useState<Session | null>(null)
  const [shopList, setShopList] = useState<ShopList | null>(null)
  const [input, setInput] = useState('')
  const [gateError, setGateError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const signOut = useCallback(() => {
    setSession(null)
    setShopList(null)
  }, [])

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    if (!input || busy) return
    setBusy(true)
    setGateError(null)
    const client = createAdminClient(input, signOut)
    try {
      const first = await client.loadShops()
      setShopList({ shops: first.shops, next: first.next })
      setSession({ client })
      setInput('')
    } catch (caught) {
      setGateError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!session) {
    return (
      <form onSubmit={(event) => void signIn(event)} className="mx-auto flex max-w-sm flex-col gap-3 px-4 py-8">
        <h1 className="text-[20px] font-bold">Khu admin</h1>
        <TextField
          label="Mật khẩu xem"
          type="password"
          autoComplete="off"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          error={gateError ?? undefined}
        />
        <Button type="submit" disabled={busy}>
          Vào
        </Button>
      </form>
    )
  }

  const detail = matchPath('/admin/so/:shopId', pathname)
  const unpaired = matchPath('/admin/may-chua-ghep', pathname)

  return (
    <div className="mx-auto min-h-full max-w-3xl pb-8">
      <nav className="flex gap-2 border-b border-line px-4 py-3">
        <Button
          variant="secondary"
          onClick={() => {
            setShopList(null)
            void navigate('/admin')
          }}
        >
          Các sổ
        </Button>
        <Button variant="secondary" onClick={() => void navigate('/admin/may-chua-ghep')}>
          Máy chưa ghép
        </Button>
        <Button variant="ghost" className="ml-auto" onClick={signOut}>
          Thoát
        </Button>
      </nav>
      {detail?.params.shopId ? (
        <ShopDetailScreen key={detail.params.shopId} client={session.client} shopId={detail.params.shopId} />
      ) : unpaired ? (
        <UnpairedScreen client={session.client} />
      ) : (
        <ShopListScreen client={session.client} list={shopList} onChange={setShopList} />
      )}
    </div>
  )
}

function ShopListScreen({
  client,
  list,
  onChange,
}: {
  client: AdminClient
  list: ShopList | null
  onChange: (update: (prev: ShopList | null) => ShopList | null) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (list) return
    let live = true
    client.loadShops().then(
      (page) => live && onChange(() => ({ shops: page.shops, next: page.next })),
      (caught: unknown) => live && setError(errorText(caught)),
    )
    return () => {
      live = false
    }
  }, [client, list, onChange])

  const loadMore = async () => {
    if (!list?.next) return
    setBusy(true)
    setError(null)
    try {
      const page = await client.loadShops(list.next)
      onChange((prev) => (prev ? { shops: appendShops(prev.shops, page), next: page.next } : prev))
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="px-4 pt-4 text-[20px] font-bold">Các sổ</h1>
      <p className="px-4 text-[13px] text-muted">{LAG_NOTE}</p>
      {error ? (
        <p role="alert" className="px-4 pt-2 text-[13px] font-semibold text-danger">
          {error}
        </p>
      ) : null}
      {list?.shops.map((shop) => <ShopBlock key={shop.shopId} shop={shop} />)}
      {list?.next ? (
        <div className="px-4 pt-3">
          <Button variant="secondary" disabled={busy} onClick={() => void loadMore()}>
            Tải thêm
          </Button>
        </div>
      ) : null}
    </div>
  )
}
