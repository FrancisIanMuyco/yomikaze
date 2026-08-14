/** Probes MangaDex API shapes needed by the MangaDexProvider. */
const API = 'https://api.mangadex.org'

async function probe(name, url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', Origin: 'http://localhost:4173', ...(opts.headers ?? {}) },
    })
    const body = await res.text()
    const cors = res.headers.get('access-control-allow-origin')
    console.log(`\n### ${name} — HTTP ${res.status} | CORS: ${cors ?? 'none'}`)
    return { status: res.status, body: body.slice(0, 900) }
  } catch (e) {
    console.log(`\n### ${name} — NETWORK ERROR: ${e.message}`)
    return { status: -1, body: '' }
  }
}

const r1 = await probe('manga search (dragon)', `${API}/manga?title=dragon&limit=2&includes[]=cover_art&includes[]=author`)
console.log(r1.body)

const r2 = await probe('manga tags (genres)', `${API}/manga/tag?limit=5&includes[]=group`)
console.log(r2.body)

const r3 = await probe('popular sort', `${API}/manga?order[followedCount]=desc&limit=1`)
console.log(r3.body)

const r4 = await probe('latest sort', `${API}/manga?order[latestUploadedChapter]=desc&limit=1`)
console.log(r4.body)
