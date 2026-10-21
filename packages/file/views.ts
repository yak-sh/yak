/**
 * What the browsing app draws from this package: a machine's disks, the tab a
 * machine or a volume opens on, and the Disks page the sidebar offers, every
 * disk looked at. The page is loaded when first drawn (./page.ts).
 *
 * @module
 */
import type { View } from '@yaks/inspect'
import HardDrive from 'lucide/dist/esm/icons/hard-drive.mjs'

/** The page and the tab, loaded when first drawn. */
export let inspectViews = (): Promise<View[]> =>
  import('./page.ts').then((m) => m.inspectViews)

/** The tab a machine or a volume opens on: its disks. */
export let tabs = [{ view: 'Disks', icon: 'hard-drive' }]

/** The page the sidebar offers: every disk looked at, by machine. */
export let destinations = [
  { key: 'disks', name: 'Disks', icon: 'hard-drive', view: 'Disks.Page' },
]

/** The glyph it wears there. */
export let icons = { 'hard-drive': HardDrive }
