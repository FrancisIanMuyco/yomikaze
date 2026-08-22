import { useLocation } from 'react-router-dom'
import { Outlet } from 'react-router-dom'

import { Footer } from '@/components/layout/Footer'
import { Navbar } from '@/components/layout/Navbar'
import { ScrollToTop } from '@/components/layout/ScrollToTop'
import { TopProgressBar } from '@/components/layout/TopProgressBar'
import { useTheme } from '@/hooks/useTheme'

export function MainLayout() {
  const { theme, toggleTheme } = useTheme()
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen bg-paper-50 text-zinc-900 transition-colors duration-300 dark:bg-night-950 dark:text-zinc-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-flame-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <ScrollToTop />
      <TopProgressBar />
      <Navbar theme={theme} toggleTheme={toggleTheme} />
      <main
        id="main-content"
        key={pathname}
        tabIndex={-1}
        className="page-enter mx-auto w-full max-w-7xl scroll-mt-24 px-4 pb-16 pt-6 focus:outline-none sm:px-6 lg:px-8 lg:pb-12"
      >
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
