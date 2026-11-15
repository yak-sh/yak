// The directory's remake sweep, fired by a release's remake row: the
// platform's job `remake` (./lent.ts `job`).
import type { Plugin } from '@yaks/graph'
import type { Options } from './lent.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [{
  name: 'yak/remake',
  admission: () => true,
  rules: [{
    name: 'remake',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=remake, .release_remake, #Now',
    run: (row) => store.job?.('remake', row),
  }],
}]
