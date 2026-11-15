// The directory's kill sweep, fired by its wake row: the platform's job
// `kills` (./lent.ts `job`). Each run reads on from where the last one
// finished, which the row keeps as `sweep.through`.
import type { Plugin } from '@yaks/graph'
import type { Options } from './lent.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [{
  name: 'yak/kills',
  admission: () => true,
  rules: [{
    name: 'kills',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=kills, #Now',
    run: (row) => store.job?.('kills', row),
  }],
}]
