import {
  BookOpen,
  Compass,
  Heart,
  History,
  Home,
  LayoutGrid,
  Menu,
  Moon,
  Search,
  Sun,
  X,
  Download,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { cn } from '@/lib/utils'
import type { Theme } from '@/hooks/useTheme'

function Logo() {
  return (
    <Link to="/" className="group flex items-baseline gap-1.5" aria-label="YOMIKAZE home">
      <span className="font-display text-xl font-black tracking-tight text-zinc-900 dark:text-white">
        YOMI<span className="text-flame-500 transition-colors group-hover:text-flame-400">KAZE</span>
      </span>
      <span className="hidden text-[11px] font-medium tracking-[0.25em] text-zinc-500 sm:inline">読</span>
    </Link>
  )
}

const desktopLinks = [
  { to: '/', label: 'Home' },
  { to: '/manga', label: 'Manga' },
  { to: '/manhua', label: 'Manhua' },
  { to: '/genres', label: 'Genres' },
  { to: '/favorites', label: 'Favorites' },
  { to: '/history', label: 'History' },
  { to: '/scrape', label: 'Scrape' },
]

function DesktopNav() {
  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
      {desktopLinks.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.to === '/'}
          className={({ isActive }) =>
            cn(
              'relative rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
              isActive
                ? 'text-flame-500 dark:text-flame-400'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white',
            )
          }
        >
          {({ isActive }) => (
            <>
              {link.label}
              {isActive ? (
                <span className="absolute inset-x-3 -bottom-0.5 h-0.5 rounded-full bg-flame-500" aria-hidden="true" />
              ) : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

const bottomTabs = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/manga', label: 'Manga', icon: BookOpen },
  { to: '/manhua', label: 'Manhua', icon: Compass },
  { to: '/favorites', label: 'Shelf', icon: Heart },
  { to: '/scrape', label: 'Scrape', icon: Download },
]

export function Navbar({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname, location.search])

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
    setQuery('')
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-black/5 glass-subtle dark:border-white/5">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Logo />
            <DesktopNav />
          </div>

          <div className="flex items-center gap-2">
            {/* Desktop search */}
            <form onSubmit={submitSearch} role="search" className="hidden md:block">
              <label className="sr-only" htmlFor="nav-search">
                Search titles
              </label>
              <div className="relative group">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-flame-400" />
                <input
                  id="nav-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search manga & manhua…"
                  className="w-52 rounded-full border border-black/10 bg-black/[0.03] py-2 pl-9 pr-4 text-sm text-zinc-900 outline-none transition-all duration-200 placeholder:text-zinc-400 focus:w-64 focus:border-flame-500/50 focus:bg-white focus:shadow-lg focus:shadow-flame-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:bg-night-800"
                />
              </div>
            </form>

            {/* Mobile search */}
            <button
              type="button"
              onClick={() => navigate('/search')}
              className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-black/5 hover:text-zinc-900 md:hidden dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg p-2 text-zinc-600 transition-colors hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden dark:border-white/10 dark:bg-night-900/95"
        aria-label="Mobile"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {bottomTabs.map((tab) => {
            const Icon = tab.icon
            const isActive =
              tab.to === '/' ? location.pathname === '/' : location.pathname.startsWith(tab.to)
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === '/'}
                className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold"
              >
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    isActive ? 'bg-flame-500/15 text-flame-500 dark:text-flame-400' : 'text-zinc-500',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className={isActive ? 'text-flame-500 dark:text-flame-400' : 'text-zinc-500'}>{tab.label}</span>
              </NavLink>
            )
          })}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-zinc-500"
            aria-label="Open more menu"
          >
            <span className="flex h-7 w-12 items-center justify-center rounded-full">
              <Menu className="h-5 w-5" />
            </span>
            <span>Menu</span>
          </button>
        </div>
      </nav>

      {/* More menu sheet */}
      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More menu">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-black/10 bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] dark:border-white/10 dark:bg-night-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-zinc-900 dark:text-white">Menu</h2>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="rounded-lg p-2 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { to: '/genres', label: 'Genres', icon: LayoutGrid },
                { to: '/history', label: 'History', icon: History },
                { to: '/search', label: 'Search', icon: Search },
                { to: '/favorites', label: 'Favorites', icon: Heart },
                { to: '/scrape', label: 'Scrape URL', icon: Download },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-3 rounded-xl border border-black/5 bg-black/[0.03] px-4 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:border-flame-500/40 hover:text-flame-500 dark:border-white/5 dark:bg-white/5 dark:text-zinc-300 dark:hover:text-flame-400"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                )
              })}
              <button
                type="button"
                onClick={toggleTheme}
                className="flex items-center gap-3 rounded-xl border border-black/5 bg-black/[0.03] px-4 py-3 text-sm font-semibold text-zinc-700 transition-colors hover:border-flame-500/40 hover:text-flame-500 dark:border-white/5 dark:bg-white/5 dark:text-zinc-300 dark:hover:text-flame-400"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
