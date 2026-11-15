// The directory's wrap pass, fired by its wake row: the platform's job `wrap`
// (./lent.ts `job`).
import type { Plugin } from '@yaks/graph'
import type { Options } from './lent.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [{
  name: 'yak/wrap',
  admission: () => true,
  rules: [{
    name: 'wrap',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=wrap, #Now',
    run: (row) => store.job?.('wrap', row),
  }],
}]
