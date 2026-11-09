import type { LinkProps } from '@tanstack/react-router'

export type SettingsPath = Extract<LinkProps['to'], `/settings/${string}`>

export interface SettingsSection {
  name: string
  description: string
  /** Absent until the section's page is built, so the hub can list what's planned. */
  to?: SettingsPath
}

export type BuiltSettingsSection = SettingsSection & { to: SettingsPath }

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    name: 'Jellyfin',
    description: 'The server URL and API key Continuarr reads accounts and libraries with.',
    to: '/settings/jellyfin',
  },
  {
    name: 'Plex',
    description: 'Sign in to Plex and read every Plex Home user, including PIN-protected ones.',
  },
  {
    name: 'Sync',
    description: 'Choose whether Continuarr only records history, plans writes, or performs them.',
  },
]

export function isBuilt(section: SettingsSection): section is BuiltSettingsSection {
  return section.to !== undefined
}
