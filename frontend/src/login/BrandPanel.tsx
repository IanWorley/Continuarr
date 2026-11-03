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
const POSTER_ROWS = 3

/** The Continuarr name, tagline, and a CSS-only backdrop of blurred posters and a sync motif. */
export function BrandPanel() {
  const tiles = Array.from({ length: POSTER_ROWS }, () => POSTER_TILES).flat()

  return (
    <section className="relative isolate flex flex-col justify-between overflow-hidden bg-ink-950 px-6 py-8 sm:px-10 lg:px-14 lg:py-14">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      >
        <div className="absolute -inset-1/4 grid -rotate-12 grid-cols-6 gap-4 opacity-60 blur-[2px]">
          {tiles.map((gradient, index) => (
            <div key={index} className={`aspect-[2/3] rounded-lg bg-gradient-to-br ${gradient}`} />
          ))}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,--theme(--color-accent/0.18),transparent_45%),radial-gradient(circle_at_80%_85%,--theme(--color-sync/0.22),transparent_50%)]"
      />

      <p className="text-2xl font-extrabold tracking-tight text-ink-100 lg:text-3xl">
        Continu<span className="text-accent">arr</span>
      </p>

      <div className="mt-6 max-w-md lg:mt-0">
        <h1 className="text-xl font-semibold leading-snug text-ink-100 sm:text-2xl lg:text-4xl">
          One watch history, kept in sync across Plex and Jellyfin.
        </h1>
        <SyncMotif />
      </div>
    </section>
  )
}

function SyncMotif() {
  return (
    <div aria-hidden="true" className="mt-6 hidden items-center gap-3 sm:flex lg:mt-10">
      <ServerChip name="Plex" dotClassName="bg-accent" />
      <div className="relative h-px flex-1 bg-gradient-to-r from-accent/70 to-sync/70">
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-100 shadow-[0_0_12px_--theme(--color-ink-100)] motion-safe:animate-sync-travel" />
      </div>
      <ServerChip name="Jellyfin" dotClassName="bg-sync" />
    </div>
  )
}

function ServerChip({ name, dotClassName }: { name: string; dotClassName: string }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/80 px-3 py-1.5 text-sm font-medium text-ink-100 backdrop-blur">
      <span className={`size-2 rounded-full ${dotClassName}`} />
      {name}
    </span>
  )
}
