/**
 * An identifier, `T-123`: one token, paint only. Given an `href` it is a
 * link (el.ts); what it names is the application's.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { el, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** An identifier. */
export let Id: Part = el('span', 'Id')

/** Dim, and struck when retired. */
export let sheet = (c: Colors): Sheet => ({
  Id: { fg: c.dim },
  'Id-hover': { fg: c.muted, underline: true },
  'Id-retired': { fg: c.dim, dim: true, strike: true },
})

/** Plain, under the pointer, and retired. */
export let specimens = (): Specimen[] => [
  ['Id', h(Id, {}, 'T-123')],
  ['Id-hover', h(Id, { mod: 'hover' }, 'T-123')],
  ['Id-retired', h(Id, { mod: 'retired' }, 'P-7')],
]
