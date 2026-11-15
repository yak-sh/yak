// What an app holds, told to the directory once a write has committed
// (graph.ts `#tell`). The platform's own two stores are not apps and are not
// metered.
import type { Plugin } from '@yaks/graph'
import type { Options } from './lent.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [
  { name: 'yak/weigh', hooks: { effect: store.weigh } },
]
