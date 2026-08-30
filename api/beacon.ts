// @ts-nocheck
// Vercel serverless function — anonymous presence beacon.
// `view` ⇒ refresh `presence:<id>` (TTL 120s, heartbeat every 45s).
// `read` ⇒ same presence ping + INCR this month's reads counter.
// Reads either UPSTASH_REST_URL/TOKEN or the Vercel-marketplace injected
// UPSTASH_REDIS_REST_URL/TOKEN (Upstash integration).

const url =
  process.env.UPSTASH_REST_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const token =
  process.env.UPSTASH_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN

function enabled() {
  return Boolean(url && token)
}

async function run(...cmds) {
  const res = await fetch(`${url}/pipeline`, {
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
    return res.status(200).json({ ok: false })
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false })
  }

  const { kind, clientId } = req.body || {}
  if (!clientId || (kind !== 'view' && kind !== 'read')) {
    return res.status(400).json({ ok: false })
  }

  try {
    const cmds = [['set', `presence:${clientId}`, '1', 'EX', '120']]
    if (kind === 'read') {
      const month = new Date().toISOString().slice(0, 7)
      cmds.push(['incr', `reads:${month}`])
      cmds.push(['expire', `reads:${month}`, '90'])
    }
    await run(...cmds)
    return res.status(200).json({ ok: true })
  } catch {
    return res.status(200).json({ ok: false })
  }
}