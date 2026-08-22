import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Thin flame-gradient bar sa taas nga screen nga mo-flash matag route
 * navigation — instant visual feedback nga "nag-transition ang page".
 * Pure CSS animation; walay JS work pag-human sa timeout.
 */
export function TopProgressBar() {
  const { pathname } = useLocation()
  const [active, setActive] = useState(false)

  useEffect(() => {
    setActive(true)
    const t = setTimeout(() => setActive(false), 700)
    return () => clearTimeout(t)
  }, [pathname])

  if (!active) return null
  return <div key={pathname} className="topbar-progress" aria-hidden="true" />
}
