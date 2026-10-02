// The three downstream jobs. Intake never groups or notifies in its transaction.
// Notifications use a deterministic mail eid, so retry cannot send a second letter.

import { type Bundle, derivedEid, type Graph } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import { and, eq, every } from '@yaks/query'
import { comp, str } from './model.ts'
import { type Enrich, group, reframe, trim } from './group.ts'
import { enrichFrames } from './frames.ts'
import { sourceFrames, type SourceOptions } from '@yaks/code/source'

export type Options = {
  enrich?: Enrich
  code?: SourceOptions
  /** Platform/box delivery target, resolved by the host to a person's eid. */
  to?: string
  from?: string
  /** Global eid of this tracker store; separates box and platform letters. */
  store?: string
  /** A space's stream notification; the unseen reply owns its notified mark. */
  notify?: (bugs: Bundle[]) => void | Promise<void>
  retain?: number
}

let openedAt = (row: Bundle) =>
  str(comp(row, 'regressed').at || comp(row, 'created').at)
let minuteOf = (row: Bundle) => openedAt(row).slice(0, 16)
let letterEid = (options: Options, minute: string) =>
  derivedEid(
    `tracker-notify|${JSON.stringify([options.store, options.to, minute])}`,
  )

/** A minute's bugs wait on a graph wake, not a timer in the tracker core. */
export let notify = async (
  g: Graph,
  eid: string,
  options: Options,
): Promise<void> => {
  let [row] = await g.get([eid])
  if (!row) return
  let related = await g.read(and(eq('bug.status', 'open'), every()))
  if (row.mail && row.delivered) {
    let sent = related.filter((b) =>
      !b.notified &&
      letterEid(options, minuteOf(b)) == eid
    )
    if (sent.length) {
      await g.apply(
        sent.map((b) => ({
          entity: b.entity,
          notified: {},
          wake: null,
          fired: null,
        })),
        { trusted: true },
      )
    }
    return
  }
  if (!row.bug || row.archived || row.resolved || row.notified) return
  if (options.notify) return await options.notify([row])
  if (!options.to || !options.store) return
  if (!row.fired) {
    if (!row.wake) {
      await g.apply([{
        entity: row.entity,
        wake: {
          at: new Date(Date.parse(`${minuteOf(row)}:00Z`) + 60_000)
            .toISOString(),
        },
      }], { trusted: true })
    }
    return
  }
  let minute = minuteOf(row)
  let letter = letterEid(options, minute)
  let [exists] = await g.get([letter])
  if (exists?.mail) return
  let batch = related.filter((b) => !b.notified && minuteOf(b) == minute)
  await g.apply([{
    entity: { eid: letter },
    doc: {
      title: 'Bugs need attention',
      body: batch.map((b) => `${b.entity.eid}: ${str(comp(b, 'bug').title)}`)
        .join('\n'),
    },
    mail: { at: openedAt(row), ...options.from ? { from: options.from } : {} },
    deliver: { to: options.to },
  }], { trusted: true })
}

export let effects = (
  host: { graph: Graph },
  options: Options = {},
): Handlers => {
  let enrich = options.enrich ??
    enrichFrames(options.code ? sourceFrames(options.code) : undefined)
  return {
    error_group: (e) => group(host.graph, e.entity.eid),
    error_frames: (e) => reframe(host.graph, e.entity.eid, enrich),
    bug_notify: (e) => notify(host.graph, e.entity.eid, options),
    error_trim: async (e) => {
      let [row] = await host.graph.get([e.entity.eid])
      let bug = str(comp(row, 'error').bug)
      if (bug) await trim(host.graph, bug, options.retain)
    },
  }
}
