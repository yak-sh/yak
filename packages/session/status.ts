// What a transcript is doing, computed from its entries — never stored. The
// rule is written twice on purpose, once over bundles (for the runner,
// @yaks/ram, and any code holding entries) and once as SQL (the
// `session.status` derived property @yaks/sqlite reads and filters through),
// and a test holds the two together. There is no third copy: a stored `status`
// property that had to be kept in sync is exactly what the old session
// component was, and why its views disagreed.
//
// Settled means nothing is outstanding. The newest entry covers most of it, but
// not all: a model that returns prose before it calls a tool leaves an `output`
// as the newest entry in the middle of its turn, and reading that alone ended a
// run 14 minutes early (T-35230). So an open call — one the newest ask made
// that no result answers — outranks the newest entry, and it is the same set
// `react` runs next, so the status and the step cannot disagree.
//   an open call  → running   a tool owes an answer, whatever landed after
//   input, result → pending   the model owes a turn
//   ask, call     → running   a model or a tool owes an answer
//   output        → settled   the turn returned prose and asked for nothing
//   stop          → stopped   nothing may be done
//   exception     → failed    the runner could not continue past it
//   refusal       → failed    a deliberate no, until new input
// `pending` is the runner's to answer (./run.ts), and it answers only a
// transcript that asked it: one carrying a `using` (its request) or an `ask`
// (a turn it took). One with neither is run outside the graph — a harness's
// session its hooks record, a run from before the runner — so its newest input
// is owed by whatever runs it: running, never pending, which the runner would
// answer with no model to ask.
//
// A turn lands as one batch — the ask, the prose, and the calls together — so
// no reader ever sees the prose without the calls that came with it.
//
// Prose is `content{body}`; alone it is an input, and an `output{source}`
// beside it records what produced it — the ask, for what a model returned. A
// result, refusal or exception carries its prose the same way and is its own
// kind.

