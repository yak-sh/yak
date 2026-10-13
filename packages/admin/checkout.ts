// The checkout infrastructure operations run git and wrangler in: the one this
// code came from, with the box's GitHub and Wrangler logins, independent of a
// yaks.app account session. A long-lived command (`yak work`, `yak serve`)
// runs from a private copy of its sources with no `.git` (@yaks/cli runtime),
// so the copy's path maps back to the checkout it was copied from.

import { fileURLToPath } from 'node:url'
import { runtimeSource } from '@yaks/cli'

/** The repository root these operations work in. */
export let checkout: string = fileURLToPath(
  runtimeSource(new URL('../../', import.meta.url).href),
).replace(/\/$/, '')
