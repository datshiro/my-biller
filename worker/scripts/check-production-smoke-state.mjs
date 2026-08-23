import { env } from 'node:process'

const defaultWorkerUrl = 'https://my-biller-sync.datshiro.workers.dev'
const { SHOP_ID: rawShopId, DEVICE_TOKEN: rawDeviceToken, WORKER_URL: rawWorkerUrl } = env

const shopId = rawShopId?.trim()
const deviceToken = rawDeviceToken?.trim()

if (!shopId || !deviceToken) {
  console.log('credentials-missing')
  process.exitCode = 2
} else {
  await checkSmokeState(shopId, deviceToken)
}

async function checkSmokeState(currentShopId, currentDeviceToken) {
  let workerUrl
  try {
    workerUrl = new URL(rawWorkerUrl?.trim() || defaultWorkerUrl)
    if (workerUrl.protocol !== 'https:') throw new Error('HTTPS required')
  } catch {
    console.log('check-network-failed')
    process.exitCode = 1
    return
  }

  const oplogUrl = new URL(
    `/shop/${encodeURIComponent(currentShopId)}/oplog?since=0`,
    workerUrl,
  )

  let response
  try {
    response = await fetch(oplogUrl, {
      headers: { authorization: `Bearer ${currentDeviceToken}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    console.log('check-network-failed')
    process.exitCode = 1
    return
  }

  if (response.status === 200) {
    console.log('provisioned')
    return
  }

  if (response.status === 401) {
    console.log('needs-activation')
    process.exitCode = 2
    return
  }

  console.log(`unexpected-http-${response.status}`)
  process.exitCode = 1
}
