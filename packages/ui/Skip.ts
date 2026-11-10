/** A link revealed by keyboard focus to skip repeated navigation. @module */
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A link revealed by keyboard focus to skip repeated navigation. */
export let Skip: Part = block('a', 'Skip', {})
/** What this part presents. */
export let description =
  'A link revealed by keyboard focus to skip repeated navigation.'
/** The same parts in a terminal. */
export let sheet = (_c: Colors): Sheet => ({ Skip: { hidden: true } })
/** A complete example. */
export let specimens =
  (): Specimen[] => [['Skip', h(Skip, { href: '#' }, 'Skip to content')]]
