// Deploy-time browser dependency entry. One bundle keeps the completer,
// draft graph, Preact and signals on the same runtime, including exports not
// yet in the published packages. Upload its bundle, not this source entry.
export * from '@yaks/cli/grammar'
export { completion } from '@yaks/ux/completion'
export { uxDoc } from '@yaks/ux/vocab'
export { desk, draftDoc, drafts } from '@yaks/draft'
export { client, idb } from '@yaks/client'
export { loadVocab } from '@yaks/vocab'
export * from 'preact'
export { batch, computed, effect, signal, untracked } from '@preact/signals'
// One Preact realm for both the completion bar and Vale's pluggable kits.
export * as UI from '@yaks/ui'
export * as UX from '@yaks/ux'
export * as UXFacet from '@yaks/ux/ui'
export * as Hooks from 'preact/hooks'
export * as Guide from '../../packages/ui/guide.ts'
export * as Graph from '@yaks/graph'
export * as Query from '@yaks/query'
