// Transcript state from entry bundles alone. Rendering and in-memory readers
// share this pure logic without loading SQL derivations or tool execution.
import type { Bundle, Comp } from '@yaks/graph'
import {
  ASK,
  CALL,
  CONTENT,
  EXCEPTION,
  OUTPUT,
  REFUSAL,
  RESULT,
  STOP_ENTRY,
  USING,
} from './native.ts'

/** A request is in flight while a holder owns its attempt. */
export let attemptState = (ask: Bundle) =>
  ask.interrupted
    ? 'interrupted'
    : (ask.attempt as Comp | undefined)?.by != null
    ? 'inflight'
    : 'completed'

/** The kinds of entry: the component stored beside `entry`, or for prose,
 * `output` when an `output` is stored beside it and `input` when none is. */
export type Kind =
  | 'input'
  | 'ask'
  | 'call'
  | 'output'
  | 'result'
  | 'stop'
  | 'refusal'
  | 'interrupted'
  | 'exception'

/** What a transcript is doing. */
export type TranscriptStatus =
  | 'empty'
  | 'pending'
  | 'running'
  | 'settled'
  | 'stopped'
  | 'failed'

/** How many consecutive interrupted requests the runner retries through before it leaves a
 * transcript `failed`. */
export let RETRIES = 3

/** The error code of a request refused at a ceiling (a spending allowance, a
 * quota): final rather than retried, since the next ask meets the same
 * ceiling. The transcript is `failed` until something new is said to it. */
export let LIMIT = 'limit'

let KINDS: [string, Kind][] = [
  [STOP_ENTRY, 'stop'],
  [EXCEPTION, 'exception'],
  [REFUSAL, 'refusal'],
  [ASK, 'ask'],
  [CALL, 'call'],
  [RESULT, 'result'],
  ['interrupted', 'interrupted'],
]

let content = (b: Bundle) => b[CONTENT] as Comp | undefined

/** The ask an entry's prose came from, when a model returned it. */
export let sourceOf = (b: Bundle): string | undefined => {
  let s = (b[OUTPUT] as Comp | undefined)?.source
  return s == null ? undefined : String(s)
}

/** Which kind of entry a bundle is, or `undefined` for one carrying none of
 * the kind components and no prose. */
export let kindOf = (b: Bundle): Kind | undefined =>
  KINDS.find(([comp]) => comp in b)?.[1] ??
    (OUTPUT in b ? 'output' : content(b) ? 'input' : undefined)

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

/** The calls that no result answers — what the runner runs next, and what
 * keeps a transcript running past the prose the model returned beside them. */
export let openCalls = (entries: Bundle[]): Bundle[] => {
  let all = ordered(entries)
  let answered = new Set(
    all.filter((b) => kindOf(b) == 'result')
      .map((b) => String((b[RESULT] as Comp)?.call)),
  )
  return all.filter((b) => kindOf(b) == 'call' && !answered.has(b.entity.eid))
}

// An anonymous claim belongs to the process that made it. If that process
// vanished before answering, the session runner recovers it without replay.
let abandoned = (entries: Bundle[]): boolean =>
  openCalls(entries).some((b) => {
    let execution = b.execution as Comp | undefined
    return !!execution && execution.by == null && !b.interrupted
  })

/** A transcript the runner answers: one that asked it, by a request or a turn
 * it took. */
export let served = (entries: Bundle[]): boolean =>
  entries.some((b) => USING in b || ASK in b)

/** The transcripts a runner is working on: the ones the session cap counts
 * and a restart wakes. That is a transcript the runner answers ({@link served})
 * with something outstanding. An empty session has nothing to run, and one run
 * outside the graph reads `running` while its own runner owes the answer; a
 * graph holds thousands of both (every session a harness's hooks recorded).
 * Unlike `served`, a model chosen by a notice counts as asking. */
export let live =
  '.session.status=pending,running,queued (.entries.using|.entries.ask)'

/** The status of a transcript, from its entries in any order. */
export let statusOf = (entries: Bundle[], ended = false): TranscriptStatus => {
  if (ended) return 'stopped'
  let all = ordered(entries).filter((b) => !b.notice)
  let newest = all.at(-1)
  if (!newest) return 'empty'
  let kind = kindOf(newest)
  if (kind == 'stop') return 'stopped'
  let asked = newestAsk(all)
  let turn = all.filter((b) => !asked || seqOf(b) >= seqOf(asked))
  if (abandoned(turn)) return 'running'
  if (kind == 'exception') return 'failed'
  if (kind == 'interrupted' && newest.failed && !newest.ask && !newest.call) {
    return 'failed'
  }
  if (turn.some((b) => attemptState(b) == 'inflight')) {
    return 'running'
  }
  let afterAsk = (ask = newestAsk(all)) => {
    return ask && all.some((b) => seqOf(b) > seqOf(ask) && kindOf(b) == 'input')
      ? 'pending'
      : 'failed'
  }
  if (kind == 'refusal') {
    let source = (newest.output as Comp | undefined)?.source
    let ask = all.find((b) => b.entity.eid == source && kindOf(b) == 'ask')
    return ask ? afterAsk(ask) : 'failed'
  }
  let interrupted = newestAsk(all)
  if (interrupted?.interrupted) {
    if (
      interrupted.failed &&
      !all.some((b) => kindOf(b) == 'input' && seqOf(b) > seqOf(interrupted))
    ) return 'failed'
    if (
      all.some((b) => kindOf(b) == 'input' && seqOf(b) > seqOf(interrupted))
    ) {
      return 'pending'
    }
    if (interrupted.provisional) return 'pending'
    let turns = all.filter((b) => b.ask || kindOf(b) == 'input').slice(-RETRIES)
    return turns.length == RETRIES && turns.every((b) => b.ask && b.interrupted)
      ? 'failed'
      : 'pending'
  }
  if (openCalls(turn).length) return 'running'
  if (
    kind == 'ask' && attemptState(newest) == 'completed'
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
  return served(all) ? 'pending' : 'running'
}

/** The `using` in force at an entry: the newest one at or before it. */
export let usingBefore = (
  entries: Bundle[],
  seq = Infinity,
): Comp | undefined => {
  let all = ordered(entries).filter((b) => seqOf(b) <= seq && USING in b)
  let latest = all.at(-1)
  let ask = latest?.ask as Comp | undefined
  // An ask records what was served, not a choice: a selection made after that
  // ask's context boundary outlives a reply recorded late.
  let chosen = ask ? all.filter((b) => !b.ask).at(-1) : undefined
  let through = chosen &&
    entries.find((b) => b.entity.eid == ask!.through)
  return (chosen && (!through || seqOf(chosen) > seqOf(through))
    ? chosen
    : latest)?.[USING] as Comp | undefined
}
