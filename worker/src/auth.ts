const PAIR_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function generateToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export function generatePairSecret(length = 26): string {
  const result: string[] = []
  const ceiling = Math.floor(256 / PAIR_ALPHABET.length) * PAIR_ALPHABET.length

  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length - result.length))
    for (const byte of bytes) {
      if (byte >= ceiling) continue
      result.push(PAIR_ALPHABET[byte % PAIR_ALPHABET.length]!)
    }
  }

  return result.join('')
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function secretsEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([hashSecret(left), hashSecret(right)])
  let difference = leftHash.length ^ rightHash.length
  for (let index = 0; index < Math.max(leftHash.length, rightHash.length); index += 1) {
    difference |= (leftHash.charCodeAt(index) || 0) ^ (rightHash.charCodeAt(index) || 0)
  }
  return difference === 0
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const token = authorization.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

export function routedPairCode(shopId: string, secret: string): string {
  return `${shopId}.${secret}`
}

export function parseRoutedPairCode(code: string): { shopId: string; secret: string } | null {
  const separator = code.indexOf('.')
  if (separator <= 0 || separator === code.length - 1) return null

  const shopId = code.slice(0, separator)
  const secret = code.slice(separator + 1).trim().toUpperCase()
  if (!/^[0-9a-f-]{36}$/i.test(shopId) || !/^[23456789A-HJ-NP-Z]{26}$/.test(secret)) return null
  return { shopId, secret }
}
