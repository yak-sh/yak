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
  cross,
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
  type Join,
  join,
  left,
  lit,
  not,
  notNull,
  op,
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
    declared: (name: string) => boolean = () => true,
  ): Expr => {
    // A turn is read once. The row set below contains the newest
    // ask and its unacknowledged suffix, not a predicate per question over the transcript.
    // Every fact in the decision is reduced from those rows in one pass.
    let typed = declared('archetype')
    let joins: Join[] = typed
      ? [
        join(
          table('entity', 'owner'),
          eq(col('id', 'owner'), col('entity', 'e')),
        ),
        join(
          table('archetype', 'shape'),
          eq(col('entity', 'shape'), col('archetype', 'owner')),
        ),
      ]
      : []
    let wears = (comp: string) =>
      gt(fn('instr', col('tables', 'shape'), lit(JSON.stringify(comp))), lit(0))
    let fields: Expr[] = [
      col('entity', 'e'),
      col('seq', 'e'),
    ]
    let read = (comp: string, props: string[] = []) => {
      if (!declared(comp)) {
        fields.push(
          as(lit(null), comp),
          ...props.map((p) => as(lit(null), `${comp}_${p}`)),
        )
        return
      }
      if (typed) {
        fields.push(as(iff(wears(comp), col('entity', 'e'), lit(null)), comp))
        for (let prop of props) {
          fields.push(
            as(
              iff(
                wears(comp),
                sub(
                  select({
                    cols: [col(prop, 'v')],
                    from: table(comp, 'v'),
                    where: eq(col('entity', 'v'), col('entity', 'e')),
                  }),
                ),
                lit(null),
              ),
              `${comp}_${prop}`,
            ),
          )
        }
      } else {
        joins.push(
          left(table(comp, comp), eq(col('entity', comp), col('entity', 'e'))),
        )
        fields.push(
          as(col('entity', comp), comp),
          ...props.map((p) => as(col(p, comp), `${comp}_${p}`)),
        )
      }
    }
    for (
      let comp of [
        'stop',
        'exception',
        'refusal',
        'content',
        'interrupted',
        'failed',
        'provisional',
        'using',
        'notice',
      ]
    ) read(comp)
    read('ask')
    read('call')
    read('result')
    read('output')
    read('attempt', ['by'])
    read('execution', ['by'])
    // Calls and their answers are joined within this row read. The runner
    // cannot take another ask before all calls in the previous turn answer.
    if (typed) {
      fields.push(
        as(
          iff(
            wears('call'),
            sub(
              select({
                cols: [col('entity', 'r')],
                from: table(RESULT, 'r'),
                where: eq(col('call', 'r'), col('entity', 'e')),
                limit: lit(1),
              }),
            ),
            lit(null),
          ),
          'answered',
        ),
      )
    } else {
      joins.push(
        left(
          table(RESULT, 'answer'),
          eq(col('call', 'answer'), col('entity', 'e')),
        ),
      )
      fields.push(as(col('entity', 'answer'), 'answered'))
    }
    let has = (comp: string, alias = 't') => notNull(col(comp, alias))
    let lacks = (comp: string, alias = 't') => isNull(col(comp, alias))
    let mine = (alias: string) => eq(col('session', alias), owner)
    let noticed = (alias: string) =>
      declared('notice')
        ? exists(
          select({
            cols: [lit(1)],
            from: table('notice', 'z'),
            where: eq(col('entity', 'z'), col('entity', alias)),
          }),
        )
        : lit(false)
    let latest = select({
      cols: [
        col('entity', 'e'),
        col('seq', 'e'),
        as(
          iff(
            typed
              ? gt(
                fn(
                  'instr',
                  col('tables', 'ls'),
                  lit(JSON.stringify('refusal')),
                ),
                lit(0),
              )
              : notNull(col('entity', 'refusal')),
            sub(select({
              cols: [col('seq', 'b')],
              from: table('output', 'o'),
              joins: [
                join(
                  table('entry', 'b'),
                  eq(col('entity', 'b'), col('source', 'o')),
                ),
              ],
              where: eq(col('entity', 'o'), col('entity', 'e')),
            })),
            lit(null),
          ),
          'refused_seq',
        ),
        as(
          iff(
            typed
              ? gt(
                fn(
                  'instr',
                  col('tables', 'ls'),
                  lit(JSON.stringify('refusal')),
                ),
                lit(0),
              )
              : notNull(col('entity', 'refusal')),
            sub(
              select({
                cols: [col('source', 'o')],
                from: table('output', 'o'),
                where: eq(col('entity', 'o'), col('entity', 'e')),
              }),
            ),
            lit(null),
          ),
          'refused_source',
        ),
      ],
      from: table('entry', 'e'),
      joins: typed
        ? [
          join(table('entity', 'lo'), eq(col('id', 'lo'), col('entity', 'e'))),
          join(
            table('archetype', 'ls'),
            eq(col('entity', 'ls'), col('archetype', 'lo')),
          ),
        ]
        : [
          left(
            table('refusal'),
            eq(col('entity', 'refusal'), col('entity', 'e')),
          ),
        ],
      where: and(
        mine('e'),
        typed
          ? eq(
            fn('instr', col('tables', 'ls'), lit(JSON.stringify('notice'))),
            lit(0),
          )
          : not(noticed('e')),
      ),
      order: [desc(col('seq', 'e'))],
      limit: lit(1),
    })
    let ask = select({
      cols: [col('entity', 'e'), col('seq', 'e'), col('through', 'a')],
      from: table('entry', 'e'),
      joins: [
        join(table(ASK, 'a'), eq(col('entity', 'a'), col('entity', 'e'))),
      ],
      where: mine('e'),
      order: [desc(col('seq', 'e'))],
      limit: lit(1),
    })
    let anchors = select({
      cols: [
        as(col('entity', 'l'), 'newest'),
        as(col('seq', 'l'), 'newest_seq'),
        as(col('entity', 'a'), 'asked'),
        as(col('seq', 'a'), 'asked_seq'),
        as(col('seq', 'boundary'), 'boundary_seq'),
        as(col('refused_seq', 'l'), 'refused_seq'),
        as(col('refused_source', 'l'), 'refused_source'),
      ],
      from: from(latest, 'l'),
      joins: [
        left(from(ask, 'a'), lit(true)),
        left(
          table('entry', 'boundary'),
          eq(col('entity', 'boundary'), col('through', 'a')),
        ),
      ],
    })
    let anchor = (name: string) => col(name, 'anchor')
    let start = fn(
      'min',
      fn('coalesce', anchor('asked_seq'), lit(0)),
      fn(
        'coalesce',
        op('+', anchor('boundary_seq'), lit(1)),
        anchor('newest_seq'),
      ),
      fn(
        'coalesce',
        op('+', anchor('refused_seq'), lit(1)),
        anchor('newest_seq'),
      ),
    )
    let turnRows = select({
      cols: [
        ...fields,
        as(anchor('boundary_seq'), 'boundary_seq'),
        as(anchor('refused_seq'), 'refused_seq'),
        as(anchor('refused_source'), 'refused_source'),
        as(eq(col('entity', 'e'), anchor('newest')), 'newest'),
        as(eq(col('entity', 'e'), anchor('asked')), 'asked'),
        as(
          ge(
            col('seq', 'e'),
            fn('coalesce', anchor('asked_seq'), lit(0)),
          ),
          'current',
        ),
      ],
      from: from(anchors, 'anchor'),
      joins: [
        cross(table('entry', 'e')),
        ...joins,
      ],
      where: and(
        mine('e'),
        ge(col('seq', 'e'), start),
      ),
    })
    let turn = turnRows
    let input = and(
      has('content'),
      ...[
        'output',
        'notice',
        'result',
        'refusal',
        'exception',
        'ask',
        'call',
        'stop',
        'interrupted',
      ].map((c) => lacks(c)),
    )
    let current = col('current', 't')
    let open = and(current, has('call'), lacks('answered'))
    let inflight = and(
      current,
      has('attempt'),
      notNull(col('attempt_by', 't')),
      lacks('interrupted'),
    )
    let flag = (name: string, condition: Expr) =>
      as(fn('max', iff(condition, lit(1), lit(0))), name)
    let newest = col('newest', 't')
    let asked = col('asked', 't')
    let names = [
      'stop',
      'exception',
      'refusal',
      'interrupted',
      'failed',
      'ask',
      'call',
      'output',
      'attempt',
      'attempt_by',
      'refused_source',
      'refused_seq',
      'boundary_seq',
    ]
    let askNames = [
      'interrupted',
      'failed',
      'provisional',
      'seq',
      'entity',
    ]
    let facts = select({
      cols: [
        flag('open', open),
        flag(
          'abandoned',
          and(
            open,
            has('execution'),
            isNull(col('execution_by', 't')),
            lacks('interrupted'),
          ),
        ),
        flag('inflight', inflight),
        as(fn('max', iff(input, col('seq', 't'), lit(null))), 'input_seq'),
        flag('served', or(has('using'), has('ask'))),
        ...names.map((name) =>
          as(fn('max', iff(newest, col(name, 't'), lit(null))), 'n_' + name)
        ),
        ...askNames.map((name) =>
          as(fn('max', iff(asked, col(name, 't'), lit(null))), 'a_' + name)
        ),
        as(fn('max', col('entity', 't')), 'any'),
      ],
      from: from(turn, 't'),
      where: lacks('notice'),
    })
    let n = (name: string) => notNull(col('n_' + name, 'f'))
    let f = (name: string) => col(name, 'f')
    let a = (name: string) => notNull(col('a_' + name, 'f'))
    let after = (seq: Expr) =>
      fn('coalesce', gt(f('input_seq'), seq), lit(false))
    // Two bounded historical facts remain: a refusal can explicitly name an
    // older ask, and the retry limit covers at most RETRIES consecutive asks.
    // Neither is an open-work scan. The ask's boundary also acknowledges
    // input admitted while that request was in flight.
    let refused = sub(select({
      cols: [col('seq', 'b')],
      from: table('entry', 'b'),
      joins: [
        join(table(ASK, 'r'), eq(col('entity', 'r'), col('entity', 'b'))),
      ],
      where: and(
        mine('b'),
        eq(col('entity', 'b'), col('n_refused_source', 'f')),
      ),
    }))
    let interrupted = (entity: Expr) =>
      declared('interrupted')
        ? exists(
          select({
            cols: [lit(1)],
            from: table('interrupted', 'i'),
            where: eq(col('entity', 'i'), entity),
          }),
        )
        : lit(false)
    let retries = sub(select({
      cols: [fn('sum', iff(interrupted(col('entity', 'r')), lit(1), lit(0)))],
      from: from(
        select({
          cols: [col('entity', 'e'), col('seq', 'e')],
          from: table('entry', 'e'),
          joins: [
            join(table(ASK, 'r'), eq(col('entity', 'r'), col('entity', 'e'))),
          ],
          where: and(mine('e'), not(noticed('e'))),
          order: [desc(col('seq', 'e'))],
          limit: lit(RETRIES),
        }),
        'r',
      ),
      where: or(isNull(f('input_seq')), gt(col('seq', 'r'), f('input_seq'))),
    }))
    // Before the first ask, a model selection on the original request still
    // makes a later input owed by this runner. Once asked, the turn itself is
    // the proof of service and no historical request is read.
    let owed = iff(
      or(f('served'), notNull(col('a_entity', 'f'))),
      lit('pending'),
      lit('running'),
    )
    let verdict = when([
      [n('stop'), lit('stopped')],
      [f('abandoned'), lit('running')],
      [n('exception'), lit('failed')],
      [
        and(n('interrupted'), n('failed'), not(n('ask')), not(n('call'))),
        lit('failed'),
      ],
      [f('inflight'), lit('running')],
      [eq(dispatch.expr(owner), lit('queued')), lit('queued')],
      [n('refusal'), iff(after(refused), lit('pending'), lit('failed'))],
      [
        and(a('interrupted'), a('failed'), not(after(col('a_seq', 'f')))),
        lit('failed'),
      ],
      [and(a('interrupted'), after(col('a_seq', 'f'))), lit('pending')],
      [and(a('interrupted'), a('provisional')), lit('pending')],
      [
        a('interrupted'),
        iff(ge(retries, lit(RETRIES)), lit('failed'), lit('pending')),
      ],
      [f('open'), lit('running')],
      [
        and(
          n('ask'),
          n('attempt'),
          isNull(col('n_attempt_by', 'f')),
          not(n('interrupted')),
        ),
        lit('settled'),
      ],
      [or(n('ask'), n('call')), lit('running')],
      [
        n('output'),
        iff(
          after(col('n_boundary_seq', 'f')),
          lit('pending'),
          lit('settled'),
        ),
      ],
    ], owed)
    // Keep the expression below workerd's depth limit, including the runner's
    // enclosing union. FROM subqueries don't add to expression height.
    let decision = select({
      cols: [as(verdict, 'v')],
      from: from(facts, 'f'),
      where: notNull(col('any', 'f')),
    })
    let legacyFacts = select({
      ...facts,
      from: from(
        select({
          ...turnRows,
          where: and(
            mine('e'),
            isNull(col('seq', 'e')),
            eq(col('entity', 'e'), anchor('newest')),
          ),
        }),
        't',
      ),
    })
    let legacyDecision = select({ ...decision, from: from(legacyFacts, 'f') })
    let legacy = sub(
      select({ cols: [col('v', 'x')], from: from(legacyDecision, 'x') }),
    )
    let unsequenced = exists(
      select({
        cols: [lit(1)],
        from: from(latest, 'n'),
        where: isNull(col('seq', 'n')),
      }),
    )
    let ended = sub(
      select({
        cols: [col('ended', 's')],
        from: table('session', 's'),
        where: eq(col('entity', 's'), owner),
      }),
    )
    return iff(
      ended,
      lit('stopped'),
      fn(
        'coalesce',
        iff(
          unsequenced,
          legacy,
          sub(select({ cols: [col('v', 'x')], from: from(decision, 'x') })),
        ),
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
          (name) => !!vocab.comp(name),
        ),
    },
    'dispatch.status': dispatch,
    ...vocab.prop(COST, 'dollars') ? { 'session.cost': sessionCost } : {},
  }
}
