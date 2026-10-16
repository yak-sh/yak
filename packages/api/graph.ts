// The box loads these hooks with the API vocabulary, before opening its doors.
import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { receipts } from './receipts.ts'

/** Receipt bookkeeping belongs only to the API's own component. */
export let plugins = ({ vocab }: { vocab: Vocab }): Plugin[] =>
  vocab.comp('apply_receipt')?.package == '@yaks/api' ? [receipts()] : []
