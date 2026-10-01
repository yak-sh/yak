/** A keyboard hint in the flow of text; its caller chooses where it sits. */
import { type Colors, el, type Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { Fragment, h } from 'preact'

let Key = el('kbd', 'ValeKeycap')
export let ValeKeycap = ({ keycap }: { keycap: string }) => h(Key, {}, keycap)
export let description = 'The face of a keyboard key.'
export let sheet = (c: Colors): Sheet => ({
  ValeKeycap: { fg: c.text, bg: c.card },
})
let sample = (props: Parameters<typeof ValeKeycap>[0]) =>
  h(Fragment, {}, h(ValeKeycap, props))
export let specimens = (): Specimen[] => [
  ['Single key', sample({ keycap: 'M' })],
  ['Chord', sample({ keycap: 'Shift + Enter' })],
]
