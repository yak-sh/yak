// Transcript state from entry bundles alone. Rendering and in-memory readers
// share this pure logic without loading SQL derivations or tool execution.
import type { Bundle, Comp } from '@yaks/graph'
import type { Computed } from '@yaks/match'
import { cachedPrefixExpires } from '@yaks/model'
import { stoppedNotice } from './claude-control.ts'
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
export let attemptState = (
  ask: Bundle,
): 'interrupted' | 'inflight' | 'completed' =>
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

// A result is a result even when it carries the refusal that answered its
// call.
let KINDS: [string, Kind][] = [
  [STOP_ENTRY, 'stop'],
  [RESULT, 'result'],
  ['tool_progress', 'result'],
  [EXCEPTION, 'exception'],
  [REFUSAL, 'refusal'],
  [ASK, 'ask'],
  [CALL, 'call'],
  ['interrupted', 'interrupted'],
]

/** The components that make an entry a kind ranked before `kind`
 * ({@link kindOf}), whatever else it carries: a stop naming the request it
 * answers (`ask.through`) is a stop, not an ask. */
export let outranking = (kind: Kind): string[] =>
  KINDS.slice(0, KINDS.findIndex(([, k]) => k == kind)).map(([c]) => c)

let content = (b: Bundle) => b[CONTENT] as Comp | undefined

/** The ask an entry's prose came from, when a model returned it. */
export let sourceOf = (b: Bundle): string | undefined => {
  let s = (b[OUTPUT] as Comp | undefined)?.source
  return s == null ? undefined : String(s)
}

/** Which kind of entry a bundle is, or `undefined` for one carrying none of
 * the kind components and no prose. */
export let kindOf = (b: Bundle): Kind | undefined =>
  stoppedNotice(b) ? 'stop' : KINDS.find(([comp]) => comp in b)?.[1] ??
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
  ordered(entries).findLast((b) => kindOf(b) == 'ask')

// When the prefix a session's newest ask cached leaves its provider's prompt
// cache (its provider component's `cache_expires_at`, @yaks/model
// `cachedPrefixExpires`). Unknown for an ask of another transcript, one not
// answered, or one whose provider records no expiry.
let expiry = (entries: Bundle[], session: string): number | undefined => {
  let ask = newestAsk(entries)
  if (!ask || (ask.entry as Comp | undefined)?.session != session) return
  let expires = cachedPrefixExpires(ask)
  return expires ? Date.parse(expires) : undefined
}

/** The instructions a session's newest ask sent, while the prefix it cached
 * is still in the provider's prompt cache. An ask whose expiry is unknown
 * keeps none. */
export let cachedInstructions = (
  entries: Bundle[],
  session: string,
  now: number = Date.now(),
): string | undefined => {
  let said = (newestAsk(entries)?.sending as Comp | undefined)?.instructions
  return (expiry(entries, session) ?? -Infinity) > now &&
      typeof said == 'string'
    ? said
    : undefined
}

/** Whether the prefix a session's newest ask cached is known to have expired,
 * so the next request pays for its whole context whatever it sends. An
 * unknown expiry is not cold: nothing says the cache is gone. */
export let cold = (
  entries: Bundle[],
  session: string,
  now: number = Date.now(),
): boolean => (expiry(entries, session) ?? Infinity) <= now

let callsIn = (all: Bundle[]): Bundle[] => {
  let answered = new Set(
    all.filter((b) => RESULT in b)
      .map((b) => String((b[RESULT] as Comp)?.call)),
  )
  return all.filter((b) => kindOf(b) == 'call' && !answered.has(b.entity.eid))
}

/** The calls that no result answers — what the runner runs next, and what
 * keeps a transcript running past the prose the model returned beside them. */
export let openCalls = (entries: Bundle[]): Bundle[] =>
  callsIn(ordered(entries))

/** Whether something new has arrived beyond the newest request's context
 * boundary for the model to take a turn on. An input asks at once. A result,
 * or the Pending entry a call of the newest reply is given when it outlasts
 * its patience (./react.ts `PATIENCE`), asks once each background call of that
 * reply has answered or outlasted it: the model asked for them together. A
 * background call alone asks nothing more of the model, and the Pending of an
 * older reply's call never asks again: a later request already sent it as
 * pending. This says the model owes work independently of tools running. */
