const API = 'https://api.mangadex.org'

async function feedStats(mangaId) {
  const res = await fetch(
    `${API}/manga/${mangaId}/feed?translatedLanguage[]=en&limit=100&offset=0`,
    { headers: { Accept: 'application/json' } },
  )
  const j = await res.json()
  const items = j.data ?? []
  const hosted = items.filter((c) => !c.attributes.externalUrl && (c.attributes.pages ?? 0) > 0)
  return { total: j.total ?? 0, hosted: hosted.length, sample: hosted.slice(0, 3).map((c) => c.id) }
}

for (const q of ['one piece', 'chainsaw man', 'jujutsu kaisen', 'solo leveling', 'naruto', 'berserk']) {
  const s = await fetch(`${API}/manga?title=${encodeURIComponent(q)}&limit=3`, { headers: { Accept: 'application/json' } })
  const j = await s.json()
  const top = j.data?.[0]
  if (!top) {
    console.log(`${q}: no results`)
    continue
  }
  const title = Object.values(top.attributes.title ?? {})[0]
  const stats = await feedStats(top.id)
  console.log(`${q} → ${title} (${top.id.slice(0, 8)}): total=${stats.total} hosted=${stats.hosted} sample=${stats.sample[0]?.slice(0, 8) ?? 'none'}`)
}
