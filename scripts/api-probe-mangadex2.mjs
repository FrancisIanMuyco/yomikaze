const API = 'https://api.mangadex.org'

function buildUrl(path, params) {
  const url = new URL(`${API}${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(`${key}[]`, String(item))
    } else if (typeof value === 'object') {
      for (const [sub, v] of Object.entries(value)) {
        if (v === undefined || v === null) continue
        url.searchParams.append(`${key}[${sub}]`, String(v))
      }
    } else {
      url.searchParams.append(key, String(value))
    }
  }
  return url
}

// Solo Leveling (most-followed) — feed
const feedUrl = buildUrl('/manga/32d76d19-8a05-4db0-9fc2-e0b0648fe9d0/feed', {
  translatedLanguage: ['en'],
  'order[chapter]': 'asc',
  limit: 5,
  offset: 0,
})
console.log('FEED URL:', feedUrl.toString())
const feed = await (await fetch(feedUrl)).json()
console.log('total:', feed.total, '| first chapter:', JSON.stringify(feed.data?.[0]?.attributes ?? {}).slice(0, 200))
console.log('first id:', feed.data?.[0]?.id)

if (feed.data?.[0]?.id) {
  const atHome = await (await fetch(`${API}/at-home/server/${feed.data[0].id}`)).json()
  console.log('at-home baseUrl:', atHome.baseUrl)
  console.log('at-home hash:', atHome.chapter?.hash)
  console.log('at-home data[0]:', atHome.chapter?.data?.[0])
}
