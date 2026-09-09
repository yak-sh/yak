// What a transcript is doing, read off its entries — never stored. The rule is
// written twice on purpose, once over bundles (for the daemon, @yaks/ram, and
// any code holding entries) and once as SQL (the `session.status` derived
// column @yaks/sqlite reads and filters through), and a test holds the two
// together. There is no third copy: a `status` column that had to be kept in
// sync is exactly what the old session comp was, and why its views disagreed.
//
// The newest entry decides. Settled means nothing is owed: no input without an
// ask after it, no ask or call without its answer — which, read off a
// transcript in order, is "the newest entry is what a model said".
//   input, result  → pending   the model is owed a turn
//   ask, call      → running   a model or a tool is owed an answer
//   output         → settled   nothing to do
//   stop           → stopped   nothing may be done
//   exception      → failed    the daemon could not continue past it
//   error          → failed once the last RETRIES entries are all errors,
//                    else pending (the daemon retries)
//   nothing        → empty
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

/** The status of a transcript, from its entries in any order. */
export let statusOf = (entries: Bundle[]): TranscriptStatus => {
  let all = ordered(entries)
  let newest = all.at(-1)
  if (!newest) return 'empty'
  let kind = kindOf(newest)
  if (kind == 'input' || kind == 'result') return 'pending'
  if (kind == 'ask' || kind == 'call') return 'running'
  if (kind == 'output') return 'settled'
  if (kind == 'stop') return 'stopped'
  if (kind == 'exception') return 'failed'
  // error: failed once the last RETRIES entries are all errors
  let tail = all.slice(-RETRIES)
  return tail.length == RETRIES && tail.every((b) => kindOf(b) == 'error')
    ? 'failed'
    : 'pending'
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
  values: ['empty', 'pending', 'running', 'settled', 'stopped', 'failed'],
  deps: [] as string[],
  expr: (owner: string): string => {
    let newest = `(select e.entity from "entry" e where e."session" = ${owner}
      order by e.seq desc limit 1)`
    let wears = (comp: string, and = '') =>
      `exists (select 1 from "${comp}" k where k.entity = ${newest}${and})`
    let seq = `(select e.seq from "entry" e where e.entity = ${newest})`
    let allErrors = `(select count(*) from "entry" e2
      where e2."session" = ${owner} and e2.seq > ${seq} - ${RETRIES}
        and exists (select 1 from "error" x where x.entity = e2.entity)) = ${RETRIES}`
    return `case
      when ${newest} is null then 'empty'
      when ${wears(STOP_ENTRY)} then 'stopped'
      when ${wears(EXCEPTION)} then 'failed'
      when ${
      wears(ERROR)
    } then case when ${allErrors} then 'failed' else 'pending' end
      when ${wears(ASK)} or ${wears(CALL)} then 'running'
      when ${wears(RESULT)} then 'pending'
      when ${wears(CONTENT, ' and k."source" is not null')} then 'settled'
      else 'pending' end`
  },
}

/** The derived-column registry a SQLite store loads to read `session.status`. */
export let sessionDerived = { 'session.status': sessionStatus }
