// Who wrote the words an app's rows still hold: @yaks/provenance's
// `authorship{fields}` tracker, which an app store composes so
// the Operator hears a stranger's surviving words across later member edits.
import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { authorship } from '@yaks/provenance/tracker'

export let plugins = ({ vocab }: { vocab: Vocab }): Plugin[] => [
  authorship(vocab),
]
