// A text the write changed, embedded once it has committed (graph.ts
// `#embedding`).
import type { Plugin } from '@yaks/graph'
import type { Options } from './lent.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [
  { name: 'yak/embed', hooks: { effect: store.embed } },
]
