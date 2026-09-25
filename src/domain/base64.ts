/** Base64 cho mảng ~200KB: `String.fromCharCode(...bytes)` một phát sẽ tràn số đối số, nên đi theo khúc. */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0))
}
