import { Link } from 'react-router-dom'
import { useState } from 'react'
import { ArrowRight, BookOpen, Loader2, Terminal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function ScrapePage() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return

    setStatus('loading')
    setMessage('Scraping chapter... this may take a moment.')

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      setStatus('success')
      setMessage(`Scraped ${data.chapters?.[0]?.pages?.length ?? 0} pages. Redirecting to reader...`)

      const seriesId = data.series_id || `scraped-${encodeURIComponent(data.title)}`
      const chapterId = data.chapters?.[0]?.chapter_id || `${seriesId}-1`

      setTimeout(() => {
        navigate(`/reader/${seriesId}/${chapterId}`)
      }, 1200)
    } catch (err) {
      setStatus('error')
      setMessage(String(err))
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#050508] px-6 py-12 text-center">
      <div className="mx-auto max-w-lg space-y-8">
        <div className="flex justify-center">
          <div className="rounded-full border border-white/10 bg-white/5 p-4">
            <BookOpen className="h-8 w-8 text-flame-400" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold text-white">Scrape a Chapter</h1>
          <p className="text-sm text-zinc-400">
            Paste any manhua / manga chapter URL below. YOMIKAZE will extract the real page images
            and open them in the reader.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="url"
            required
            placeholder="https://example.com/manga/my-series/chapter/1"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-zinc-500 outline-none transition-colors focus:border-flame-500/60 focus:bg-white/10"
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-flame-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-flame-500 disabled:opacity-50"
          >
            {status === 'loading' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Scraping...
              </>
            ) : (
              <>
                <ArrowRight className="h-4 w-4" />
                Scrape & Read
              </>
            )}
          </button>
        </form>

        {message && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs ${
              status === 'error'
                ? 'border-red-500/30 bg-red-500/10 text-red-300'
                : status === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-white/10 bg-white/5 text-zinc-300'
            }`}
          >
            {message}
          </div>
        )}

        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-left">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            <Terminal className="h-3.5 w-3.5" />
            CLI alternative
          </div>
          <p className="mb-2 text-xs text-zinc-400">
            If the dev server middleware is unavailable, run the scraper directly:
          </p>
          <code className="block rounded-lg bg-black/40 p-3 text-xs text-zinc-300">
            python scraper/scrape_to_yomikaze.py "https://example.com/chapter/1"
            <br />
            <span className="text-zinc-500"># then open http://localhost:5173</span>
          </code>
        </div>

        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ArrowRight className="h-3 w-3 rotate-180" />
          Back home
        </Link>
      </div>
    </div>
  )
}
