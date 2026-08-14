const ENDPOINT = 'https://graphql.anilist.co'

const queries = {
  genres: `query { MediaGenreCollection }`,
  library: `
    query MediaPage($page: Int, $perPage: Int, $search: String, $sort: [MediaSort], $genre: String, $status: MediaStatus) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(type: MANGA, search: $search, sort: $sort, genre: $genre, status: $status) {
          id
          title { romaji english native }
          description(asHtml: false)
          coverImage { extraLarge large color }
          bannerImage
          genres
          tags { name }
          averageScore
          popularity
          status
          format
          countryOfOrigin
          startDate { year month day }
          endDate { year month day }
          chapters
          volumes
          trending
          updatedAt
          siteUrl
          staff(sort: RELEVANCE) { edges { role node { name { full } } } }
        }
      }
    }`,
  trending: null, // same query, different vars
}

const cases = [
  { name: 'genres', query: queries.genres, vars: {} },
  { name: 'library-popular', query: queries.library, vars: { page: 1, perPage: 30, sort: ['POPULARITY_DESC'] } },
  { name: 'library-trending', query: queries.library, vars: { page: 1, perPage: 12, sort: ['TRENDING_DESC'] } },
  { name: 'search', query: queries.library, vars: { page: 1, perPage: 24, search: 'dragon', sort: ['SEARCH_MATCH'] } },
]

for (const c of cases) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: c.query, variables: c.vars }),
    })
    const body = await res.text()
    console.log(`${c.name}: HTTP ${res.status} | ${body.slice(0, 220)}`)
  } catch (e) {
    console.log(`${c.name}: NETWORK ERROR ${e.message}`)
  }
}
