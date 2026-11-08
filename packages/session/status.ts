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
// (a turn it took, not one read from a harness's file). One with neither is run
// outside the graph — a harness's session its hooks record, a Claude Code
// subagent, a run from before the runner — so its newest input
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

import {
  among,
  and,
  as,
  at,
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
  le,
  left,
  lit,
  not,
  notNull,
  op,
  or,
  type Select,
  select,
  type Source,
  star,
  sub,
  table,
  unionAll,
  when,
} from '@yaks/sql/core'
import { ASK, RESULT } from './native.ts'
import { attemptDerived } from './attempt.ts'
import { derived as executionDerived } from '@yaks/tools/vocab'
import { sessionCost } from './cost.ts'
import { COST } from '@yaks/model/vocab'
import type { Derived, DerivedScope } from '@yaks/sql/core'
import type { Vocab } from '@yaks/vocab'

export * from './state.ts'
import { RETRIES, UNFINISHED } from './state.ts'
import { claudeStops } from './claude-control.ts'

// Old servers still write state during the marks expansion. A non-null state
// wins until cutover; otherwise waiting precedes admitted in the declared ladder.
export let dispatchStatus = {
  stable: true,
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

// How far down a transcript the status selector walks to prove a turn at rest.
let TAIL = 128
// The common table expressions the SQL rule names, apart from any component.
let LATEST = '__latest'
let ANCHOR = '__anchor'

// The session index orders entries by identity, independently of sequence.
// These bounds seek sparse marks; the join still checks their session when
// other transcripts' entries lie between the two ends.
let within = (owner: Expr, entry: Expr): Expr => {
  let bound = (descending: boolean) =>
    sub(select({
      cols: [col('entity', 'extent')],
      from: table('entry', 'extent'),
      where: eq(col('session', 'extent'), owner),
      order: [
        descending ? desc(col('entity', 'extent')) : col('entity', 'extent'),
      ],
      limit: lit(1),
    }))
  return and(ge(entry, bound(false)), le(entry, bound(true)))
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
  // Only a session not ended owes anything, and sessions end: what the cap
  // counts is a few dozen of a store's tens of thousands.
  few: ['pending', 'running', 'queued'],
  select: (
    values: Expr[],
    dispatch = dispatchStatus,
    declared: (name: string) => boolean = () => true,
    text: (stored: Expr) => Expr = (stored) => stored,
    one?: Expr,
  ): Select | undefined => {
    if (
      !values.every((v) =>
        (v.t == 'val' || v.t == 'lit') && typeof v.v == 'string'
      )
    ) return undefined
    let wanted = values.map((v) => (v as { v: string }).v)
    if (
      !wanted.every((v) =>
        ['pending', 'running', 'queued', 'stopped', 'empty'].includes(v)
      )
    ) return undefined
    let owner = col('entity', 'candidate')
    let wears = (name: string, entry: Expr) =>
      declared(name)
        ? exists(
          select({
            cols: [lit(1)],
            from: table(name, 'mark'),
            where: eq(col('entity', 'mark'), entry),
          }),
        )
        : lit(false)
    let cancelled = (entry: Expr) =>
      ['notice', 'content', 'lines'].every(declared)
        ? exists(select({
          cols: [lit(1)],
          from: table('lines', 'origin'),
          joins: [
            {
              ...cross(table('content', 'prose')),
              on: eq(col('entity', 'origin'), col('entity', 'prose')),
            },
          ],
          where: and(
            eq(col('entity', 'prose'), entry),
            among(text(col('body', 'prose')), claudeStops.map(lit)),
          ),
        }))
        : lit(false)
    // Seek one latest meaningful entry per owner, not the status expression
    // for every owner. A notice is passive except historical cancellation.
    let latest = sub(select({
      cols: [col('entity', 'recent')],
      from: table('entry', 'recent'),
      where: and(
        eq(col('session', 'recent'), col('entity', 's')),
        or(
          not(wears('notice', col('entity', 'recent'))),
          cancelled(col('entity', 'recent')),
        ),
      ),
      order: [desc(col('seq', 'recent'))],
      limit: lit(1),
    }))
    let stopped = wanted.includes('stopped')
    // A transcript with no entry a passive notice leaves is empty, ended or not.
    let empty = wanted.includes('empty')
    // Nothing ended owes anything, so the mark answers before any entry is read.
    // Given `one` owner, the screen reads that session alone.
    let kept = [
      ...one ? [eq(col('entity', 's'), one)] : [],
      ...stopped || empty
        ? []
        : [not(fn('coalesce', col('ended', 's'), lit(false)))],
    ]
    let candidates = select({
      cols: [col('entity', 's'), col('ended', 's'), as(latest, 'latest')],
      from: table('session', 's'),
      ...kept.length ? { where: and(...kept) } : {},
    })
    let actionable = wanted.some((v) => v != 'stopped' && v != 'empty')
    let newest = col('latest', 'candidate')
    let ended = fn('coalesce', col('ended', 'candidate'), lit(false))
    // A stopped transcript must either be ended or contain a stop/control.
    // Historical controls are candidates, never an alternative status rule.
    let controls = ['stop', 'notice'].filter(declared).map((name) =>
      select({
        cols: [col('session', 'ce'), col('seq', 'ce')],
        from: table(name, 'cm'),
        joins: [
          {
            ...cross(table('entry', 'ce')),
            on: eq(col('entity', 'ce'), col('entity', 'cm')),
          },
        ],
        ...name == 'notice' ? { where: cancelled(col('entity', 'ce')) } : {},
      })
    )
    let controlOwners = controls.length ? unionAll(...controls) : select({
      cols: [as(lit(null), 'session'), as(lit(null), 'seq')],
      where: lit(false),
    })
    // Whether a transcript's newest turn is at rest, read walking down from its
    // newest entry: the first entry holding work or an ask ends the walk. An ask
    // with nothing unread above it proves it, and so does reaching the start of
    // a transcript that asked nothing, whose inputs no runner owes. A longer
    // transcript is left to the exact rule. What ends the walk is worked out in
    // FROM subqueries, which add nothing to this expression's height (workerd's
    // depth limit, as below).
    let inputKinds = [
      'output',
      'notice',
      'result',
      'tool_progress',
      'refusal',
      'exception',
      'ask',
      'call',
      'stop',
      'interrupted',
    ].filter(declared)
    let input = (entry: Expr) =>
      and(
        wears('content', entry),
        ...inputKinds.map((name) => not(wears(name, entry))),
      )
    // A historical stop matters only until the next input. Find that input
    // directly after the newest control, rather than working out the entire
    // status of every transcript that ever stopped and later resumed.
    let halted = exists(select({
      cols: [lit(1)],
      from: table('__status_controls', 'control'),
      where: and(
        eq(col('session', 'control'), owner),
        or(
          col('legacy', 'control'),
          not(exists(select({
            cols: [lit(1)],
            from: table('entry', 'resumed'),
            where: and(
              eq(col('session', 'resumed'), owner),
              gt(col('seq', 'resumed'), col('seq', 'control')),
              input(col('entity', 'resumed')),
            ),
          }))),
        ),
      ),
    }))
    let inflight = (entry: Expr) =>
      declared('attempt')
        ? exists(select({
          cols: [lit(1)],
          from: table('attempt', 'flight'),
          where: and(
            eq(col('entity', 'flight'), entry),
            notNull(col('by', 'flight')),
          ),
        }))
        : lit(false)
    // An input arriving above what the newest ask read. Any other reply there
    // would have ended the walk, or lies between the two and is read here too.
    let unread = (ask: Expr, seq: Expr) =>
      exists(select({
        cols: [lit(1)],
        from: from(
          select({
            cols: [
              as(
                or(
                  wears('result', col('entity', 'gap')),
                  wears('tool_progress', col('entity', 'gap')),
                  input(col('entity', 'gap')),
                ),
                'heard',
              ),
            ],
            from: table('entry', 'gap'),
            where: and(
              eq(col('session', 'gap'), owner),
              gt(
                col('seq', 'gap'),
                fn(
                  'coalesce',
                  sub(select({
                    cols: [col('seq', 'read')],
                    from: table('ask', 'request'),
                    joins: [
                      join(
                        table('entry', 'read'),
                        eq(col('entity', 'read'), col('through', 'request')),
                      ),
                    ],
                    where: eq(col('entity', 'request'), ask),
                  })),
                  seq,
                ),
              ),
            ),
          }),
          'above',
        ),
        where: col('heard', 'above'),
      }))
    // In a store keeping archetypes, one joined row answers for every component
    // an entry wears, the way the exact rule reads it (`archetype`), where a
    // probe of each table costs a seek per component per entry.
    let typed = declared('archetype')
    let shapes: Join[] = typed
      ? [
        {
          ...cross(table('entity', 'owner')),
          on: eq(col('id', 'owner'), col('entity', 'e')),
        },
        {
          ...cross(table('archetype', 'shape')),
          on: eq(col('entity', 'shape'), col('archetype', 'owner')),
        },
      ]
      : []
    let walks = (name: string, entry: Expr) =>
      typed
        ? declared(name)
          ? gt(
            fn('instr', col('tables', 'shape'), lit(JSON.stringify(name))),
            lit(0),
          )
          : lit(false)
        : wears(name, entry)
    let resting = (inputs: boolean) => {
      let e = col('entity', 'e')
      let work = [
        'stop',
        'call',
        'result',
        'tool_progress',
        'tool_async',
        'exception',
        'interrupted',
      ]
      return fn(
        'coalesce',
        sub(select({
          cols: [col('clean', 'tail')],
          from: from(
            select({
              cols: [
                col('seq', 'e'),
                as(
                  or(
                    walks('ask', e),
                    isNull(col('seq', 'e')),
                    ...work.map((name) => walks(name, e)),
                    and(walks('attempt', e), inflight(e)),
                    and(walks('notice', e), cancelled(e)),
                  ),
                  'ends',
                ),
                as(
                  and(
                    walks('ask', e),
                    notNull(col('seq', 'e')),
                    ...work.map((name) => not(walks(name, e))),
                    not(and(walks('attempt', e), inflight(e))),
                    ...inputs ? [not(unread(e, col('seq', 'e')))] : [],
                  ),
                  'clean',
                ),
              ],
              from: table('entry', 'e'),
              joins: shapes,
              where: eq(col('session', 'e'), owner),
              order: [desc(col('seq', 'e'))],
              limit: lit(TAIL),
            }),
            'tail',
          ),
          where: col('ends', 'tail'),
          order: [desc(col('seq', 'tail'))],
          limit: lit(1),
        })),
        not(exists(select({
          cols: [lit(1)],
          from: table('entry', 'beyond'),
          where: eq(col('session', 'beyond'), owner),
          order: [desc(col('seq', 'beyond'))],
          limit: lit(1),
          offset: lit(TAIL - 1),
        }))),
      )
    }
    let notQueued = not(
      eq(fn('coalesce', dispatch.expr(owner), lit('')), lit('queued')),
    )
    let marked = (entry: Expr, names: string[]) =>
      names.map((name) => not(wears(name, entry)))
    // Three last turns the rule can only read as finished: prose that asks for
    // nothing, a refusal naming no request, and a turn given up on. Nothing
    // about them needs the exact rule, and they are nearly every transcript.
    // A background call still unanswered: probed in each candidate's own
    // entries where the candidates are the few not ended, and read once for
    // the store where every ended session is one too.
    let unanswered = (p: string) =>
      not(exists(select({
        cols: [lit(1)],
        from: table('result', 'answer'),
        where: eq(col('call', 'answer'), col('entity', p)),
      })))
    let few = !stopped && !empty
    let background = declared('tool_async') && declared('result')
    let waiting = !background ? lit(false) : few
      ? exists(select({
        cols: [lit(1)],
        from: table('tool_async', 'p'),
        joins: [{
          ...cross(table('entry', 'pe')),
          on: eq(col('entity', 'p'), col('entity', 'pe')),
        }],
        where: and(
          within(owner, col('entity', 'p')),
          eq(col('session', 'pe'), owner),
          unanswered('p'),
        ),
      }))
      : among(
        owner,
        select({ cols: [col('session')], from: table('__status_waiting') }),
      )
    let atRest = or(
      and(
        wears('output', newest),
        ...marked(newest, ['ask', 'refusal']),
        resting(true),
        not(waiting),
        notQueued,
      ),
      and(
        wears('refusal', newest),
        ...marked(newest, ['output', 'ask', 'result']),
        resting(false),
        notQueued,
      ),
      and(
        wears('ask', newest),
        wears('interrupted', newest),
        wears('failed', newest),
        ...marked(newest, ['call', 'result', 'refusal', 'exception']),
        notQueued,
      ),
    )
    let eligible = or(
      empty ? isNull(newest) : lit(false),
      stopped
        ? or(
          wears('stop', newest),
          halted,
          and(ended, notNull(newest), not(atRest)),
        )
        : lit(false),
      actionable
        ? and(
          not(ended),
          notNull(newest),
          not(wears('stop', newest)),
          not(atRest),
        )
        : lit(false),
    )
    // Materialization is essential: SQLite must apply the cheap candidate
    // filter before it evaluates the exact turn expression.
    return select({
      with: [
        { name: '__status_latest', materialized: true, q: candidates },
        ...stopped
          ? [{
            name: '__status_controls',
            materialized: true,
            q: select({
              cols: [
                col('session', 'controls'),
                as(fn('max', col('seq', 'controls')), 'seq'),
                as(fn('max', isNull(col('seq', 'controls'))), 'legacy'),
              ],
              from: from(controlOwners, 'controls'),
              group: [col('session', 'controls')],
            }),
          }]
          : [],
        ...background && !few
          ? [{
            name: '__status_waiting',
            materialized: true,
            q: select({
              cols: [col('session', 'pe')],
              from: table('tool_async', 'p'),
              joins: [{
                ...cross(table('entry', 'pe')),
                on: eq(col('entity', 'pe'), col('entity', 'p')),
              }],
              where: unanswered('p'),
            }),
          }]
          : [],
        {
          name: '__status_candidates',
          materialized: true,
          q: select({
            cols: [owner, col('ended', 'candidate'), newest],
            from: table('__status_latest', 'candidate'),
            where: eligible,
          }),
        },
      ],
      cols: [col('entity', 'chosen')],
      from: table('__status_candidates', 'chosen'),
      where: among(
        when(
          [
            [isNull(col('latest', 'chosen')), lit('empty')],
            [wears('stop', col('latest', 'chosen')), lit('stopped')],
          ],
          sessionStatus.expr(col('entity', 'chosen'), dispatch, declared, text),
        ),
        values,
      ),
    })
  },
  expr: (
    owner: Expr,
    dispatch = dispatchStatus,
    declared: (name: string) => boolean = () => true,
    text: (stored: Expr) => Expr = (stored) => stored,
    terminal = false,
  ): Expr => {
    // Each fact about an entry is said once (`marks`), and each fact about
    // the transcript is said once, as a common table expression the next
    // reads: its newest entry (LATEST) and the anchors of its turn (ANCHOR).
    // Both name the owner, so SQLite runs them again at every reference,
    // whatever the hint: they are left for the planner to flatten rather than
    // materialized, and each is referenced as few times as the rule allows.
    // The turn's rows are read once, and every fact in the decision is
    // reduced from them in one pass. Each read seeks its own rows through the
    // entry index, so the cost is bounded by the turn, whatever the
    // transcript's length.
    let typed = declared('archetype')
    let mine = (alias: string) => eq(col('session', alias), owner)
    let inputKinds = [
      'output',
      'notice',
      'result',
      'tool_progress',
      'refusal',
      'exception',
      'ask',
      'call',
      'stop',
      'interrupted',
    ].filter(declared)
    // Older consumed imports classified a cancellation as a passive notice.
    // Interpret that format here without rewriting the owner's transcripts:
    // whether the entry `alias` holds the prose such an import recorded.
    let cancellation = (alias: string) =>
      ['notice', 'content', 'lines'].every(declared)
        ? exists(select({
          cols: [lit(1)],
          from: table('lines', 'origin'),
          joins: [
            {
              ...cross(table('content', 'text')),
              on: eq(col('entity', 'origin'), col('entity', 'text')),
            },
          ],
          where: and(
            eq(col('entity', 'text'), col('entity', alias)),
            among(text(col('body', 'text')), claudeStops.map(lit)),
          ),
        }))
        : lit(false)
    // What an entry is to the rule, from whether it `wears` each declared
    // component and whether its prose is `cancelled`.
    let marks = (wears: (comp: string) => Expr, cancelled: Expr) => {
      let worn = (comp: string) => declared(comp) ? wears(comp) : lit(false)
      let notice = worn('notice')
      let cancel = iff(notice, cancelled, lit(false))
      return {
        worn,
        cancel,
        halted: or(worn('stop'), cancel),
        passive: and(notice, not(cancelled)),
        // A cancellation is a notice, so an input is neither.
        input: and(worn('content'), ...inputKinds.map((c) => not(wears(c)))),
      }
    }
    // Whether an entry wears a component: in a store that keeps archetypes,
    // read off the archetype one joined row names, which answers for every
    // component; else by seeking the component's own table.
    // Each joined in the order written: the entry leads, so it is the one
    // sought through its index.
    let archetype = (alias: string): Join[] => [
      {
        ...cross(table('entity', 'owner')),
        on: eq(col('id', 'owner'), col('entity', alias)),
      },
      {
        ...cross(table('archetype', 'shape')),
        on: eq(col('entity', 'shape'), col('archetype', 'owner')),
      },
    ]
    let shaped = (comp: string) =>
      gt(fn('instr', col('tables', 'shape'), lit(JSON.stringify(comp))), lit(0))
    let probed = (alias: string) => (comp: string) =>
      exists(select({
        cols: [lit(1)],
        from: table(comp, 'm'),
        where: eq(col('entity', 'm'), col('entity', alias)),
      }))
    let shapes = typed ? archetype('e') : []
    let e = marks(typed ? shaped : probed('e'), cancellation('e'))
    // The newest entry a passive notice does not hide, whether it is a stop,
    // and, when it is a refusal, the request it refused.
    let latest = select({
      cols: [
        col('entity', 'e'),
        col('seq', 'e'),
        as(e.worn('stop'), 'stop'),
        as(
          and(
            e.worn('ask'),
            not(e.worn('attempt')),
            ...['exception', 'refusal', 'interrupted'].map((c) =>
              not(e.worn(c))
            ),
          ),
          'unfinished',
        ),
        as(
          iff(
            e.worn('refusal'),
            sub(select({
              cols: [col('source', 'o')],
              from: table('output', 'o'),
              where: eq(col('entity', 'o'), col('entity', 'e')),
            })),
            lit(null),
          ),
          'refused_source',
        ),
        ...typed ? [col('tables', 'shape')] : [],
      ],
      from: table('entry', 'e'),
      joins: shapes,
      where: and(mine('e'), not(e.passive)),
      order: [desc(col('seq', 'e'))],
      limit: lit(1),
    })
    // Imported asks may have no input boundary. Seek the last input/stop in
    // this transcript so a late ask cannot hide the stop it followed.
    let control = select({
      cols: [col('seq', 'e')],
      from: table('entry', 'e'),
      joins: shapes,
      where: and(
        mine('e'),
        notNull(col('seq', 'e')),
        // a stop no passive notice hides: a plain stop, or a cancellation
        or(and(e.worn('stop'), not(e.worn('notice'))), e.cancel, e.input),
      ),
      order: [desc(col('seq', 'e'))],
      limit: lit(1),
    })
    // The newest ask: the newest sequenced one, else the newest one written
    // before entries were sequenced. The first arm with a row ends the read,
    // so a sequenced ask never pays for the search.
    let onAsk = eq(col('entity', 'a'), col('entity', 'e'))
    // A correlated scalar cannot flatten into the join whose tiny ANALYZE
    // estimate makes SQLite scan all asks instead of seeking their primary key.
    let askField = (alias: string, name: string): Expr =>
      sub(select({
        cols: [col(name, 'point_ask')],
        from: table(ASK, 'point_ask'),
        where: eq(col('entity', 'point_ask'), col('entity', alias)),
      }))
    let askAt = (where: Expr): Select =>
      select({
        cols: [star()],
        from: from(select({
          cols: [
            col('entity', 'candidate'),
            col('seq', 'candidate'),
            as(
              fn('json_extract', col('request', 'candidate'), lit('$[1]')),
              'through',
            ),
          ],
          from: from(
            select({
              cols: [
                col('entity', 'e'),
                col('seq', 'e'),
                as(
                  sub(select({
                    cols: [
                      fn(
                        'json_array',
                        col('entity', 'point_ask'),
                        col('through', 'point_ask'),
                      ),
                    ],
                    from: table(ASK, 'point_ask'),
                    where: eq(col('entity', 'point_ask'), col('entity', 'e')),
                  })),
                  'request',
                ),
              ],
              from: table('entry', 'e'),
              where,
              order: [desc(col('seq', 'e'))],
              // Keep the scalar row together: flattening would evaluate it once
              // for presence and again for through, billing the ask twice.
              limit: lit(-1),
            }),
            'candidate',
          ),
          where: notNull(col('request', 'candidate')),
          limit: lit(1),
        })),
      })
    let unsequenced = (source: Source, joins: Join[], point = false) =>
      sub(select({
        cols: [col('entity', 'e')],
        from: source,
        joins,
        where: and(
          mine('e'),
          isNull(col('seq', 'e')),
          ...(point ? [notNull(askField('e', 'entity'))] : []),
        ),
        order: [desc(col('seq', 'e'))],
        limit: lit(1),
      }))
    // Only a transcript holding an entry written before entries were
    // sequenced is searched for one: one seek of its own entries answers for
    // the rest, where the search reads the store's asks while they are few.
    let legacy = exists(select({
      cols: [lit(1)],
      from: table('entry', 'old'),
      where: and(mine('old'), isNull(col('seq', 'old'))),
      limit: lit(1),
    }))
    let ask = {
      ...unionAll(
        askAt(and(mine('e'), notNull(col('seq', 'e')))),
        askAt(and(
          mine('e'),
          eq(
            col('entity', 'e'),
            iff(
              legacy,
              iff(
                exists(select({
                  cols: [lit(1)],
                  from: table(ASK),
                  limit: lit(1),
                  offset: lit(64),
                })),
                unsequenced(table('entry', 'e'), [], true),
                unsequenced(table(ASK, 'a'), [{
                  ...cross(table('entry', 'e')),
                  on: onAsk,
                }]),
              ),
              lit(null),
            ),
          ),
        )),
      ),
      limit: lit(1),
    }
    let anchors = select({
      cols: [
        as(col('entity', 'l'), 'newest'),
        as(col('seq', 'l'), 'newest_seq'),
        as(col('entity', 'a'), 'asked'),
        as(col('seq', 'a'), 'asked_seq'),
        as(col('seq', 'boundary'), 'boundary_seq'),
        // The ask's boundary also acknowledges input admitted while that
        // request was in flight; a stop there is part of the turn.
        as(
          fn(
            'coalesce',
            op(
              '+',
              col('seq', 'boundary'),
              iff(
                or(
                  probed('boundary')('stop'),
                  iff(
                    probed('boundary')('notice'),
                    cancellation('boundary'),
                    lit(false),
                  ),
                ),
                lit(0),
                lit(1),
              ),
            ),
            sub(control),
          ),
          'control_seq',
        ),
        as(
          sub(select({
            cols: [col('seq', 'r')],
            from: table('entry', 'r'),
            where: eq(col('entity', 'r'), col('refused_source', 'l')),
          })),
          'refused_seq',
        ),
        as(col('refused_source', 'l'), 'refused_source'),
        ...typed ? [as(col('tables', 'l'), 'newest_tables')] : [],
      ],
      from: table(LATEST, 'l'),
      joins: [
        left(from(ask, 'a'), lit(true)),
        left(
          table('entry', 'boundary'),
          eq(col('entity', 'boundary'), col('through', 'a')),
        ),
      ],
    })
    let anchor = at('anchor')
    let start = fn(
      'min',
      fn('coalesce', anchor('asked_seq'), lit(0)),
      fn(
        'coalesce',
        anchor('control_seq'),
        anchor('asked_seq'),
        anchor('newest_seq'),
      ),
      fn(
        'coalesce',
        op('+', anchor('refused_seq'), lit(1)),
        anchor('newest_seq'),
      ),
    )
    // The turn: its entries from its start through the newest, or the newest
    // alone in a transcript written before entries were sequenced. The
    // anchors are read once, so the turn's rows hang off them as a left join
    // rather than a union of two reads. Each row reads every component it
    // wears in one pass: through the archetype, else a join per component.
    // The shape is joined on the entry itself, where a reader's scope admits
    // it with the entry (@yaks/sql bind.ts `ownerReads`); the newest alone
    // brings its own.
    let span = select({
      cols: [
        as(fn('coalesce', col('entity', 'i'), anchor('newest')), 'entity'),
        col('seq', 'i'),
        star('anchor'),
        ...typed
          ? [as(
            fn(
              'coalesce',
              col('tables', 'shape'),
              iff(
                isNull(col('entity', 'i')),
                anchor('newest_tables'),
                lit(null),
              ),
            ),
            'tables',
          )]
          : [],
      ],
      from: table(ANCHOR, 'anchor'),
      joins: [
        left(
          table('entry', 'i'),
          and(
            mine('i'),
            notNull(anchor('newest_seq')),
            ge(col('seq', 'i'), start),
          ),
        ),
        ...typed
          ? [
            left(
              table('entity', 'owner'),
              eq(col('id', 'owner'), col('entity', 'i')),
            ),
            left(
              table('archetype', 'shape'),
              eq(col('entity', 'shape'), col('archetype', 'owner')),
            ),
          ]
          : [],
      ],
      where: or(isNull(anchor('newest_seq')), notNull(col('entity', 'i'))),
    })
    let joins: Join[] = []
    let wears = typed
      ? (comp: string) =>
        gt(
          fn('instr', col('tables', 'span'), lit(JSON.stringify(comp))),
          lit(0),
        )
      : (comp: string) => notNull(col('entity', comp))
    // Each component the rule reads, where the entry wears it: its id.
    let comps = [
      'stop',
      'notice',
      'content',
      'exception',
      'refusal',
      'interrupted',
      'failed',
      'provisional',
      'using',
      'sending',
      'ask',
      'call',
      'result',
      'tool_progress',
      'tool_async',
      'output',
      'attempt',
      'execution',
    ]
    if (!typed) {
      joins.push(
        ...comps.filter(declared).map((comp) =>
          left(
            table(comp, comp),
            eq(col('entity', comp), col('entity', 'span')),
          )
        ),
      )
    }
    let prop = (comp: string, p: string) =>
      as(
        !declared(comp) ? lit(null) : typed
          ? iff(
            wears(comp),
            sub(select({
              cols: [col(p, 'v')],
              from: table(comp, 'v'),
              where: eq(col('entity', 'v'), col('entity', 'span')),
            })),
            lit(null),
          )
          : col(p, comp),
        `${comp}_${p}`,
      )
    let turn = select({
      cols: [
        col('entity', 'span'),
        col('seq', 'span'),
        ...comps.map((comp) =>
          as(
            !declared(comp)
              ? lit(null)
              : typed
              ? iff(wears(comp), col('entity', 'span'), lit(null))
              : col('entity', comp),
            comp,
          )
        ),
        as(
          declared('notice')
            ? iff(wears('notice'), cancellation('span'), lit(false))
            : lit(false),
          'cancelled',
        ),
        prop('attempt', 'by'),
        prop('execution', 'by'),
        // Final results close work; a Pending entry of the newest reply's
        // background call permits the model to continue.
        as(
          declared('call')
            ? iff(
              wears('call'),
              sub(select({
                cols: [col('entity', 'r')],
                from: table(RESULT, 'r'),
                where: eq(col('call', 'r'), col('entity', 'span')),
                limit: lit(1),
              })),
              lit(null),
            )
            : lit(null),
          'answered',
        ),
        prop('call', 'source'),
        as(
          declared('tool_progress')
            ? iff(
              wears('call'),
              exists(select({
                cols: [lit(1)],
                from: table('tool_progress', 'p'),
                where: eq(col('call', 'p'), col('entity', 'span')),
              })),
              lit(false),
            )
            : lit(false),
          'progressed',
        ),
        col('boundary_seq', 'span'),
        as(col('asked', 'span'), 'ask_id'),
        col('refused_source', 'span'),
        as(eq(col('entity', 'span'), col('newest', 'span')), 'newest'),
        as(eq(col('entity', 'span'), col('asked', 'span')), 'asked'),
        as(
          ge(
            col('seq', 'span'),
            fn('coalesce', col('asked_seq', 'span'), lit(0)),
          ),
          'current',
        ),
      ],
      from: from(span, 'span'),
      joins,
    })
    let has = (comp: string, alias = 't') => notNull(col(comp, alias))
    // Whether the entry `alias` was read from a harness's file: looked up only
    // for an ask, the one entry it changes.
    let read = (alias: string) =>
      declared('lines')
        ? exists(select({
          cols: [lit(1)],
          from: table('lines', 'line'),
          where: eq(col('entity', 'line'), col('entity', alias)),
        }))
        : lit(false)
    let lacks = (comp: string, alias = 't') => isNull(col(comp, alias))
    let current = col('current', 't')
    let open = and(
      current,
      has('call'),
      lacks('answered'),
      lacks('tool_async'),
    )
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
    let row = marks((comp) => has(comp), col('cancelled', 't'))
    // A result carrying its call's refusal is a result, as `kindOf` reads it.
    let value = (name: string) =>
      name == 'stop'
        ? iff(row.halted, col('entity', 't'), lit(null))
        : name == 'exception' || name == 'refusal'
        ? iff(has('result'), lit(null), col(name, 't'))
        : col(name, 't')
    let names = [
      'stop',
      'exception',
      'refusal',
      'interrupted',
      'failed',
      'ask',
      'call',
      'result',
      'tool_progress',
      'output',
      'attempt',
      'attempt_by',
      'refused_source',
      'boundary_seq',
    ]
    let askNames = [
      'interrupted',
      'failed',
      'provisional',
      'seq',
    ]
    // Keep these historical predicates out of the turn aggregate: earlier
    // verdicts need neither. Presence includes answered background calls;
    // only the running branch needs an unanswered one.
    let background = (unanswered: boolean): Expr =>
      declared('tool_async')
        ? iff(
          exists(select({ cols: [lit(1)], from: table('tool_async') })),
          sub(select({
            cols: [lit(1)],
            from: table('entry', 'pe'),
            joins: [{
              ...cross(table('tool_async', 'p')),
              on: eq(col('entity', 'pe'), col('entity', 'p')),
            }],
            where: and(
              mine('pe'),
              ...unanswered
                ? [not(exists(select({
                  cols: [lit(1)],
                  from: table(RESULT, 'r'),
                  where: eq(col('call', 'r'), col('entity', 'p')),
                })))]
                : [],
            ),
            // EXISTS discards ordering. A scalar LIMIT keeps newest-first seeks.
            order: [desc(col('seq', 'pe'))],
            limit: lit(1),
          })),
          lit(null),
        )
        : lit(null)
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
        // A call of the newest reply still running within its patience: the
        // reply's other answers wait for it.
        flag(
          'unheard',
          and(
            current,
            has('tool_async'),
            eq(col('call_source', 't'), col('ask_id', 't')),
            lacks('answered'),
            not(col('progressed', 't')),
          ),
        ),
        as(
          fn(
            'max',
            iff(
              or(
                has('result'),
                declared('tool_progress') && declared('call')
                  ? and(
                    has('tool_progress'),
                    exists(select({
                      cols: [lit(1)],
                      from: table('tool_progress', 'rp'),
                      joins: [join(
                        table('call', 'rc'),
                        eq(col('entity', 'rc'), col('call', 'rp')),
                      )],
                      where: and(
                        eq(col('entity', 'rp'), col('entity', 't')),
                        eq(col('source', 'rc'), col('ask_id', 't')),
                      ),
                    })),
                  )
                  : lit(false),
              ),
              col('seq', 't'),
              lit(null),
            ),
          ),
          'ready_seq',
        ),
        as(fn('max', iff(row.input, col('seq', 't'), lit(null))), 'input_seq'),
        as(fn('max', iff(row.halted, col('seq', 't'), lit(null))), 'stop_seq'),
        flag('served', or(has('using'), and(has('ask'), not(read('t'))))),
        ...names.map((name) =>
          as(fn('max', iff(newest, value(name), lit(null))), 'n_' + name)
        ),
        ...askNames.map((name) =>
          as(fn('max', iff(asked, col(name, 't'), lit(null))), 'a_' + name)
        ),
        as(fn('max', col('entity', 't')), 'any'),
      ],
      from: from(turn, 't'),
      // Past plain outputs contribute no historical fact. Keep both anchors
      // and every other mark: an output can also carry outstanding work.
      where: and(
        not(row.passive),
        or(
          newest,
          asked,
          lacks('output'),
          ...comps.filter((c) => c != 'content' && c != 'output').map((c) =>
            has(c)
          ),
        ),
      ),
    })
    let n = (name: string) => notNull(col('n_' + name, 'f'))
    let f = (name: string) => col(name, 'f')
    let a = (name: string) => notNull(col('a_' + name, 'f'))
    let after = (seq: Expr) =>
      fn('coalesce', gt(f('input_seq'), seq), lit(false))
    let boundary = fn('coalesce', f('n_boundary_seq'), f('a_seq'), lit(0))
    // Two bounded historical facts remain: a refusal can explicitly name an
    // older ask, and the retry limit covers at most RETRIES consecutive asks.
    // Neither is an open-work scan.
    let refused = sub(select({
      cols: [col('seq', 'b')],
      from: table('entry', 'b'),
      where: and(
        mine('b'),
        notNull(askField('b', 'entity')),
        eq(col('entity', 'b'), col('n_refused_source', 'f')),
      ),
    }))
    let probe = marks(probed('e'), cancellation('e'))
    let retries = sub(select({
      cols: [fn('sum', col('interrupted', 'r'))],
      from: from(
        select({
          cols: [col('seq', 'e'), as(probe.worn('interrupted'), 'interrupted')],
          from: table('entry', 'e'),
          where: and(
            mine('e'),
            notNull(askField('e', 'entity')),
            not(probe.passive),
          ),
          order: [desc(col('seq', 'e'))],
          limit: lit(RETRIES),
        }),
        'r',
      ),
      where: or(isNull(f('input_seq')), gt(col('seq', 'r'), f('input_seq'))),
    }))
    // Before the first ask, a model selection on the original request still
    // makes a later input owed by this runner. Once asked, the turn itself is
    // the proof of service and no historical request is read, unless it was
    // read from a harness's file: that harness answers its own transcript.
    let owed = iff(f('served'), lit('pending'), lit('running'))
    // Once these branches decline, only nonterminal answers remain. A test
    // for stopped/failed needs none of the historical progress census below.
    let verdict = (rest: Expr) =>
      when(
        [
          [
            or(
              n('stop'),
              and(notNull(f('stop_seq')), not(after(f('stop_seq')))),
            ),
            lit('stopped'),
          ],
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
        ],
        rest,
      )
    let nonterminal = when([
      [f('open'), lit('running')],
      [
        and(
          or(
            after(boundary),
            and(eq(f('unheard'), lit(0)), gt(f('ready_seq'), boundary)),
          ),
          notNull(background(false)),
        ),
        lit('pending'),
      ],
      [notNull(background(true)), lit('running')],
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
        and(
          n('output'),
          not(n('result')),
          not(n('tool_progress')),
          not(n('interrupted')),
        ),
        iff(
          after(col('n_boundary_seq', 'f')),
          lit('pending'),
          lit('settled'),
        ),
      ],
    ], owed)
    // Keep the expression below workerd's depth limit, including the runner's
    // enclosing union. FROM subqueries and common table expressions don't add
    // to expression height.
    let decision = (rest: Expr) =>
      select({
        cols: [as(verdict(rest), 'v')],
        from: from(facts, 'f'),
        where: notNull(col('any', 'f')),
      })
    let ended = sub(
      select({
        cols: [col('ended', 's')],
        from: table('session', 's'),
        where: eq(col('entity', 's'), owner),
      }),
    )
    // A newest stop, or an ended ask with no attempt or failure, is stopped
    // whatever the earlier turn owes. Neither needs its history read.
    let said = (verdict: Select) =>
      fn(
        'coalesce',
        sub(select({
          with: [
            { name: LATEST, q: latest, materialized: false },
            // The anchor is consumed once by the sequenced branch (or its
            // legacy fallback). Inlining avoids a billed temporary-row read;
            // its newest-entry and ask seeks remain bounded.
            { name: ANCHOR, q: anchors, materialized: false },
          ],
          cols: [
            iff(
              exists(select({
                from: table(LATEST, 'l'),
                where: or(col('stop', 'l'), and(ended, col('unfinished', 'l'))),
              })),
              lit('stopped'),
              sub(select({ cols: [col('v', 'x')], from: from(verdict, 'x') })),
            ),
          ],
        })),
        lit('empty'),
      )
    // A process of its own runs it while its row wears a `process` with no
    // `exit` (./state.ts `Marks`): what the entries leave owing is that
    // process's to answer, never the runner's.
    let wearing = (name: string) =>
      exists(select({
        cols: [lit(1)],
        from: table(name, 'm'),
        where: eq(col('entity', 'm'), owner),
      }))
    let process = declared('process') && declared('exit')
      ? and(wearing('process'), not(wearing('exit')))
      : lit(false)
    // The mark ends only what its entries leave unfinished. The limit keeps the
    // status one column here, or flattening would work it out once per mention.
    let whole = sub(select({
      cols: [
        when([
          [
            and(
              fn('coalesce', col('ended', 'r'), lit(false)),
              among(col('v', 'r'), UNFINISHED.map(lit)),
            ),
            lit('stopped'),
          ],
          [and(process, eq(col('v', 'r'), lit('pending'))), lit('running')],
        ], col('v', 'r')),
      ],
      from: from(
        select({
          cols: [as(said(decision(nonterminal)), 'v'), as(ended, 'ended')],
          limit: lit(-1),
        }),
        'r',
      ),
    }))
    if (!terminal) return whole
    return iff(ended, whole, said(decision(lit(''))))
  },
}

