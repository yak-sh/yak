// The three downstream jobs. Intake never groups or notifies in its transaction.
// Notifications use a deterministic mail eid, so retry cannot send a second letter.

import type { Bundle, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { token } from '@yaks/graph/sha256'
import type { Handlers } from '@yaks/effects'
import { comp, type Desk, str } from './model.ts'
import { type Enrich, group, reframe, trim } from './group.ts'
import { enrichFrames } from './frames.ts'
import { sourceFrames, type SourceOptions } from '@yaks/code/source'
import { followUp, letter, type Mark } from './letter.ts'
import { occurring, remoteBug } from './reading.ts'
import { tags } from './spread.ts'
import { human } from '@yaks/id'

export type Options = {
  enrich?: Enrich
  code?: SourceOptions
  /** Platform/box delivery target, resolved by the host to a person's eid. */
  to?: string
  from?: string
  /** Ignore openings before mail activation, without changing unseen state. */
  since?: string
  /** Global eid of this tracker store; separates box and platform letters. */
  store?: string
  /** Tracker web address for links in notification letters. */
  url?: string
  /** The web root of the repository a resolution's commits link into
   * (`https://github.com/yak-sh/yak`); without it a letter names them by
   * sha alone. */
  repo?: string
  /** Capture sources (`error.tags.source`) forwarded here by a tracker that
   * writes their letters itself: a bug every kept occurrence of which came
   * from one is marked seen here without a letter, so it sends one letter. */
  forwarded?: string[]
  /** The side of the tracker web this store's bugs open on when they are not
   * in the web's own graph: `yaks.app` for the platform tracker, which the
   * box's tracker web reads through. Its letters name a bug by global eid,
   * since its numbers mean nothing there. */
  side?: string
  /** A space's stream notification; the unseen reply owns its notified mark. */
  notify?: (bugs: Bundle[]) => void | Promise<void>
  retain?: number
  /** A box with remote standing suppresses historical follow-up catch-up. */
  remote?: import('./remote.ts').Remote
}

let openedAt = (row: Bundle) =>
  str(comp(row, 'regressed').at || comp(row, 'created').at)

// A bug that opens now from an occurrence a day or more old is history
// arriving late (moved records, a backlog forwarded after an outage): nothing
// is failing now, so it is marked seen without a letter. A regression is
// always news.
let LATE = 24 * 60 * 60 * 1000
let late = (row: Bundle) => {
  let first = Date.parse(str(comp(row, 'bug').first))
  return !comp(row, 'regressed').at &&
    Date.parse(openedAt(row)) - first >= LATE
}
let occasion = (options: Options, eid: string, kind: string, at: unknown) =>
  derivedEid(
    `tracker-notify|${
      JSON.stringify([options.store, options.to, eid, kind, at])
    }`,
  )
let letterEid = (options: Options, row: Bundle) =>
  occasion(
    options,
    row.entity.eid,
    row.regressed ? 'regressed' : 'created',
    openedAt(row),
  )
// The opening's letter heads the bug's thread; later letters answer it.
let opening = (options: Options, row: Bundle) =>
  occasion(options, row.entity.eid, 'created', comp(row, 'created').at)

// Every kept occurrence came from a source whose own tracker announces it.
let elsewhere = (options: Options, errors: Bundle[]) =>
  !!options.forwarded?.length && errors.length > 0 &&
  errors.every((b) =>
    options.forwarded!.includes(str(tags(b).find(([k]) => k == 'source')?.[1]))
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
})

