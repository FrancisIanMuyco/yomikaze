import { useLocation } from 'react-router-dom'
import { Outlet } from 'react-router-dom'

import { Footer } from '@/components/layout/Footer'
import { Navbar } from '@/components/layout/Navbar'
import { ScrollToTop } from '@/components/layout/ScrollToTop'
import { useTheme } from '@/hooks/useTheme'

export function MainLayout() {
  const { theme, toggleTheme } = useTheme()
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen bg-paper-50 text-zinc-900 transition-colors duration-300 dark:bg-night-950 dark:text-zinc-100">
      <ScrollToTop />
      <Navbar theme={theme} toggleTheme={toggleTheme} />
      <main
        key={pathname}
        className="page-enter mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pb-12"
      >
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
