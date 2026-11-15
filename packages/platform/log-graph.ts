// The write log's door (@yaks/api/receipts `door`): a keyed write's answer,
// kept in the transaction that commits it. Last of the store's commit hooks,
// so the answer is the batch as every other one left it.
import type { Plugin } from '@yaks/graph'
import type { Options } from './lent.ts'

export let plugins = (_host: unknown, { store }: Options): Plugin[] => [
  store.log,
]
