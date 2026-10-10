// An actionable exception is reported through the host's telemetry. Bug tasks
// already in this graph start fixers behind the provider, project, cap and
// cooldown gates; the boot sweep retries bugs those gates held back.

import {
  type Bundle,
  type Comp,
  type Graph,
  identityEid,
  who,
} from '@yaks/graph'
import type { Host as Hosting } from '@yaks/host'
import type { Handlers } from '@yaks/effects'
import { fixing, type Options } from './fix.ts'
import { and, eq } from '@yaks/query'
import { actionable } from './fault.ts'

/** What these handlers are given (@yaks/cli `Host`). */
export type Host = Pick<Hosting, 'graph' | 'report'>

export type { Options } from './fix.ts'
export { STARTING } from './fix.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let str = (v: unknown) => v == null ? '' : String(v)
let one = async (g: Graph, eid: string): Promise<Bundle | undefined> =>
  (await g.get([eid]))[0]

export let effects = (host: Host, options: Options = {}): Handlers => {
  let g = host.graph
  let { fix } = fixing(g, options)
  let legacy = (eid: string) =>
    fix(async () => {
      let task = await one(g, eid)
      if (!task?.bug) return
      let same = await g.read(
        and(eq('bug.fault', str(comp(task, 'bug')?.fault))),
      )
      return { task, bug: eid, same: same.map((b) => b.entity.eid) }
    })

  let report = async (eid: string) => {
    let row = await one(g, eid)
    let x = comp(row, 'exception')
    if (!row || !x) return // cleared before this ran
    let message = str(x.value || x.message || comp(row, 'content')?.body).trim()
    if (!message || !actionable(message)) return
    let source = str(comp(row, 'output')?.source)
    let call = source ? await one(g, source) : undefined
    let to = str(comp(call, 'call')?.to)
    let tool = to ? str(comp(await one(g, to), 'tool')?.name) : ''
    let actor = call && who(call) || who(row)
    let session = str(comp(row, 'entry')?.session) ||
      (row.session ? eid : str(comp(call, 'entry')?.session))
    let process = str(comp(row, 'execution')?.by) ||
      (row.process ? eid : str(comp(call, 'execution')?.by))
    let error = new Error(message)
    error.name = str(x.type) || 'Error'
    // An invented reporting frame would group failures by this handler.
    error.stack = str(x.stack) || undefined
    await host.report?.(error, {
      eid: identityEid('exception_report', [eid]),
      ...(actor ? { actor } : {}),
      ...(tool ? { tags: { tool } } : {}),
      ...(x.at ? { at: str(x.at) } : {}),
      ...(typeof x.version == 'number' ? { version: x.version } : {}),
      during: {
        entity: eid,
        kind: g.vocab.kindOf(row),
        ...(session ? { session } : {}),
        ...(process ? { process } : {}),
      },
    })
  }

  return {
    exception_report: (e) => report(e.entity.eid),
    // Idempotent: a bug that has a fixer, or is held, starts nothing.
    bug_fix: (e) => legacy(e.entity.eid),
  }
}