export let modelReady = (entries: Bundle[]): boolean => {
  let all = ordered(entries).filter((b) => !b.notice)
  let ask = newestAsk(all)
  let through = all.find((b) =>
    b.entity.eid == (ask?.ask as Comp | undefined)?.through
  )
  let boundary = through ? seqOf(through) : ask ? seqOf(ask) : 0
  let reply = all.filter((b) =>
    !!ask && !!b.tool_async &&
    (b.call as Comp | undefined)?.source == ask.entity.eid
  )
  let calls = new Set(reply.map((b) => b.entity.eid))
  let heard = new Set(all.flatMap((b) => {
    let call = (b.result as Comp | undefined)?.call ??
      (b.tool_progress as Comp | undefined)?.call
    return call == null ? [] : [String(call)]
  }))
  let together = reply.every((b) => heard.has(b.entity.eid))
  return all.some((b) =>
    seqOf(b) > boundary && (
      kindOf(b) == 'input' || together && (
          !!b.result ||
          !!b.tool_progress && calls.has(String((b.tool_progress as Comp).call))
        )
    )
  )
}

// An anonymous claim belongs to the process that made it. If that process
// vanished before answering, the session runner recovers it without replay.
let abandoned = (calls: Bundle[]): boolean =>
  calls.some((b) => {
    let execution = b.execution as Comp | undefined
    return !!execution && execution.by == null && !b.interrupted
  })

/** A transcript the runner answers: one that asked it, by a request or a turn
 * it took. A turn read from a harness's file (`lines`) is that harness's, which
 * answers its own transcript. */
export let served = (entries: Bundle[]): boolean =>
  entries.some((b) => USING in b || (ASK in b && !('lines' in b)))

/** The transcripts a runner is working on: the ones the session cap counts
 * and a restart wakes. That is a transcript the runner answers ({@link served})
 * with something outstanding. An empty session has nothing to run, and one run
 * outside the graph reads `running` while its own runner owes the answer; a
 * graph holds thousands of both (every session a harness's hooks recorded).
 * Unlike `served`, a model chosen by a notice counts as asking. */
export let live =
  '.session.status=pending,running,queued (.entries.using|.entries.ask)'

/** What the entries leave owing. `session.ended` turns only these into `stopped`:
 * a transcript that settled, failed or never began keeps reading that way. */
export let UNFINISHED = ['pending', 'running', 'queued']

/** What a session's own row says beside its entries: `ended`, its
 * `session.ended` mark, and `process`, a process of its own running it (a
 * @yaks/process `process` with no `exit` yet, as a spawned CLI run wears). */
export type Marks = { ended?: boolean; process?: boolean }

/** The {@link Marks} a session row wears. */
export let marksOf = (row: Bundle | undefined): Marks => ({
  ended: (row?.session as Comp | undefined)?.ended == true,
  process: !!row?.process && row.exit == null,
})

/** The status of a transcript, from its entries in any order and the marks
 * its row wears. A process of its own owes whatever the entries leave owing,
 * so it reads `running` where they say `pending`, never the runner's to
 * answer; once it exits, its ending (@yaks/spawn) is an entry like any. */
export let statusOf = (
  entries: Bundle[],
  { ended = false, process = false }: Marks = {},
): TranscriptStatus => {
  let status = entriesSay(entries)
  if (ended && UNFINISHED.includes(status)) return 'stopped'
  return process && status == 'pending' ? 'running' : status
}

