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
  TrendingUp,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { NavSearchAutocomplete } from '@/components/search/NavSearchAutocomplete'
import { PresenceBadge } from '@/components/layout/PresenceBadge'
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
  { to: '/stats', label: 'Stats' },
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
]

export function Navbar({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    setMenuOpen(false)
    setSearchOpen(false)
  }, [location.pathname, location.search])

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-black/5 glass-subtle dark:border-white/5">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Logo />
            <DesktopNav />
          </div>

          <div className="flex items-center gap-2">
            {/* Live readers pill (updates every ~60s) */}
            <PresenceBadge />

            {/* Desktop search — live autocomplete dropdown */}
            <NavSearchAutocomplete className="hidden md:block" />

            {/* Mobile search — expands a full-width autocomplete overlay */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
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

      {/* Mobile search overlay — full-width autocomplete */}
      {searchOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Search">
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="Close search"
          />
          <div className="relative mx-auto mt-4 w-[calc(100%-2rem)]">
            <NavSearchAutocomplete fullWidth autoFocus onDone={() => setSearchOpen(false)} />
          </div>
        </div>
      ) : null}

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
                { to: '/stats', label: 'Stats', icon: TrendingUp },
                { to: '/search', label: 'Search', icon: Search },
                { to: '/favorites', label: 'Favorites', icon: Heart },
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