import type { Bundle, Comp } from '@yaks/graph'
import {
  and,
  as,
  col,
  desc,
  eq,
  exists,
  type Expr,
  fn,
  from,
  ge,
  gt,
  iff,
  isNull,
  join,
  lit,
  not,
  or,
  select,
  sub,
  table,
  when,
} from '@yaks/sql'
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
import { attemptDerived, attemptState } from './attempt.ts'
import { executionDerived } from '@yaks/tools'
import { sessionCost } from './cost.ts'
import { COST } from '@yaks/model'
import type { Derived } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'

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
  if (abandoned(all)) return 'running'
  if (kind == 'exception') return 'failed'
  if (kind == 'interrupted' && newest.failed && !newest.ask && !newest.call) {
    return 'failed'
  }
  if (all.some((b) => attemptState(b) == 'inflight')) {
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
  if (openCalls(all).length) return 'running'
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

// Old servers still write state during the marks expansion. A non-null state
// wins until cutover; otherwise waiting precedes admitted in the declared ladder.
export let dispatchStatus = {
  tag: 'text' as const,
  values: ['queued', 'active', 'waiting', 'settled'],
  deps: ['dispatch', 'waiting', 'admitted'],
  expr: (owner: Expr, marks = ['waiting', 'admitted']): Expr => {
    let marked = (comp: string) =>
      exists(select({
        cols: [lit(1)],
        from: table(comp, 'm'),
        where: eq(col('entity', 'm'), owner),
      }))
    let rungs: [Expr, Expr][] = marks.map((comp) => [
      marked(comp),
      lit(comp == 'waiting' ? 'waiting' : 'active'),
    ])
    let status = rungs.length ? when(rungs, lit('queued')) : lit('queued')
    return sub(select({
      cols: [fn('coalesce', col('state', 'd'), status)],
      from: table('dispatch', 'd'),
      where: eq(col('entity', 'd'), owner),
    }))
  },
}

/**
 * The same rule as SQL, for @yaks/sqlite's derived-property registry
 * (`storage(driver, vocab, { derived: sessionDerived(vocab) })`), so
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
  deps: ['session'],
  expr: (
    owner: Expr,
    dispatch = dispatchStatus,
    states: Derived = {},
    declared: (name: string) => boolean = () => true,
  ): Expr => {
    let state = (name: string, alias: string) =>
      states[`${name}.state`]?.expr(col('entity', alias)) ?? col('state', alias)
    // Whether the entity `of` wears `comp` (and `also` holds of that row, `k`).
    let has = (comp: string, of: Expr, also?: Expr) =>
      declared(comp)
        ? exists(select({
          cols: [lit(1)],
          from: table(comp, 'k'),
          where: and(eq(col('entity', 'k'), of), ...(also ? [also] : [])),
        }))
        : lit(false)
    let lacks = (comp: string, of: Expr) => not(has(comp, of))
    // The newest entry is the row the verdict below reads, `n`, so each
    // branch looks at it without finding it again.
    let n = col('entity', 'n')
    let wears = (comp: string, also?: Expr) => has(comp, n, also)
    let mine = (e: string) => eq(col('session', e), owner)
    // Start at this transcript's indexed entries. These checks also run when
    // one session is read by eid, so scanning every call in the store for each
    // such read multiplies the cost of an unrelated transcript.
    let entries = (also: Expr) =>
      exists(select({
        cols: [lit(1)],
        from: table('entry', 'e'),
        where: and(mine('e'), also),
      }))
    let calls = (also: Expr) =>
      entries(exists(select({
        cols: [lit(1)],
        from: table(CALL, 'c'),
        where: and(eq(col('entity', 'c'), col('entity', 'e')), also),
      })))
    let unanswered = not(exists(select({
      cols: [lit(1)],
      from: table(RESULT, 'r'),
      where: eq(col('call', 'r'), col('entity', 'c')),
    })))
    let inflight = entries(has(
      'attempt',
      col('entity', 'e'),
      eq(state('attempt', 'k'), lit('inflight')),
    ))
    let open = calls(unanswered)
    let abandoned = calls(and(
      lacks('interrupted', col('entity', 'c')),
      has(
        'execution',
        col('entity', 'c'),
        and(
          isNull(col('by', 'k')),
        ),
      ),
      unanswered,
    ))
    // The newest ask.
    let ask = sub(select({
      cols: [col('entity', 'e')],
      from: table('entry', 'e'),
      where: and(mine('e'), has(ASK, col('entity', 'e'))),
      order: [desc(col('seq', 'e'))],
      limit: lit(1),
    }))
    // An input entry after `seq`: prose that is none of the other kinds.
    let input = (seq: Expr) =>
      exists(select({
        cols: [lit(1)],
        from: table('entry', 'u'),
        joins: [
          join(
            table('content', 'uc'),
            eq(col('entity', 'uc'), col('entity', 'u')),
          ),
        ],
        where: and(
          mine('u'),
          gt(col('seq', 'u'), seq),
          ...[
            'output',
            'notice',
            'result',
            'refusal',
            'exception',
            'ask',
            'call',
            'stop',
          ].map((c) => lacks(c, col('entity', 'u'))),
        ),
      }))
    let unread = input(sub(select({
      cols: [col('seq', 'boundary')],
      from: table('ask', 'a'),
      joins: [
        join(
          table('entry', 'boundary'),
          eq(col('entity', 'boundary'), col('through', 'a')),
        ),
      ],
      where: eq(col('entity', 'a'), ask),
    })))
    // `served` above: the transcript asked the runner, by a request or a turn
    // it took.
    let served = exists(select({
      cols: [lit(1)],
      from: table('entry', 's'),
      where: and(
        mine('s'),
        lacks('notice', col('entity', 's')),
        or(has(USING, col('entity', 's')), has(ASK, col('entity', 's'))),
      ),
    }))
    let owed = iff(served, lit('pending'), lit('running'))
    let queued = eq(dispatch.expr(owner), lit('queued'))
    let settled = exists(select({
      cols: [lit(1)],
      from: table('attempt', 'a'),
      where: and(
        eq(col('entity', 'a'), n),
        eq(state('attempt', 'a'), lit('completed')),
      ),
    }))
    let asked = sub(select({
      cols: [col('seq')],
      from: table('entry'),
      where: eq(col('entity'), ask),
    }))
    // Provider refusals name their ask; compaction and no-model refusals do
    // not. Only input arriving after the associated ask still needs an answer.
    let refusedAsk = sub(select({
      cols: [col('seq', 'r')],
      from: table('output', 'ro'),
      joins: [
        join(table('entry', 'r'), eq(col('entity', 'r'), col('source', 'ro'))),
      ],
      where: and(
        eq(col('entity', 'ro'), n),
        mine('r'),
        has(ASK, col('entity', 'r')),
      ),
    }))
    let interruptions = sub(select({
      cols: [fn('count', lit(1))],
      from: from(
        select({
          cols: [col('entity', 'a'), col('seq', 'a')],
          from: table('entry', 'a'),
          where: and(
            mine('a'),
            lacks('notice', col('entity', 'a')),
            has(ASK, col('entity', 'a')),
          ),
          order: [desc(col('seq', 'a'))],
          limit: lit(RETRIES),
        }),
        'recent',
      ),
      where: and(
        has('interrupted', col('entity', 'recent')),
        not(input(col('seq', 'recent'))),
      ),
    }))
    // What the newest entry, `n`, says the transcript is doing.
    let verdict = when(
      [
        [wears(STOP_ENTRY), lit('stopped')],
        [abandoned, lit('running')],
        [wears(EXCEPTION), lit('failed')],
        [
          and(
            wears('interrupted'),
            wears('failed'),
            not(wears(ASK)),
            not(wears(CALL)),
          ),
          lit('failed'),
        ],
        [inflight, lit('running')],
        [queued, lit('queued')],
        [wears(REFUSAL), iff(input(refusedAsk), lit('pending'), lit('failed'))],
        [
          and(has('interrupted', ask), has('failed', ask), not(input(asked))),
          lit('failed'),
        ],
        [and(has('interrupted', ask), has('provisional', ask)), lit('pending')],
        [
          has('interrupted', ask),
          iff(ge(interruptions, lit(RETRIES)), lit('failed'), lit('pending')),
        ],
        [open, lit('running')],
        [and(wears(ASK), settled), lit('settled')],
        [or(wears(ASK), wears(CALL)), lit('running')],
        [wears(RESULT), owed],
        [wears(OUTPUT), iff(unread, lit('pending'), lit('settled'))],
      ],
      owed,
    )
    // SQLite charges an expression on top of every expression enclosing it,
    // and workerd refuses a statement past 100 deep (SQLITE_LIMIT_EXPR_DEPTH).
    // A FROM subquery is no part of the height of the expression it sits in,
    // so the verdict is read out of one, which leaves room for a query that
    // nests this status inside another select, as an alternation's union does.
    let newest = select({
      cols: [as(verdict, 'v')],
      from: table('entry', 'n'),
      where: and(mine('n'), lacks('notice', n)),
      order: [desc(col('seq', 'n'))],
      limit: lit(1),
    })
    return iff(
      has('session', owner, eq(col('ended', 'k'), lit(true))),
      lit('stopped'),
      fn(
        'coalesce',
        sub(select({ cols: [col('v', 'x')], from: from(newest, 'x') })),
        lit('empty'),
      ),
    )
  },
}

/** The derived-property registry a SQLite store loads to read
 * `session.status`, compatible `dispatch.status`, and `session.cost` (./cost.ts)
 * where the vocabulary declares the `cost.dollars` it sums: a store may hold an app's own `cost`
 * in place of @yaks/model's. */
export let sessionDerived = (vocab: Vocab): Derived => {
  // Small compositions can declare dispatch without loading kernel's marks.
  // Missing marks are absent, not tables to read (nor an empty CASE ladder).
  let marks = ['waiting', 'admitted'].filter((comp) => vocab.comp(comp))
  let dispatch = {
    ...dispatchStatus,
    deps: ['dispatch', ...marks],
    expr: (owner: Expr) => dispatchStatus.expr(owner, marks),
  }
  let states = { ...attemptDerived(vocab), ...executionDerived(vocab) }
  return {
    ...states,
    'session.status': {
      ...sessionStatus,
      expr: (owner) =>
        sessionStatus.expr(
          owner,
          dispatch,
          states,
          (name) => !!vocab.comp(name),
        ),
    },
    'dispatch.status': dispatch,
    ...vocab.prop(COST, 'dollars') ? { 'session.cost': sessionCost } : {},
  }
}
