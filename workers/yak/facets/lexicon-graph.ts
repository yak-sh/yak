// The words a write brought, told to the Lexicon once it has committed
// (graph.ts `#telling`), in a store that keeps one.
import type { Plugin } from '@yaks/graph'
import type { Options } from './store.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] =>
  store.tell ? [{ name: 'yak/lexicon', hooks: { effect: store.tell } }] : []
