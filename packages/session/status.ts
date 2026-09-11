// What a transcript is doing, read off its entries — never stored. The rule is
// written twice on purpose, once over bundles (for the daemon, @yaks/ram, and
// any code holding entries) and once as SQL (the `session.status` derived
// column @yaks/sqlite reads and filters through), and a test holds the two
// together. There is no third copy: a `status` column that had to be kept in
// sync is exactly what the old session comp was, and why its views disagreed.
//
// Settled means NOTHING IS OWED. The newest entry says most of it, but not all:
// a model that says something before it calls a tool leaves an `output` newest
// in the middle of its turn, and reading that alone ended a run 14 minutes
// early (T-35230). So an open call — one the newest ask asked for that no
// result answers — outranks the newest entry, and it is the same set `react`
// performs next, so the word and the step cannot disagree.
//   an open call  → running   a tool is owed an answer, whatever landed after
//   input, result → pending   the model is owed a turn
//   ask, call     → running   a model or a tool is owed an answer
//   output        → settled   the turn returned prose and asked for nothing
//   stop          → stopped   nothing may be done
//   exception     → failed    the daemon could not continue past it
//   error         → failed once the last RETRIES entries are all errors,
//                   else pending (the daemon retries)
//   nothing       → empty
//
// A turn lands as ONE batch — the ask, the prose, and the calls together — so
// no reader ever sees the prose without the calls that came with it.
//
// There is no `input` or `output` comp. Prose is `content{body}`; alone it is
// an input, with a `source` (the ask it came from) it is what a model said.
// A result, error or exception carries its prose the same way and is itself.

import type { Bundle, Comp } from '@yaks/graph'
import {
  ASK,
  CALL,
  CONTENT,
  ERROR,
  EXCEPTION,
  RESULT,
  STOP_ENTRY,
  USING,
} from './native.ts'

/** The kinds of entry: the comp an entry wears beside `entry`, or for prose,
 * `input` without a source and `output` with one. */
export type Kind =
  | 'input'
  | 'ask'
  | 'call'
  | 'output'
  | 'result'
  | 'stop'
  | 'error'
  | 'exception'

/** What a transcript is doing. */
export type TranscriptStatus =
  | 'empty'
  | 'pending'
  | 'running'
  | 'settled'
  | 'stopped'
  | 'failed'

/** How many consecutive errors the daemon retries through before it leaves a
 * transcript `failed`. */
export let RETRIES = 3

let KINDS: [string, Kind][] = [
  [STOP_ENTRY, 'stop'],
  [EXCEPTION, 'exception'],
  [ERROR, 'error'],
  [ASK, 'ask'],
  [CALL, 'call'],
  [RESULT, 'result'],
]

let content = (b: Bundle) => b[CONTENT] as Comp | undefined

/** The ask an entry's prose came from, when a model said it. */
export let sourceOf = (b: Bundle): string | undefined => {
  let s = content(b)?.source
  return s == null ? undefined : String(s)
}

/** Which kind of entry a bundle is, or `undefined` for one wearing none of the
 * kind comps and carrying no prose. */
export let kindOf = (b: Bundle): Kind | undefined =>
  KINDS.find(([comp]) => comp in b)?.[1] ??
    (content(b) ? sourceOf(b) ? 'output' : 'input' : undefined)

/** The seq of an entry bundle. */
export let seqOf = (b: Bundle): number => Number((b.entry as Comp)?.seq ?? 0)

/** The prose of an entry: its `content.body`, or nothing. */
export let textOf = (b: Bundle): string => String(content(b)?.body ?? '')

/** Entries in transcript order. */
export let ordered = (entries: Bundle[]): Bundle[] =>
  entries.toSorted((a, b) => seqOf(a) - seqOf(b))

/** The newest `ask` of a transcript: the model turn in force. */
export let newestAsk = (entries: Bundle[]): Bundle | undefined =>
  ordered(entries).filter((b) => kindOf(b) == 'ask').at(-1)

/** The calls that no result answers — what the daemon
 * performs next, and what keeps a transcript running past the prose the model
 * said beside them. */
export let openCalls = (entries: Bundle[]): Bundle[] => {
  let all = ordered(entries)
  let answered = new Set(
    all.filter((b) => kindOf(b) == 'result')
      .map((b) => String((b[RESULT] as Comp)?.call)),
  )
  return all.filter((b) => kindOf(b) == 'call' && !answered.has(b.entity.eid))
}

/** The status of a transcript, from its entries in any order. */
export let statusOf = (entries: Bundle[]): TranscriptStatus => {
  let all = ordered(entries).filter((b) => !b.notice)
  let newest = all.at(-1)
  if (!newest) return 'empty'
  let kind = kindOf(newest)
  if (kind == 'stop') return 'stopped'
  if (kind == 'exception') return 'failed'
  if (all.some((b) => (b.attempt as Comp | undefined)?.state == 'inflight')) {
    return 'running'
  }
  if (kind == 'error' && (newest.error as Comp)?.code == 'interrupted') {
    const ask = newestAsk(all)
    return ask && all.some((b) => seqOf(b) > seqOf(ask) && kindOf(b) == 'input')
      ? 'pending'
      : 'settled'
  }
  if (kind == 'error') {
    // failed once the last RETRIES entries are all errors
    let tail = all.slice(-RETRIES)
    return tail.length == RETRIES && tail.every((b) => kindOf(b) == 'error')
      ? 'failed'
      : 'pending'
  }
  if (openCalls(all).length) return 'running'
  if (
    kind == 'ask' && (newest.attempt as Comp | undefined)?.state == 'completed'
  ) return 'settled'
  if (kind == 'ask' || kind == 'call') return 'running'
  // Inputs can be admitted while a provider request is in flight. Its reply
  // does not acknowledge messages after that request's recorded boundary.
  if (kind == 'output') {
    let ask = newestAsk(all)
    let through = all.find((b) => b.entity.eid == (ask?.ask as Comp)?.through)
    if (
      through && all.some((b) =>
        seqOf(b) > seqOf(through) &&
        kindOf(b) == 'input'
      )
    ) return 'pending'
    return 'settled'
  }
  return 'pending'
}