/** A bug's opening or regression owns one letter, including across retries. */
export let notify = async (
  g: Desk,
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
  if (options.since && openedAt(row) < options.since) return
  if (late(row)) return void await g.apply([receipt(row)], { trusted: true })
  let mailed = letterEid(options, row)
  let [exists] = await g.get([mailed])
  if (exists?.mail) {
    if (exists.delivered) await g.apply([receipt(row)], { trusted: true })
    return
  }
  let errors = await g.read(occurring(eid))
  if (elsewhere(options, errors)) {
    return void await g.apply([receipt(row)], { trusted: true })
  }
  let request = str(comp(errors[0], 'during').request)
  let [asked] = request ? await g.get([request]) : []
  let to = address(g, row, options)
  let { title, body } = letter(row, errors, asked, to)
  let [head] = row.regressed ? await g.get([opening(options, row)]) : []
  await g.apply([{
    entity: { eid: mailed },
    doc: {
      title: head?.mail ? `Re: ${str(comp(head, 'doc').title)}` : title,
      body,
    },
    mail: {
      at: openedAt(row),
      target: eid,
      ...options.from ? { from: options.from } : {},
      ...head?.mail ? { reply_to: head.entity.eid } : {},
    },
    deliver: { to: options.to },
  }], { trusted: true })
}

// A bug's name and page: its human id where the store keeps one, or its
// global eid on the side the tracker web reads it from.
let address = (g: Desk, row: Bundle, options: Options) => {
  let eid = row.entity.eid
  let name = row.entity.num && !options.side ? human(g.vocab)(row) : eid
  let path = options.side
    ? remoteBug(options.side, eid)
    : `/${encodeURIComponent(name)}`
  return {
    name,
    url: options.url ? new URL(path, options.url).href : path,
    now: new Date().toISOString(),
  }
}

/** A bug says in its thread when a fixer takes it and when it is resolved or
 * archived, once per mark; a fixer's word once per opening, so taking it again
 * before it reopens says nothing new. Only a bug that has a thread hears: one
 * that opened unannounced stays quiet. A resolution is told with its
 * explanation and whom the bug reached, and a bare one waits for it. */
export let follow = async (
  g: Desk,
  eid: string,
  options: Options,
): Promise<void> => {
  if (options.notify || !options.to || !options.store) return
  let [row] = await g.get([eid])
  let mark: Mark | undefined = row?.resolved
    ? 'resolved'
    : row?.archived
    ? 'archived'
    : row?.taken
    ? 'taken'
    : undefined
  if (!row?.bug || !mark) return
  if (mark == 'resolved' && !comp(row, 'resolved').cause) return
  let at = comp(row, mark).at
  if (options.since && str(at) < options.since) return
  let back = comp(row, 'regressed').at
  // A fixer that took the bug before it came back is no news about this opening.
  if (mark == 'taken' && back && str(at) < str(back)) return
  let said = occasion(
    options,
    eid,
    mark,
    mark == 'taken' ? back ?? comp(row, 'created').at : at,
  )
  // An opening that came in late had no letter; its regression's starts one.
  let heads = [
    opening(options, row),
    ...back ? [occasion(options, eid, 'regressed', back)] : [],
  ]
  let found = await g.get([said, ...heads])
  let mailed = (eid: string) => found.find((r) => r.entity.eid == eid && r.mail)
  let head = heads.map(mailed).find(Boolean)
  if (mailed(said) || !head) return
  let { title, body } = followUp(
    row,
    mark,
    str(comp(head, 'doc').title),
    address(g, row, options),
    {
      errors: mark == 'resolved' ? await g.read(occurring(eid)) : [],
      repo: options.repo,
    },
  )
  await g.apply([{
    entity: { eid: said },
    doc: { title, body },
    mail: {
      at: str(at),
      target: eid,
      reply_to: head.entity.eid,
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
  let followSince = options.since ??
    (options.remote ? new Date().toISOString() : undefined)
  let url = options.url ??
    (host.config?.port ? `http://127.0.0.1:${host.config.port}` : undefined)
  return {
    error_group: (e) => group(host.graph, e.entity.eid),
    error_frames: (e) => reframe(host.graph, e.entity.eid, enrich),
    bug_notify: (e) => notify(host.graph, e.entity.eid, { ...options, url }),
    bug_follow: (e) =>
      follow(host.graph, e.entity.eid, { ...options, since: followSince, url }),
    error_trim: async (e) => {
      let [row] = await host.graph.get([e.entity.eid])
      let bug = str(comp(row, 'error').bug)
      if (bug) await trim(host.graph, bug, options.retain)
    },
  }
}
