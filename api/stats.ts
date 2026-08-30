// @ts-nocheck
// Vercel serverless function — live reader stats from Upstash Redis.
// Reads either UPSTASH_REST_URL/TOKEN or the Vercel-marketplace injected
// UPSTASH_REDIS_REST_URL/TOKEN (added automatically by the Upstash
// integration on Vercel).

const url = process.env.UPSTASH_REST_URL || process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN

function enabled() {
  return Boolean(url && token)
}

async function run(...cmds) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmds),
  })
  if (!res.ok) throw new Error(`upstash ${res.status}`)
  return res.json()
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Vary', 'Origin')

  if (!enabled()) {
    return res.status(200).json({ enabled: false })
  }

  try {
    const month = new Date().toISOString().slice(0, 7)
    const out = await run(['scan', '0', 'match', 'presence:*', 'count', '500'], ['get', `reads:${month}`])

    const [scan, counter] = Array.isArray(out) ? out : [out.result, out]
    const keys = scan?.result?.[1] ?? scan?.result ?? []
    const viewers = Array.isArray(keys) ? keys.length : 0
    const monthlyReadsRaw = counter?.result ?? counter ?? null
    const monthlyReads = Number(monthlyReadsRaw) || 0

    return res.status(200).json({ enabled: true, viewers, monthlyReads, month })
  } catch {
    return res.status(200).json({ enabled: false })
  }
}