/** The `using` in force at an entry: the newest one at or before it. */
export let usingBefore = (
  entries: Bundle[],
  seq = Infinity,
): Comp | undefined =>
  ordered(entries).filter((b) => seqOf(b) <= seq && USING in b)
    .at(-1)?.[USING] as Comp | undefined

/**
 * The same rule as SQL, for @yaks/sqlite's derived-column registry
 * (`storage(driver, vocab, { derived: sessionDerived })`), so
 * `.session.status=running` compiles through the index. `owner` is the SQL
 * naming the session's integer id; a reference column stores the referent's
 * integer id, which is what `entry.session` is compared against.
 */
export let sessionStatus = {
  tag: 'text' as const,
  values: [
    'empty',
    'pending',
    'running',
    'queued',
    'settled',
    'stopped',
    'failed',
  ],
  deps: [] as string[],
  expr: (owner: string): string => {
    let newest = `(select e.entity from "entry" e where e."session" = ${owner}
      and not exists (select 1 from "notice" n where n.entity = e.entity)
      order by e.seq desc limit 1)`
    let wears = (comp: string, and = '') =>
      `exists (select 1 from "${comp}" k where k.entity = ${newest}${and})`
    let seq = `(select e.seq from "entry" e where e.entity = ${newest})`
    let allErrors = `(select count(*) from "entry" e2
      where e2."session" = ${owner} and e2.seq > ${seq} - ${RETRIES}
        and exists (select 1 from "error" x where x.entity = e2.entity)) = ${RETRIES}`
    // The newest ask, and whether a call it made is still unanswered — the
    // openCalls rule above, said in SQL.
    let ask = `(select e.entity from "entry" e where e."session" = ${owner}
      and exists (select 1 from "${ASK}" a where a.entity = e.entity)
      order by e.seq desc limit 1)`
    let open = `exists (select 1 from "${CALL}" c
      join "entry" e on e.entity = c.entity
      where e."session" = ${owner} and c."source" = ${ask}
        and not exists (
          select 1 from "${RESULT}" r where r."call" = c.entity))`
    let unread = `exists (select 1 from "entry" u
      join "content" uc on uc.entity = u.entity
      where u."session" = ${owner} and uc."source" is null
        and u.seq > (select boundary.seq from "ask" a
          join "entry" boundary on boundary.entity = a."through"
          where a.entity = ${ask})
        and not exists (select 1 from "notice" n where n.entity = u.entity)
        and not exists (select 1 from "result" r where r.entity = u.entity)
        and not exists (select 1 from "error" r where r.entity = u.entity)
        and not exists (select 1 from "exception" r where r.entity = u.entity)
        and not exists (select 1 from "ask" r where r.entity = u.entity)
        and not exists (select 1 from "call" r where r.entity = u.entity)
        and not exists (select 1 from "stop" r where r.entity = u.entity))`
    return `case
      when ${newest} is null then 'empty'
      when ${wears(STOP_ENTRY)} then 'stopped'
      when ${wears(EXCEPTION)} then 'failed'
      when exists (select 1 from attempt a join entry e on e.entity = a.entity where e.session = ${owner} and a.state = 'inflight') then 'running'
      when exists (select 1 from dispatch d where d.entity = ${owner} and d.state = 'queued') then 'queued'
      when ${wears(ERROR, " and k.code = 'interrupted'")} then case
        when exists (select 1 from entry u join content c on c.entity = u.entity
          where u.session = ${owner} and u.seq > (select seq from entry where entity = ${ask})
          and c.source is null
          and not exists (select 1 from notice n where n.entity = u.entity)
          and not exists (select 1 from error n where n.entity = u.entity)
          and not exists (select 1 from exception n where n.entity = u.entity)
          and not exists (select 1 from result n where n.entity = u.entity)
          and not exists (select 1 from ask n where n.entity = u.entity)
          and not exists (select 1 from call n where n.entity = u.entity)
          and not exists (select 1 from stop n where n.entity = u.entity))
        then 'pending' else 'settled' end
      when ${
      wears(ERROR)
    } then case when ${allErrors} then 'failed' else 'pending' end
      when ${open} then 'running'
      when ${
      wears(ASK)
    } and exists (select 1 from attempt a where a.entity = ${newest} and a.state = 'completed') then 'settled'
      when ${wears(ASK)} or ${wears(CALL)} then 'running'
      when ${wears(RESULT)} then 'pending'
      when ${wears(CONTENT, ' and k."source" is not null')} then
        case when ${unread} then 'pending' else 'settled' end
      else 'pending' end`
  },
}

/** The derived-column registry a SQLite store loads to read `session.status`. */
export let sessionDerived = { 'session.status': sessionStatus }
