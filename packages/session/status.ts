// What a transcript is doing, read off its entries — never stored. The rule is
// written twice on purpose, once over bundles (for the daemon, @yaks/ram, and
// any code holding entries) and once as SQL (the `transcript.status` derived
// column @yaks/sqlite reads and filters through), and a test holds the two
// together. There is no third copy: a `status` column that had to be kept in
// sync is exactly what the old session comp was, and why its views disagreed.
//
// The newest entry decides:
//   input, result  → pending   the model is owed a turn
//   call           → running   a model or tool is owed an answer
//   output         → settled   nothing to do
//   stop           → stopped   nothing may be done
//   exception      → failed    the daemon could not continue past it
//   error          → failed once the last RETRIES entries are all errors,
//                    else pending (the daemon retries)
//   nothing        → empty

import type { Bundle, Comp } from '@yaks/graph'
import {
  CALL,
  ERROR,
  EXCEPTION,
  INPUT,
  OUTPUT,
  RESULT,
  STOP_ENTRY,
  USING,
} from './native.ts'

/** The kinds of entry, by the comp an entry wears beside `entry`. */
export type Kind =
  | 'input'
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
  [CALL, 'call'],
  [OUTPUT, 'output'],
  [RESULT, 'result'],
  [INPUT, 'input'],
]

/** Which kind of entry a bundle is, or `undefined` for one wearing none of the
 * kind comps. */
export let kindOf = (b: Bundle): Kind | undefined =>
  KINDS.find(([comp]) => comp in b)?.[1]

/** The seq of an entry bundle. */
export let seqOf = (b: Bundle): number => Number((b.entry as Comp)?.seq ?? 0)

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
  if (kind == 'call') return 'running'
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
 * (`storage(driver, vocab, { derived: nativeDerived })`), so `.transcript.status=running` compiles
 * through the index. `owner` is the SQL naming the session's integer id; a
 * reference column stores the referent's integer id, which is what `entry.session`
 * is compared against.
 */
export let transcriptStatus = {
  tag: 'text' as const,
  values: ['empty', 'pending', 'running', 'settled', 'stopped', 'failed'],
  deps: [] as string[],
  expr: (owner: string): string => {
    let newest = `(select e.entity from "entry" e where e."session" = ${owner}
      order by e.seq desc limit 1)`
    let wears = (comp: string) =>
      `exists (select 1 from "${comp}" k where k.entity = ${newest})`
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
      when ${wears(CALL)} then 'running'
      when ${wears(OUTPUT)} then 'settled'
      else 'pending' end`
  },
}

/** The derived-column registry a SQLite store loads to read `transcript.status`. */
export let nativeDerived = { 'transcript.status': transcriptStatus }
