/**
 * A web address said in words, its `Address.Name` (the part that is a
 * person's own, as `ada` in ada.yaks.app) set apart from the rest:
 * `<Address><Address.Name>ada</Address.Name>.yaks.app</Address>`.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** An address, and the name in it. */
export let Address: Part & Record<'Name', Part> = block('span', 'Address', {
  Name: 'strong',
})

/** What it is, in a line. */
export let description = 'A web address, the name in it set apart.'

/** The address is muted, the name in it the text's own. */
export let sheet = (c: Colors): Sheet => ({
  Address: { fg: c.muted },
  Address_Name: { fg: c.text, bold: true },
})

/** An address, and one with a path. */
export let specimens = (): Specimen[] => [
  ['Address, Name', h(Address, {}, h(Address.Name, {}, 'ada'), '.yaks.app')],
  [
    'Address with a path',
    h(Address, {}, h(Address.Name, {}, 'ada'), '.yaks.app/recipes'),
  ],
]