/** The derived-property registry a SQLite store loads to read
 * `session.status`, compatible `dispatch.status`, and `session.cost` (./cost.ts)
 * where the vocabulary declares the `cost.dollars` it sums: a store may hold an app's own `cost`
 * in place of @yaks/model's. The configured `reading` registry resolves content
 * before interpreting historical controls; without an override, content is
 * text in its component. */
export let sessionDerived = (vocab: Vocab, reading: Derived = {}): Derived => {
  // Small compositions can declare dispatch without loading kernel's marks.
  // Missing marks are absent, not tables to read (nor an empty CASE ladder).
  let marks = ['waiting', 'admitted'].filter((comp) => vocab.comp(comp))
  let dispatch = {
    ...dispatchStatus,
    deps: ['dispatch', ...marks],
    expr: (owner: Expr) => dispatchStatus.expr(owner, marks),
  }
  let states = { ...attemptDerived(vocab), ...executionDerived(vocab) }
  let text = reading['content.body']?.text
  let declared = (scope?: DerivedScope) => (name: string) =>
    !!vocab.comp(name) && (name != 'archetype' || !scope?.masked.length)
  return {
    ...states,
    'session.status': {
      ...sessionStatus,
      stable: !reading['content.body'] ||
        reading['content.body'].stable == true,
      test: (owner, values, scope) => {
        // Unfinished words screen the one session as the select screens
        // every session: most rest, and the exact rule reads only the rest.
        if (
          !values.every((v) =>
            (v.t == 'val' || v.t == 'lit') &&
            ['stopped', 'failed'].includes(String(v.v))
          )
        ) {
          let one = sessionStatus.select(
            values,
            dispatch,
            declared(scope),
            text,
            owner,
          )
          if (
            one &&
            values.every((v) =>
              (v.t == 'val' || v.t == 'lit') && UNFINISHED.includes(String(v.v))
            )
          ) {
            // Ended sessions cannot match. Decline before creating even empty
            // candidate CTEs for each historical owner on an ordered page.
            return iff(
              sub(select({
                cols: [col('ended', 'ended')],
                from: table('session', 'ended'),
                where: eq(col('entity', 'ended'), owner),
              })),
              lit(false),
              exists(one),
            )
          }
          return one && exists(one)
        }
        return among(
          sessionStatus.expr(
            owner,
            dispatch,
            declared(scope),
            text,
            true,
          ),
          values,
        )
      },
      select: (values, scope) =>
        sessionStatus.select(
          values,
          dispatch,
          declared(scope),
          text,
        ),
      expr: (owner, scope) =>
        sessionStatus.expr(
          owner,
          dispatch,
          declared(scope),
          text,
        ),
    },
    'dispatch.status': dispatch,
    ...vocab.prop(COST, 'dollars') ? { 'session.cost': sessionCost } : {},
  }
}
