// The three downstream jobs. Intake never groups or notifies in its transaction.
// Notifications use a deterministic mail eid, so retry cannot send a second letter.

import { type Bundle, derivedEid, type Graph, token } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import { comp, str } from './model.ts'
import { type Enrich, group, reframe, trim } from './group.ts'
import { enrichFrames } from './frames.ts'
import { sourceFrames, type SourceOptions } from '@yaks/code/source'
import { headline } from './brief.ts'
import { occurrences, said, where } from './reading.ts'
import { human } from '@yaks/id'

export type Options = {
  enrich?: Enrich
  code?: SourceOptions
  /** Platform/box delivery target, resolved by the host to a person's eid. */
  to?: string
  from?: string
  /** Global eid of this tracker store; separates box and platform letters. */
  store?: string
  /** Tracker web address for links in notification letters. */
  url?: string
  /** A space's stream notification; the unseen reply owns its notified mark. */
  notify?: (bugs: Bundle[]) => void | Promise<void>
  retain?: number
}

let openedAt = (row: Bundle) =>
  str(comp(row, 'regressed').at || comp(row, 'created').at)
let letterEid = (options: Options, row: Bundle) =>
  derivedEid(
    `tracker-notify|${
      JSON.stringify([
        options.store,
        options.to,
        row.entity.eid,
        row.regressed ? 'regressed' : 'created',
        openedAt(row),
      ])
    }`,
  )

let open = (row: Bundle | undefined): row is Bundle =>
  !!row?.bug && !row.archived && !row.resolved && !row.notified

let receipt = (row: Bundle): Bundle => ({
  entity: row.entity,
  $was: {
    created: { at: token(comp(row, 'created').at) },
    regressed: { at: token(comp(row, 'regressed').at) },
    archived: { at: null },
    resolved: { at: null },
    notified: { at: null },
  },
  notified: {},
  wake: null,
  fired: null,
})

/** A bug's opening or regression owns one letter, including across retries. */
export let notify = async (
  g: Graph,
  eid: string,
  options: Options,
): Promise<void> => {
  let [row] = await g.get([eid])
  if (!row) return
  if (row.mail && row.delivered) {
    let target = str(comp(row, 'mail').target)
    if (!target) return
    let [bug] = await g.get([target])
    if (open(bug) && letterEid(options, bug) == eid) {
      await g.apply([receipt(bug)], { trusted: true })
    }
    return
  }
  if (!open(row)) return
  if (options.notify) return await options.notify([row])
  if (!options.to || !options.store) return
  let letter = letterEid(options, row)
  let [exists] = await g.get([letter])
  if (exists?.mail) {
    if (exists.delivered) await g.apply([receipt(row)], { trusted: true })
    return
  }
  let bug = comp(row, 'bug')
  let [newest] = bug.spot ? [] : await g.read(occurrences(eid) + ' .limit=1')
  let name = row.entity.num ? human(g.vocab)(row) : eid
  let path = `/${encodeURIComponent(name)}`
  let url = options.url ? new URL(path, options.url).href : path
  await g.apply([{
    entity: { eid: letter },
    doc: {
      title: `${name}: ${headline(said(row))}`,
      body: [
        said(row),
        '',
        `Where: ${where(row, newest) || 'Unknown'}`,
        `Hits: ${str(bug.hits)}`,
        `First seen: ${str(bug.first)}`,
        `Last seen: ${str(bug.last)}`,
        '',
        `[View ${name}](${url})`,
      ].join('\n'),
    },
    mail: {
      at: openedAt(row),
      target: eid,
      ...options.from ? { from: options.from } : {},
    },
    deliver: { to: options.to },
  }], { trusted: true })
}

export let effects = (
  host: { graph: Graph; config?: { port?: number } },
  options: Options = {},
): Handlers => {
  let enrich = options.enrich ??
    enrichFrames(options.code ? sourceFrames(options.code) : undefined)
  let url = options.url ??
    (host.config?.port ? `http://127.0.0.1:${host.config.port}` : undefined)
  return {
    error_group: (e) => group(host.graph, e.entity.eid),
    error_frames: (e) => reframe(host.graph, e.entity.eid, enrich),
    bug_notify: (e) => notify(host.graph, e.entity.eid, { ...options, url }),
    error_trim: async (e) => {
      let [row] = await host.graph.get([e.entity.eid])
      let bug = str(comp(row, 'error').bug)
      if (bug) await trim(host.graph, bug, options.retain)
    },
  }
}
