// The directory's trial sweep, fired by its wake row: the platform's job
// `plan_trial` (./lent.ts `job`): trials of the Personal plan begun and kept
// (D-476).
import type { Plugin } from '@yaks/graph'
import type { Options } from './lent.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [{
  name: 'yak/plan-trial',
  admission: () => true,
  rules: [{
    name: 'plan_trial',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=plan_trial, #Now',
    run: (row) => store.job?.('plan_trial', row),
  }],
}]
