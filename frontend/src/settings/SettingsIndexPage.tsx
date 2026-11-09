import { Link } from '@tanstack/react-router'
import { HEADING_CLASSES } from '../forms/formParts.tsx'
import { isBuilt, SETTINGS_SECTIONS, type SettingsSection } from './settingsSections.ts'

const CARD_CLASSES = 'relative rounded-lg border border-ink-700 bg-ink-950 px-5 py-4'

export function SettingsIndexPage() {
  return (
    <div className="px-8 py-8">
      <h1 className={HEADING_CLASSES}>Settings</h1>
      <ul className="mt-6 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_SECTIONS.map((section) => (
          <SectionCard key={section.name} section={section} />
        ))}
      </ul>
    </div>
  )
}

function SectionCard({ section }: { section: SettingsSection }) {
  if (!isBuilt(section)) {
    return (
      <li className={`${CARD_CLASSES} opacity-60`}>
        <h2 className="flex items-center gap-2 font-semibold">
          {section.name}
          <span className="rounded-sm border border-ink-500 px-1.5 text-xs font-normal text-ink-400">Coming soon</span>
        </h2>
        <p className="mt-1 text-sm text-ink-400">{section.description}</p>
      </li>
    )
  }

  // The link's ::after covers the card, so the whole card is clickable while the link's name stays
  // just the section name.
  return (
    <li className={`${CARD_CLASSES} transition focus-within:outline-2 focus-within:outline-accent hover:border-accent`}>
      <h2 className="font-semibold">
        <Link to={section.to} className="after:absolute after:inset-0 focus-visible:outline-none">
          {section.name}
        </Link>
      </h2>
      <p className="mt-1 text-sm text-ink-400">{section.description}</p>
    </li>
  )
}
