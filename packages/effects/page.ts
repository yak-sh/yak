/**
 * The page the browsing app's sidebar offers as Effects: the processes
 * working the effect pool, how busy each is and what it is running, how fast
 * runs end, and the runs owed behind them, by handler. It moves as the
 * workers do, about once a second.
 *
 * Where each number comes from:
 * - workers, what each is running, runs a second and how busy each is: the
 *   `worker` row every process working the pool writes on itself
 *   (./worker.ts). A worker is up while that row is fresh;
 * - running, waiting, retrying and failed by handler: the `effect` rows
 *   themselves, tallied by handler (./pool.ts), for every effect the
 *   vocabulary declares, each named by its `_effect` row (@yaks/vocab), so
 *   one owed nothing still shows.
 *
 * @module
 */
import { type ComponentChildren, h, type JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import {
  type Answer,
  type Bundle,
  effectEid,
  type Io,
  mention,
  type Props,
  useNamed,
  type View,
} from '@yaks/inspect'
import { Head, Loading, Meter, Metrics, Section, Spark, Table } from '@yaks/ui'
import { effectsIn } from '@yaks/vocab'
import { rate, said, type Worker } from './worker.ts'

/** How long a worker may say nothing before it reads as silent (ms): it says
 * something about once a second. */
export let QUIET = 5_000

/** How long a silent worker is still shown (ms); past this it is long gone,
 * whatever its process row says. */
export let FORGOTTEN = 10 * 60_000

/** What a process is called: the name its unit gave it, or what it runs. */
/// called('deno work --process yak-work --config x') -> 'yak-work'
/// called('deno browse --config x') -> 'browse'
/// called() -> 'process'
export let called = (command = ''): string => {
  let words = command.split(/\s+/).filter(Boolean)
  return command.match(/--process[ =](\S+)/)?.[1] ?? words[1] ?? words[0] ??
    'process'
}

/** How long something has lasted, in its two largest units. */
/// lasted(12_400) -> '12s'
/// lasted(192_000) -> '3m 12s'
/// lasted(3 * 3_600_000 + 60_000) -> '3h 1m'
/// lasted(50 * 3_600_000) -> '2d 2h'
export let lasted = (ms: number): string => {
  let s = Math.max(0, Math.floor(ms / 1000))
  let d = Math.floor(s / 86_400), h = Math.floor(s / 3600) % 24
  let m = Math.floor(s / 60) % 60
  return d
    ? `${d}d ${h}h`
    : h
    ? `${h}h ${m}m`
    : m
    ? `${m}m ${s % 60}s`
    : `${s}s`
}

/** Runs a second, as a person reads them. */
/// perSecond(0) -> '0'
/// perSecond(0.4) -> '0.4'
/// perSecond(12.6) -> '13'
/// perSecond(1234) -> '1,234'
export let perSecond = (n: number): string =>
  n == 0 ? '0' : n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-US')

/** Several workers' histories as one, second by second, their newest seconds
 * lined up. */
/// together([[1, 2, 3], [0, 1]]) -> [1, 2, 4]
/// together([]) -> []
export let together = (histories: number[][]): number[] => {
  let n = Math.max(0, ...histories.map((h) => h.length))
  return Array.from(
    { length: n },
    (_, i) => histories.reduce((sum, h) => sum + (h[h.length - n + i] ?? 0), 0),
  )
}

/** A worker, as the page shows it. */
export type Seen = {
  eid: string
  name: string
  pid?: number
  /** when its process started, ISO-8601 */
  born?: string
  w: Worker
  /** how long since it last said anything (ms) */
  silent: number
}

/** The workers worth showing, by name: every one that said something in the
 * last {@link FORGOTTEN}, with how long ago. */
/// let w = (eid: string, at: string) => ({ entity: { eid }, worker: { at }, process: { pid: 7, command: 'deno work --process yak-work' } })
/// let now = Date.parse('2026-01-01T00:00:10Z')
/// workers([w('a', '2026-01-01T00:00:09Z'), w('b', '2026-01-01T00:00:00Z'), w('c', '2025-01-01T00:00:00Z')], now).map((s) => [s.eid, s.name, s.silent])
///   -> [['a', 'yak-work', 1000], ['b', 'yak-work', 10000]]
export let workers = (rows: Bundle[], now: number): Seen[] =>
  rows.flatMap((b) => {
    let w = said(b)
    if (!w) return []
    let silent = Math.max(0, now - Date.parse(w.at))
    if (!(silent <= FORGOTTEN)) return []
    let p = (b.process ?? {}) as { pid?: number; command?: string }
    let born = (b.created as { at?: string } | undefined)?.at
    return [{
      eid: b.entity.eid,
      name: called(p.command),
      pid: p.pid,
      born,
      w,
      silent,
    }]
  }).sort((a, b) =>
    a.name.localeCompare(b.name) || (a.pid ?? 0) - (b.pid ?? 0) ||
    a.eid.localeCompare(b.eid)
  )

/** The runs owed to one handler. */
export type Owed = {
  handler: string
  /** claimed by a worker, so going now */
  running: number
  /** owed and not yet claimed, due or backing off */
  waiting: number
  /** of the owed, those that failed before and will be tried again */
  retrying: number
  /** spent their tries, left for a person */
  failed: number
}

type Tally = Record<string, number> | undefined

/** The runs owed by handler, from the `effect` rows' tallies: every handler
 * owed something, and each of `declared` though it is owed nothing. The
 * busiest first, then the most failed, then by name. */
/// handlers({ owed: { a: 3, b: 1 }, claimed: { a: 1 }, retrying: { b: 1 }, failed: { c: 2, b: 1 } }).map((o) => Object.values(o))
///   -> [['a', 1, 2, 0, 0], ['b', 0, 1, 1, 1], ['c', 0, 0, 0, 2]]
/// handlers({}, ['z']) -> [{ handler: 'z', running: 0, waiting: 0, retrying: 0, failed: 0 }]
export let handlers = (
  t: { owed?: Tally; claimed?: Tally; retrying?: Tally; failed?: Tally },
  declared: string[] = [],
): Owed[] => {
  let n = (x: Tally, k: string) => x?.[k] ?? 0
  let names = new Set([
    ...declared,
    ...[t.owed, t.claimed, t.retrying, t.failed].flatMap((x) =>
      Object.keys(x ?? {})
    ),
  ])
  return [...names].map((handler) => ({
    handler,
    running: n(t.claimed, handler),
    waiting: Math.max(0, n(t.owed, handler) - n(t.claimed, handler)),
    retrying: n(t.retrying, handler),
    failed: n(t.failed, handler),
  })).sort((a, b) =>
    b.running + b.waiting - a.running - a.waiting || b.failed - a.failed ||
    a.handler.localeCompare(b.handler)
  )
}

// What the page asks: every worker still running with its process, and the
// effect rows owed, tallied by handler four ways.
let asks = (_e: Bundle, io: Io) => {
  let has = (c: string) => !!io.vocab.comp(c)
  return {
    workers: `.worker${has('exit') ? '&!exit' : ''}` +
      ['process', 'created'].filter(has).map((c) => `&?${c}`).join('') +
      '&.limit=100',
    owed: '.effect.state=pending&.tally=effect.handler',
    claimed: '.effect.state=pending&.effect.lease_owner&.tally=effect.handler',
    retrying: '.effect.state=pending&.effect.error&.tally=effect.handler',
    failed: '.effect.state=failed&.tally=effect.handler',
  }
}

// The clock the page reads, moving every second while it is drawn.
let useNow = (every = 1000) => {
  let [now, set] = useState(() => Date.now())
  useEffect(() => {
    let timer = setInterval(() => set(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
}

let { Body, Cell, Heading, Row } = Table

let heads = (...names: (string | [string, string])[]) =>
  h(
    Table.Head,
    {},
    h(
      Row,
      {},
      names.map((n) =>
        typeof n == 'string'
          ? h(Heading, { key: n }, n)
          : h(Heading, { key: n[0], mod: n[1] }, n[0])
      ),
    ),
  )

// A count that opens the runs it counts; nothing where there are none.
let count = (io: Io, n: number, query: string) =>
  n ? h('a', { href: io.find(query) }, n.toLocaleString('en-US')) : ''

let stat = (
  value: string,
  label: string,
  mod?: string,
  note?: ComponentChildren,
) =>
  h(
    Metrics.Item,
    {},
    h(Metrics.Value, { mod }, value),
    h(Metrics.Label, {}, label),
    note ? h(Metrics.Note, {}, note) : null,
  )

let percent = (n: number) => `${Math.round(n * 100)}%`

// The workers, one a row: how busy, how fast, how much, and how long up.
let Workers = ({ io, seen, now }: { io: Io; seen: Seen[]; now: number }) =>
  h(
    Section,
    {},
    h(Section.Title, {}, 'Workers'),
    h(
      Section.Sub,
      {},
      'Each process working the pool. Busy is the share of a core it used; loop is how late its thread ran a timer, which climbs as its event loop fills.',
    ),
    seen.length
      ? h(
        Table,
        { cols: [null, null, 'num', null, 'num', 'num', 'num', null] },
        heads(
          'worker',
          'busy',
          ['loop', 'num'],
          'runs a second',
          ['running', 'num'],
          ['finished', 'num'],
          ['errors', 'num'],
          'up',
        ),
        h(
          Body,
          {},
          seen.map(({ eid, name, pid, born, w, silent }) =>
            h(
              Row,
              { key: eid, 'data-worker': eid },
              h(
                Cell,
                {},
                h('a', { href: io.link(eid) }, name),
                pid ? ` ${pid}` : '',
              ),
              h(
                Cell,
                {},
                w.cpu == null ? '' : [
                  h(Meter, { value: w.cpu, width: 10 }),
                  ' ',
                  percent(w.cpu),
                ],
              ),
              h(Cell, { mod: 'num' }, w.lag == null ? '' : `${w.lag} ms`),
              h(
                Cell,
                {},
                h(Spark, { values: w.history.slice(-20) }),
                ` ${perSecond(rate(w.history))}`,
              ),
              h(Cell, { mod: 'num' }, String(w.running)),
              h(Cell, { mod: 'num' }, w.ran.toLocaleString('en-US')),
              h(Cell, { mod: 'num' }, w.errors.toLocaleString('en-US')),
              h(
                Cell,
                { 'data-silent': silent >= QUIET ? '' : undefined },
                silent >= QUIET
                  ? `silent ${lasted(silent)}`
                  : born
                  ? lasted(now - Date.parse(born))
                  : '',
              ),
            )
          ),
        ),
      )
      : h(
        Section.Sub,
        { role: 'status' },
        'No process is working the pool, so nothing owed runs until one starts.',
      ),
  )

// Every run going in a worker that is up, the longest first.
let Running = ({ io, up, now }: { io: Io; up: Seen[]; now: number }) => {
  let runs = up.flatMap((s) => s.w.runs.map((r) => ({ ...r, by: s })))
    .sort((a, b) => a.since.localeCompare(b.since))
  let unlisted = up.reduce((n, s) => n + s.w.running - s.w.runs.length, 0)
  useNamed(io, runs.map((r) => r.target))
  return h(
    Section,
    {},
    h(
      Section.Title,
      {},
      'Running now',
      ' ',
      h(Section.Count, {}, String(runs.length + unlisted)),
    ),
    runs.length
      ? h(
        Table,
        { cols: [null, null, null, 'num'] },
        heads('handler', 'for', 'worker', ['running for', 'num']),
        h(
          Body,
          {},
          runs.map((r) =>
            h(
              Row,
              { key: r.run, 'data-run': r.run },
              h(Cell, {}, r.handler),
              h(Cell, {}, mention(io, r.target)),
              h(Cell, {}, r.by.name),
              h(Cell, { mod: 'num' }, lasted(now - Date.parse(r.since))),
            )
          ),
          unlisted > 0
            ? h(
              Row,
              { mod: 'quiet' },
              h(Cell, {}, `and ${unlisted.toLocaleString('en-US')} more`),
            )
            : null,
        ),
      )
      : h(Section.Sub, {}, 'Nothing is running.'),
  )
}

// What each handler is owed: going, waiting, retrying and failed, each a
// link to those runs; its name, a link to its declaration. One owed nothing
// steps back.
let Handlers = ({ io, owed }: { io: Io; owed: Owed[] }) => {
  let of = (handler: string, rest: string) =>
    `.effect.handler=${handler}&${rest}&?effect`
  return h(
    Section,
    {},
    h(Section.Title, {}, 'By handler'),
    h(
      Section.Sub,
      {},
      'The runs each declared effect is owed. Retrying ones failed before and wait out their backoff; failed ones spent their tries and wait for a person.',
    ),
    owed.length
      ? h(
        Table,
        { cols: [null, 'num', 'num', 'num', 'num'] },
        heads(
          'handler',
          ['running', 'num'],
          ['waiting', 'num'],
          ['retrying', 'num'],
          ['failed', 'num'],
        ),
        h(
          Body,
          {},
          owed.map((o) =>
            h(
              Row,
              {
                key: o.handler,
                'data-handler': o.handler,
                mod: o.running + o.waiting + o.failed ? undefined : 'quiet',
              },
              h(
                Cell,
                {},
                h('a', { href: io.link(effectEid(o.handler)) }, o.handler),
              ),
              h(
                Cell,
                { mod: 'num' },
                count(io, o.running, of(o.handler, '.effect.lease_owner')),
              ),
              h(
                Cell,
                { mod: 'num' },
                count(
                  io,
                  o.waiting,
                  of(o.handler, '.effect.state=pending&!effect.lease_owner'),
                ),
              ),
              h(
                Cell,
                { mod: 'num' },
                count(
                  io,
                  o.retrying,
                  of(o.handler, '.effect.state=pending&.effect.error'),
                ),
              ),
              h(
                Cell,
                { mod: 'num' },
                count(io, o.failed, of(o.handler, '.effect.state=failed')),
              ),
            )
          ),
        ),
      )
      : h(Section.Sub, {}, 'Nothing is owed: every run has ended.'),
  )
}

let waiting = (got: Answer | undefined, what: string) =>
  got?.error
    ? h(Section.Sub, { role: 'alert' }, got.error)
    : !got?.ready
    ? h(Loading, {}, `Loading ${what}…`)
    : null

/** The page. */
export let EffectsPage = ({ got, io }: Props): JSX.Element => {
  let now = useNow()
  let seen = workers(got.workers?.rows ?? [], now)
  let up = seen.filter((s) => s.silent < QUIET)
  let owed = handlers({
    owed: got.owed?.tally,
    claimed: got.claimed?.tally,
    retrying: got.retrying?.tally,
    failed: got.failed?.tally,
  }, io.vocab.docs.flatMap((d) => effectsIn(d).map((x) => x.name)))
  let total = (k: 'waiting' | 'retrying' | 'failed') =>
    owed.reduce((n, o) => n + o[k], 0)
  let history = together(up.map((s) => s.w.history))
  let speed = rate(history)
  let running = up.reduce((n, s) => n + s.w.running, 0)
  let silent = seen.length - up.length
  let left = total('waiting'), retrying = total('retrying')
  let failed = total('failed')
  return h(
    'article',
    { 'data-effects': '' },
    h(
      Head,
      {},
      h(Head.Title, {}, 'Effects'),
      h(
        Head.Sub,
        {},
        'The work a write leaves behind, and the processes doing it: how many are up, how busy each is, what each is running and how fast runs end, then what waits behind them.',
      ),
    ),
    waiting(got.workers, 'the workers') ?? [
      h(
        Metrics,
        {},
        stat(
          String(up.length),
          up.length == 1 ? 'worker up' : 'workers up',
          !up.length && left ? 'negative' : undefined,
          silent ? `${silent} silent` : null,
        ),
        stat(String(running), 'running now'),
        stat(
          perSecond(speed),
          'runs a second',
          undefined,
          h(Spark, { values: history }),
        ),
        stat(
          left.toLocaleString('en-US'),
          'waiting',
          undefined,
          retrying ? `${retrying.toLocaleString('en-US')} retrying` : null,
        ),
        stat(
          failed.toLocaleString('en-US'),
          'failed',
          failed ? 'negative' : undefined,
        ),
      ),
      h(Workers, { io, seen, now }),
      h(Running, { io, up, now }),
    ],
    waiting(got.owed, 'what is owed') ?? h(Handlers, { io, owed }),
  )
}

/** The views this package draws. */
export let inspectViews: View[] = [
  { view: 'Effects.Page', match: true, asks, Render: EffectsPage },
]
