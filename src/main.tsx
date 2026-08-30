import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from '@/App'
import '@/styles/index.css'

// The default theme is dark; the theme hook manages the class on <html>.
const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the PWA service worker ourselves with `updateViaCache: 'none'` so
// the browser never serves a stale `sw.js` from its HTTP cache after a deploy
// (the app's own HTTP cache was the reason users had to hard-refresh to pick
// up new versions). skipWaiting + clientsClaim are baked into the generated
// `sw.js` by vite-plugin-pwa (registerType: 'autoUpdate'), so the new version
// takes control and serves fresh assets on the very next navigation.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    })
  })
}
