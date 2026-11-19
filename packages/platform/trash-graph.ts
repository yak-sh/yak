// The trash: a fresh trash or restore mark stamped with the write's own clock
// and vouched actor, and the directory's trash sweep, fired by its wake row:
// the platform's job `trash` (./lent.ts `job`).
import type { Plugin } from '@yaks/graph'
import type { Options } from './lent.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [{
  name: 'yak/trash',
  admission: () => true,
  // An already dated mark is left intact, including a migration's byline.
  rules: [{
    name: 'trashed',
    phase: 'stamp',
    match: '*trashed, !trashed.at, #Actor, #Now',
    run: ({ Actor, Now }) => ({ trashed: { at: Now, by: Actor } }),
  }, {
    name: 'untrashed',
    phase: 'stamp',
    match: '*untrashed, !untrashed.at, #Actor, #Now',
    run: ({ Actor, Now }) => ({ untrashed: { at: Now, by: Actor } }),
  }, {
    name: 'trash',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=trash, #Now',
    run: (row) => store.job?.('trash', row),
  }],
}]
