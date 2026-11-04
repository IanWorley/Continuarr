import type { ReactNode } from 'react'
import { BrandPanel } from './BrandPanel.tsx'

/** The signed-out pages' frame: the brand panel beside, or above, a single form. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen grid-rows-[auto_1fr] bg-ink-900 lg:grid-cols-2 lg:grid-rows-1">
      <BrandPanel />
      <div className="flex items-start justify-center px-6 py-10 sm:px-10 lg:items-center">{children}</div>
    </main>
  )
}
