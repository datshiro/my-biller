/**
 * Node 25 tự đặt sẵn một `localStorage` toàn cục rỗng (không có getItem/setItem) và nó che mất
 * bản thật của jsdom, nên test nào chạm localStorage cũng nổ. Đây là quirk của Node, không phải
 * của app — trình duyệt thật vẫn có Storage đầy đủ. Dựng lại một Storage trong bộ nhớ cho đúng.
 */
function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  }
}

if (typeof globalThis.localStorage?.setItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  })
}
