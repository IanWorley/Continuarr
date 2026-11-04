// Poster-like tiles for the backdrop: abstract gradients, no artwork. Listed in full so
// Tailwind can see every class.
const POSTER_TILES: readonly string[] = [
  'from-amber-500/50 to-rose-800/40',
  'from-sky-500/40 to-indigo-900/50',
  'from-violet-500/50 to-fuchsia-900/40',
  'from-emerald-500/30 to-teal-900/50',
  'from-rose-500/40 to-orange-900/40',
  'from-indigo-500/40 to-slate-900/60',
  'from-orange-400/40 to-amber-900/50',
  'from-cyan-500/30 to-blue-900/50',
  'from-fuchsia-500/40 to-violet-950/50',
  'from-slate-400/30 to-slate-800/60',
  'from-yellow-500/40 to-red-900/40',
  'from-purple-500/40 to-indigo-950/60',
]
// Repeats of the list; with grid-cols-6 each repeat fills two rows of the tilted grid.
const POSTER_REPEATS = 3

/** The Continuarr name over a CSS-only backdrop of blurred posters. */
export function BrandPanel() {
  const tiles = Array.from({ length: POSTER_REPEATS }, () => POSTER_TILES).flat()

  return (
    <section className="relative isolate h-40 overflow-hidden bg-ink-950 px-6 py-8 sm:px-10 lg:h-auto lg:px-14 lg:py-14">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 poster-fade"
      >
        <div className="absolute -inset-1/4 grid -rotate-12 grid-cols-6 gap-4 opacity-60 blur-xs">
          {tiles.map((gradient, index) => (
            <div key={index} className={`aspect-2/3 rounded-lg bg-linear-to-br ${gradient}`} />
          ))}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 brand-glow"
      />

      <p className="text-2xl font-extrabold tracking-tight text-ink-100 lg:text-3xl">
        Continu<span className="text-accent">arr</span>
      </p>
    </section>
  )
}
