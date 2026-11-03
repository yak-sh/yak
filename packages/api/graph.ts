// The box loads these hooks with the API vocabulary, before opening its doors.
import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { asking, type Authenticate } from './actor.ts'
import { receipts } from './receipts.ts'

/** Receipt bookkeeping belongs only to the API's own component. */
export let plugins = ({ vocab }: { vocab: Vocab }): Plugin[] =>
  vocab.comp('apply_receipt')?.package == '@yaks/api' ? [receipts()] : []

/** A host whose options name `who`, another graph's base URL, asks that
 * graph's door who a request is from (./actor.ts `asking`); one naming none
 * leaves the question to another plugin. */
export let authenticate = (
  _host: unknown,
  options: { who?: string },
): Authenticate | undefined => options.who ? asking(options.who) : undefined
