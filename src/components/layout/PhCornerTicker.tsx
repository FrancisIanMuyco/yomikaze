const MESSAGE = 'PLEASE LIKE NYO POST THREAD KO SA PH CORNER THANKYOU <3'
const REPEATS = 8

export function PhCornerTicker() {
  return (
    <>
      <p className="sr-only">{MESSAGE}</p>
      <div
        aria-hidden="true"
        className="overflow-hidden border-b border-black/10 bg-flame-600 py-1.5 dark:border-white/10"
      >
        <div className="marquee-track flex w-max items-center">
          {Array.from({ length: REPEATS }).map((_, i) => (
            <span
              key={i}
              className="inline-flex items-center whitespace-nowrap text-xs font-bold tracking-wide text-white"
            >
              <span className="px-6">{MESSAGE}</span>
              <span aria-hidden="true" className="text-white/60">
                ●
              </span>
            </span>
          ))}
        </div>
      </div>
    </>
  )
}