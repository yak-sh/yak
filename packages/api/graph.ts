// The box loads these hooks before opening its doors: its keyed writes'
// receipts, kept in its write log on the store's own connection.
import type { Plugin } from '@yaks/graph'
import type { Driver } from '@yaks/sql'
import { asking, type Authenticate } from './actor.ts'
import { receipts } from './receipts.ts'

/** What this facet reads off its host: the statements of the store's own
 * connection, where it has SQL, which its write log is kept over. */
export type Hosting = { storage: { statements?: Driver } }

/** A keyed write's receipt, inserted in the transaction that commits it, on
 * a host with SQL; a host with none refuses a keyed write at the door. */
export let plugins = (host: Hosting): Plugin[] =>
  host.storage.statements ? [receipts(host.storage.statements)] : []

/** A host whose options name `who`, another graph's base URL, asks that
 * graph's door who a request is from (./actor.ts `asking`); one naming none
 * leaves the question to another plugin. */
export let authenticate = (
  _host: unknown,
  options: { who?: string },
): Authenticate | undefined => options.who ? asking(options.who) : undefined
