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
import type { Derived } from '@yaks/sql/core'
import type { Vocab } from '@yaks/vocab'

export * from './state.ts'
import { RETRIES } from './state.ts'
import { claudeStops } from './claude-control.ts'

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

// The common table expressions the SQL rule names, apart from any component.
let LATEST = '__latest'
let ANCHOR = '__anchor'

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
    text: (stored: Expr) => Expr = (stored) => stored,
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
      ['notice', 'content', 'imported'].every(declared)
        ? exists(select({
          cols: [lit(1)],
          from: table('content', 'text'),
          joins: [
            join(
              table('imported', 'origin'),
              eq(col('entity', 'origin'), col('entity', 'text')),
            ),
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
    let askAt = (where: Expr): Select =>
      select({
        cols: [star()],
        from: from(select({
          cols: [col('entity', 'e'), col('seq', 'e'), col('through', 'a')],
          from: table('entry', 'e'),
          joins: [join(table(ASK, 'a'), onAsk)],
          where,
          order: [desc(col('seq', 'e'))],
          limit: lit(1),
        })),
      })
    // A transcript with no sequenced ask must not search every other
    // transcript's asks: its NULL-sequence range is the fallback's scope.
    let unsequenced = (source: Source, joins: Join[]) =>
      sub(select({
        cols: [col('entity', 'e')],
        from: source,
        joins,
        where: and(mine('e'), isNull(col('seq', 'e'))),
        order: [desc(col('seq', 'e'))],
        limit: lit(1),
      }))
    let ask = {
      ...unionAll(
        askAt(and(mine('e'), notNull(col('seq', 'e')))),
        askAt(eq(
          col('entity', 'e'),
          iff(
            // Choose within this statement, never from stale statistics:
            // a small ask set is cheaper than a lifetime of NULL sequences.
            exists(select({
              cols: [lit(1)],
              from: table(ASK),
              limit: lit(1),
              offset: lit(64),
            })),
            unsequenced(table('entry', 'e'), [{
              ...cross(table(ASK, 'a')),
              on: onAsk,
            }]),
            unsequenced(table(ASK, 'a'), [{
              ...cross(table('entry', 'e')),
              on: onAsk,
            }]),
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
    let span = select({
      cols: [
        as(fn('coalesce', col('entity', 'i'), anchor('newest')), 'entity'),
        col('seq', 'i'),
        star('anchor'),
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
      ],
      where: or(isNull(anchor('newest_seq')), notNull(col('entity', 'i'))),
    })
    let joins: Join[] = typed ? archetype('span') : []
    let wears = typed ? shaped : (comp: string) => notNull(col('entity', comp))
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
      'ask',
      'call',
      'result',
      'tool_progress',
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
        // A call's answer. The runner cannot take another ask before all calls
        // in the previous turn answer.
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
    let lacks = (comp: string, alias = 't') => isNull(col(comp, alias))
    let current = col('current', 't')
    let open = and(
      current,
      has('call'),
      lacks('answered'),
      not(col('progressed', 't')),
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
    let value = (name: string) =>
      name == 'stop'
        ? iff(row.halted, col('entity', 't'), lit(null))
        : col(name, 't')
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
        as(
          declared('tool_progress')
            ? sub(select({
              cols: [fn(
                'max',
                iff(
                  not(exists(select({
                    cols: [lit(1)],
                    from: table(RESULT, 'r'),
                    where: eq(col('call', 'r'), col('call', 'p')),
                  }))),
                  lit(1),
                  lit(0),
                ),
              )],
              from: table('__progress', 'p'),
            }))
            : lit(null),
          'progress_pending',
        ),
        as(
          fn(
            'max',
            iff(
              or(row.input, has('result'), has('tool_progress')),
              col('seq', 't'),
              lit(null),
            ),
          ),
          'ready_seq',
        ),
        as(fn('max', iff(row.input, col('seq', 't'), lit(null))), 'input_seq'),
        as(fn('max', iff(row.halted, col('seq', 't'), lit(null))), 'stop_seq'),
        flag('served', or(has('using'), has('ask'))),
        ...names.map((name) =>
          as(fn('max', iff(newest, value(name), lit(null))), 'n_' + name)
        ),
        ...askNames.map((name) =>
          as(fn('max', iff(asked, col(name, 't'), lit(null))), 'a_' + name)
        ),
        as(fn('max', col('entity', 't')), 'any'),
      ],
      from: from(turn, 't'),
      where: not(row.passive),
    })
    let n = (name: string) => notNull(col('n_' + name, 'f'))
    let f = (name: string) => col(name, 'f')
    let a = (name: string) => notNull(col('a_' + name, 'f'))
    let after = (seq: Expr) =>
      fn('coalesce', gt(f('input_seq'), seq), lit(false))
    // Two bounded historical facts remain: a refusal can explicitly name an
    // older ask, and the retry limit covers at most RETRIES consecutive asks.
    // Neither is an open-work scan.
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
    let probe = marks(probed('e'), cancellation('e'))
    let retries = sub(select({
      cols: [fn('sum', col('interrupted', 'r'))],
      from: from(
        select({
          cols: [col('seq', 'e'), as(probe.worn('interrupted'), 'interrupted')],
          from: table('entry', 'e'),
          joins: [
            join(table(ASK, 'r'), eq(col('entity', 'r'), col('entity', 'e'))),
          ],
          where: and(mine('e'), not(probe.passive)),
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
      [
        or(n('stop'), and(notNull(f('stop_seq')), not(after(f('stop_seq'))))),
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
      [f('open'), lit('running')],
      [
        and(
          gt(
            f('ready_seq'),
            fn('coalesce', f('n_boundary_seq'), f('a_seq'), lit(0)),
          ),
          notNull(f('progress_pending')),
        ),
        lit('pending'),
      ],
      [f('progress_pending'), lit('running')],
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
    // enclosing union. FROM subqueries and common table expressions don't add
    // to expression height.
    let decision = select({
      cols: [as(verdict, 'v')],
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
    // A transcript whose newest entry is a stop is stopped, whatever its
    // turn: that reads neither its asks nor its turn.
    return iff(
      ended,
      lit('stopped'),
      fn(
        'coalesce',
        sub(select({
          with: [
            { name: LATEST, q: latest, materialized: false },
            // The anchor is consumed once by the sequenced branch (or its
            // legacy fallback). Inlining avoids a billed temporary-row read;
            // its newest-entry and ask seeks remain bounded.
            { name: ANCHOR, q: anchors, materialized: false },
            ...declared('tool_progress')
              ? [{
                name: '__progress',
                materialized: true,
                q: select({
                  cols: [col('call', 'p')],
                  from: table('tool_progress', 'p'),
                  joins: [{
                    ...cross(table('entry', 'pe')),
                    on: eq(col('entity', 'pe'), col('entity', 'p')),
                  }],
                  where: mine('pe'),
                }),
              }]
              : [],
          ],
          cols: [
            iff(
              exists(select({
                from: table(LATEST, 'l'),
                where: col('stop', 'l'),
              })),
              lit('stopped'),
              sub(select({ cols: [col('v', 'x')], from: from(decision, 'x') })),
            ),
          ],
        })),
        lit('empty'),
      ),
    )
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
  return {
    ...states,
    'session.status': {
      ...sessionStatus,
      expr: (owner) =>
        sessionStatus.expr(
          owner,
          dispatch,
          (name) => !!vocab.comp(name),
          text,
        ),
    },
    'dispatch.status': dispatch,
    ...vocab.prop(COST, 'dollars') ? { 'session.cost': sessionCost } : {},
  }
}
