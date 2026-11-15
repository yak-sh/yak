// The directory's git sweep, fired by its wake row: each deploy not yet
// committed, committed by the platform's job `git` (./lent.ts `job`).
import type { Plugin } from '@yaks/graph'
import type { Options } from './lent.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [{
  name: 'yak/git',
  admission: () => true,
  rules: [{
    name: 'git',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=git, #Now',
    run: (row) => store.job?.('git', row),
  }],
}]