let entriesSay = (entries: Bundle[]): TranscriptStatus => {
  let all = ordered(entries).filter((b) => !b.notice || stoppedNotice(b))
  let newest = all.at(-1)
  if (!newest) return 'empty'
  let kind = kindOf(newest)
  // Finishing a step already admitted before a stop does not resume work.
  // Only fresh input can reopen the transcript.
  let control = all.findLast((b) => ['input', 'stop'].includes(kindOf(b) ?? ''))
  if (kindOf(control ?? newest) == 'stop') return 'stopped'
  let asked = all.findLast((b) => kindOf(b) == 'ask')
  let turn = all.filter((b) => !asked || seqOf(b) >= seqOf(asked))
  // A background call's Pending answers the provider protocol, but only its
  // result answers the work. Unlike legacy synchronous calls, background calls
  // can outlive many asks, and asks while they run only for something new.
  let calls = callsIn(turn).filter((b) => !b.tool_async)
  let pending = callsIn(all).some((b) => b.tool_async)
  let background = all.some((b) => b.call && b.tool_async)
  if (abandoned(calls)) return 'running'
  if (kind == 'exception') return 'failed'
  if (kind == 'interrupted' && newest.failed && !newest.ask && !newest.call) {
    return 'failed'
  }
  if (turn.some((b) => attemptState(b) == 'inflight')) {
    return 'running'
  }
  let afterAsk = (ask = asked) => {
    return ask && all.some((b) => seqOf(b) > seqOf(ask) && kindOf(b) == 'input')
      ? 'pending'
      : 'failed'
  }
  if (kind == 'refusal') {
    let source = (newest.output as Comp | undefined)?.source
    let ask = all.find((b) => b.entity.eid == source && kindOf(b) == 'ask')
    return ask ? afterAsk(ask) : 'failed'
  }
  let interrupted = asked
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
  if (calls.length) return 'running'
  if (background && modelReady(all)) return 'pending'
  if (pending) return 'running'
  // An ask with no attempt is a line a harness wrote before the rest of its
  // reply: the turn runs on.
  if (
    kind == 'ask' && newest.attempt && attemptState(newest) == 'completed'
  ) return 'settled'
  if (kind == 'ask' || kind == 'call') return 'running'
  // Inputs can be admitted while a provider request is in flight. Its reply
  // does not acknowledge messages after that request's recorded boundary.
  if (kind == 'output') {
    let ask = asked
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

/** `session.status` for an in-memory store (@yaks/ram's `computed`): the rule
 * above over the session's entries, as @yaks/sqlite derives it (./status.ts),
 * so a query filtering on it answers alike in both. */
export let statusComputed: Computed = {
  'session.status': (s, among) =>
    statusOf(
      among.list.filter((b) =>
        (b.entry as Comp | undefined)?.session == s.entity.eid
      ),
      marksOf(s),
    ),
}

/** A selected aspect at an entry, with late ask records bounded by their prefix. */
let aspectBefore = (
  entries: Bundle[],
  name: string,
  seq = Infinity,
): Comp | undefined => {
  let all = ordered(entries).filter((b) => seqOf(b) <= seq && name in b)
  let latest = all.at(-1)
  let ask = latest?.ask as Comp | undefined
  // An ask records what was served, not a choice: a selection made after that
  // ask's context boundary outlives a reply recorded late.
  let chosen = ask ? all.filter((b) => !b.ask).at(-1) : undefined
  let through = chosen &&
    entries.find((b) => b.entity.eid == ask!.through)
  return (chosen && (!through || seqOf(chosen) > seqOf(through))
    ? chosen
    : latest)?.[name] as Comp | undefined
}

/** What a transcript's lines selected to send, apart from what its asks
 * recorded as sent: the `sending` of its newest line that is no ask. */
export let sendingSelected = (entries: Bundle[]): Comp | undefined =>
  ordered(entries).findLast((b) => 'sending' in b && !b.ask)?.sending as
    | Comp
    | undefined

/** The model selection in force at an entry: provider, model and effort. Why
 * a router chose it (`using.why`) stays on the input it answered, so no ask,
 * later input or child repeats a reason the plans have since outgrown. */
export let usingBefore = (
  entries: Bundle[],
  seq = Infinity,
): Comp | undefined => {
  let using = aspectBefore(entries, USING, seq)
  if (!using) return undefined
  let { why: _, ...selection } = using
  return selection
}

/** What is sent, selected independently of who answers. */
export let sendingBefore = (
  entries: Bundle[],
  seq = Infinity,
): Comp | undefined => aspectBefore(entries, 'sending', seq)
