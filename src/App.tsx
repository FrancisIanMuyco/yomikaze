import { BrowserRouter, Route, Routes } from 'react-router-dom'

// Vite `base` (e.g. '/yomikaze/' on GitHub Pages) must be the router basename
// so client-side links and deep links resolve under the sub-path. In dev the
// base is '/' so nothing changes.
const basename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'

import { MainLayout } from '@/components/layout/MainLayout'
import { ScrollToTop } from '@/components/layout/ScrollToTop'
import { FavoritesPage } from '@/pages/FavoritesPage'
import { GenresPage } from '@/pages/GenresPage'
import { HistoryPage } from '@/pages/HistoryPage'
import { HomePage } from '@/pages/HomePage'
import { LibraryPage } from '@/pages/LibraryPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ReaderPage } from '@/pages/ReaderPage'
import { SearchPage } from '@/pages/SearchPage'
import { TitleDetailsPage } from '@/pages/TitleDetailsPage'

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <ScrollToTop />
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/manga" element={<LibraryPage kind="MANGA" />} />
          <Route path="/manhua" element={<LibraryPage kind="MANHUA" />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/genres" element={<GenresPage />} />
          <Route path="/title/:id" element={<TitleDetailsPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        {/* Immersive, chrome-free reader */}
        <Route path="/reader/:titleId/:chapterId" element={<ReaderPage />} />
      </Routes>
    </BrowserRouter>
  )
}
