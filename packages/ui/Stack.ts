/**
 * Panes stacked as a person goes: the top one, `Stack.Pane`, takes the room,
 * and each one under it is a `Stack.Strip` at its left, a spine that says
 * what that pane is (its `Name`, then its `Kind`). `Strip-hover` is the one
 * under the pointer, and `Pane-on` a top pane that has the keyboard. What a
 * press on a strip does is the caller's.
 *
 * A browser writes a strip's words down its spine, and a phone-width one
 * lays the strips as lines above the top pane. A terminal makes each strip
 * a framed column three wide, its words one letter a line, and the top pane
 * a framed column taking the rest, in the accent while it has the keyboard.
 *
 * @module
 */

import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
import { block, type Part } from './el.ts'
import type { Colors, Specimen } from './theme.ts'

/** A stack of panes. */
export let Stack: Part & Record<'Strip' | 'Name' | 'Kind' | 'Pane', Part> =
  block('div', 'Stack', {
    Strip: 'button',
    Name: 'span',
    Kind: 'span',
    Pane: 'section',
  })

/** What it is, in a line. */
export let description =
  'Panes stacked as you go: the top one, and a strip for each under it.'

/** Framed columns in a row: each strip three wide, its words folded a letter
 * a line, and the top pane the rest. */
export let sheet = (c: Colors): Sheet => ({
  Stack: { row: true, grow: true },
  Stack_Strip: { col: true, width: 3, border: 'Stack_Edge', fg: c.muted },
  'Stack_Strip-hover': { fg: c.text },
  Stack_Name: { block: true, wrap: true, gap: true, fg: c.text },
  Stack_Kind: { block: true, wrap: true, fg: c.dim },
  Stack_Pane: { col: true, grow: true, border: 'Stack_Edge' },
  'Stack_Pane-on': { border: 'Stack_Edge-on' },
  Stack_Edge: { fg: c.border2 },
  'Stack_Edge-on': { fg: c.accent },
})

let { Strip, Name, Kind, Pane } = Stack

let strip = (name: string, kind: string, mod?: string) =>
  h(
    Strip,
    { key: name, type: 'button', mod },
    h(Name, {}, name),
    h(Kind, {}, kind),
  )

/** Three panes gone through, the one under the pointer, and the top one. */
export let specimens = (): Specimen[] => [
  [
    'Stack, Strip, Strip-hover, Name, Kind, Pane',
    h(
      Stack,
      { style: 'height: 12rem; width: 40rem; max-width: 100%' },
      strip('inspect', ''),
      strip('task', 'component', 'hover'),
      strip('Fix the map', 'task'),
      h(Pane, {}, h('p', {}, 'task.status'), h('p', {}, 'where a task stands')),
    ),
  ],
]
