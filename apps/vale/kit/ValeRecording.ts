// A recording preview is the browser's native player, with no playback state
// outside it. The takes page owns which recording it points at.
import { el } from '@yaks/ui'
import type { Colors, Specimen } from '@yaks/ui'
import type { Sheet } from '@yaks/tui/theme'
import { h } from 'preact'
export let ValeRecording = el('audio', 'ValeRecording')
export let description = 'Listen to a recording before choosing it.'
export let sheet = (c: Colors): Sheet => ({ ValeRecording: { fg: c.text } })
export let specimens = (): Specimen[] => [
  ['Recording', h(ValeRecording, { controls: true, preload: 'none' })],
]
