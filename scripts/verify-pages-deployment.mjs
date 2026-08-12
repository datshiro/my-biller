import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { chromium } from '@playwright/test'

const baseUrl = requiredUrl('BASE_URL')
const artifactDir = resolve(requiredValue('ARTIFACT_DIR'))
const expectedMode = process.argv[2] === 'recovery' ? 'recovery' : 'normal'
const expectedTitle = expectedMode === 'recovery'
  ? 'my-biller — Phục hồi chỉ đọc'
  : 'my-biller — Bán hàng'
const propagationAttempts = 12
const propagationDelayMs = 5_000

function requiredValue(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Thiếu biến ${name}.`)
  return value
}

function requiredUrl(name) {
  const url = new URL(requiredValue(name))
  if (url.protocol !== 'https:') throw new Error(`${name} phải dùng HTTPS.`)
  return url.toString().replace(/\/$/, '')
}

async function remote(path) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`${path} trả HTTP ${response.status}.`)
  return response
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function artifactFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? artifactFiles(path) : [path]
  }))
  return files.flat()
}

async function verifyArtifactBytes() {
  const files = await artifactFiles(artifactDir)
  for (const localPath of files) {
    const relativePath = relative(artifactDir, localPath).split(sep).join('/')
    if (relativePath === '_redirects') continue
    const remotePath = relativePath === 'index.html' ? '/' : `/${relativePath}`
    const [local, response] = await Promise.all([
      readFile(localPath),
      remote(remotePath),
    ])
    const deployed = Buffer.from(await response.arrayBuffer())
    if (digest(local) !== digest(deployed)) {
      throw new Error(`File ${relativePath} khác artifact CI.`)
    }
  }
}

async function verifyHttp() {
  const [indexResponse, deepRoute, manifest, serviceWorker] = await Promise.all([
    remote('/'),
    remote('/bao-cao'),
    remote('/manifest.webmanifest'),
    remote('/sw.js'),
  ])
  const indexHtml = await indexResponse.text()
  if (!indexHtml.includes(`<title>${expectedTitle}</title>`)) {
    throw new Error(`index.html không có title của mode ${expectedMode}.`)
  }
  const deepRouteHtml = await deepRoute.text()
  if (digest(indexHtml) !== digest(deepRouteHtml)) {
    throw new Error('Deep route không trả đúng bytes của index.html trong artifact.')
  }
  const manifestBody = await manifest.json().catch(() => null)
  if (typeof manifestBody?.name !== 'string') throw new Error('Manifest không hợp lệ.')
  if ((await serviceWorker.text()).length < 100) throw new Error('Service worker rỗng hoặc không hợp lệ.')
  await verifyArtifactBytes()
}

async function waitForDeploymentPropagation() {
  let lastError
  for (let attempt = 1; attempt <= propagationAttempts; attempt += 1) {
    try {
      await verifyHttp()
      return
    } catch (error) {
      lastError = error
      if (attempt === propagationAttempts) break
      await new Promise((resolveDelay) => setTimeout(resolveDelay, propagationDelayMs))
    }
  }
  throw new Error(
    `Deployment chưa phát đúng artifact sau ${propagationAttempts} lần kiểm.`,
    { cause: lastError },
  )
}

async function verifyColdOffline() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(`${baseUrl}/bao-cao`, { waitUntil: 'networkidle' })
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload({ waitUntil: 'networkidle' })
    const controller = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)
    if (!controller?.endsWith('/sw.js')) throw new Error('Service worker chưa điều khiển trang.')
    if ((await page.title()) !== expectedTitle) throw new Error('Browser title không đúng artifact.')
    if (expectedMode === 'recovery') {
      await page.getByText('CHẾ ĐỘ PHỤC HỒI — KHÔNG BÁN HÀNG').waitFor()
    } else {
      await page.getByRole('heading', { name: 'Báo cáo' }).waitFor()
    }
    await context.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    if ((await page.title()) !== expectedTitle) throw new Error('Artifact không mở lại được khi offline.')
  } finally {
    await context.setOffline(false)
    await browser.close()
  }
}

await waitForDeploymentPropagation()
await verifyColdOffline()
console.log(`Pages ${expectedMode} smoke passed at ${baseUrl}.`)
