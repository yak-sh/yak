/**
 * A skill round, run: each attempt still to be written is asked of a writer
 * and each guess still to be made of a judge, and what comes back is written
 * on the row that planned it.
 *
 * Who answers is the run's one boundary (`Asking`). On a machine that runs
 * sessions, a writer and a judge are each a session asked once and offered
 * no tools (`sending{tools: []}`), which whatever answers sessions on this
 * graph starts with nothing of its machine (@yaks/spawn: a bare run); the
 * arm that carries a persona differs by one thing, the persona its session
 * selects (`sessions`). A host that runs none asks a model directly, with no
 * tools either (`asking`). This module starts no process and names no
 * provider.
 *
 * The words are the round's. `writers{task, skilled, rule}` on the round is
 * what a writer is asked, `judge{form, shown, question, cap}` what a judge
 * is, and `using{provider, model, effort}` who answers. A reply is read as
 * its last ```json block.
 *
 * Under sessions, a row names its session in the write that asks, so a run
 * stopped part way loses nothing: the next one reads what each session said
 * since, and asks again only what never answered.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { fill, output } from '@yaks/trial/run'
 *
 * equal(fill('Pitch $case.$rule', { case: 'the office', rule: '' }),
 *   'Pitch the office.')
 * equal(output('Done.\n```json\n{"headline": "Hello"}\n```', ['headline']),
 *   { headline: 'Hello' })
 * ```
 *
 * @module
 */
import type { Bundle, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { type Model, ModelError, type Price, weigh } from '@yaks/model'
import { CallError } from '@yaks/tools/errors'
import { entryStatus, saidOf, textOf } from '@yaks/session'
import { over } from '@yaks/spawn/over'
import { unreturned } from './round.ts'

type Row = Record<string, unknown>
let comp = (b: Bundle | undefined, name: string): Row =>
  (b?.[name] ?? {}) as Row
let str = (v: unknown): string => v == null ? '' : String(v)
let list = (v: unknown): string[] => Array.isArray(v) ? v.map(str) : []
let some = (o: Row): Row =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))
let mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length

/// fill('Say $what to $who.', { what: 'hi' }) -> 'Say hi to $who.'
/** A wording with each `$name` it is given filled in. A name it is not given
 * stays as written, so a price or a variable in the text is left alone. */
export let fill = (wording: string, said: Record<string, string>): string =>
  wording.replace(/\$(\w+)/g, (all, name) => said[name] ?? all)

/// answer('I think.\n```json\n{"a": 1}\n```\nThen:\n```json\n{"a": 2}\n```') -> { a: 2 }
/// answer('no block') -> undefined
/** What a reply answers: the last ```json block in it that holds an object. */
export let answer = (reply: string): Row | undefined => {
  let blocks = [...reply.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1])
  for (let block of blocks.reverse()) {
    try {
      let said = JSON.parse(block)
      if (said && typeof said == 'object' && !Array.isArray(said)) return said
    } catch { /* not this one */ }
  }
}

/** The work in a reply, by the round's parts: every part a string that says
 * something, or nothing at all. */
export let output = (
  reply: string,
  parts: string[],
): Record<string, string> | undefined => {
  let said = answer(reply) ?? {}
  let made = parts.map((p) => [p, said[p]])
  if (made.every(([, v]) => typeof v == 'string' && v.trim())) {
    return Object.fromEntries(made.map(([p, v]) => [p, String(v).trim()]))
  }
}

/** What a writer is asked: the round's wording, with the variant's text and
 * the case's filled in, and its rule where the case is a riddle. */
export let task = (round: Bundle, variant: Bundle, kase: Bundle): string => {
  let w = comp(round, 'writers')
  let skill = str(comp(variant, 'variant').body).trim()
  return fill(str(skill && w.skilled ? w.skilled : w.task), {
    skill,
    case: str(comp(kase, 'case').body).trim(),
    rule: kase.riddle ? str(w.rule) : '',
  })
}

let norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/// rankOf(['Acme Inc', 'Zapier'], { name: 'Zapier' }) -> 2
/// rankOf(['Acme'], { name: 'Zapier', aliases: ['acme!'] }) -> 1
/// rankOf(['Acme'], { name: 'Zapier' }) -> undefined
/** The 1-based place of the right answer among guesses: the riddle's name or
 * an alias, whatever its case and punctuation, or a guess that holds one of
 * more than four letters. */
export let rankOf = (guesses: string[], riddle: Row): number | undefined => {
  let names = [riddle.name, ...list(riddle.aliases)].map((n) => norm(str(n)))
    .filter((n) => n)
  let at = guesses.map(norm).findIndex((g) =>
    names.some((n) => g == n || (n.length > 4 && g.includes(n)))
  )
  return at < 0 ? undefined : at + 1
}

/// leaked('Zap it with ZAPIER', { forbidden: ['zapier'], forbidden_exact: ['Zap', 'zap'] }) -> ['zapier', 'Zap']
/** The riddle's forbidden strings a text holds: `forbidden` anywhere and in
 * any case, `forbidden_exact` as whole words as written. */
export let leaked = (text: string, riddle: Row): string[] => [
  ...list(riddle.forbidden).filter((w) =>
    text.toLowerCase().includes(w.toLowerCase())
  ),
  ...list(riddle.forbidden_exact).filter((w) =>
    new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)
  ),
]

let LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** What a judge is asked about an attempt, and how its reply is read. In the
 * `among` form `group` is every case of the riddle's group, shown in an
 * order the case alone decides, so two attempts at one case meet one sheet. */
export let question = (
  judge: Bundle,
  round: Bundle,
  attempt: Bundle,
  kase: Bundle,
  group: Bundle[] = [],
): { text: string; read: (reply: string) => Row | undefined } => {
  let j = comp(judge, 'judge')
  let made = (comp(attempt, 'writing').output ?? {}) as Record<string, string>
  let shown = list(j.shown ?? comp(round, 'round').parts)
    .map((p) => made[p]).filter((v) => v).join('\n\n')
  let riddle = comp(kase, 'riddle')
  let gave = leaked(shown, riddle)
  if (j.form != 'among') {
    let cap = Number(j.cap ?? 10)
    return {
      text: fill(str(j.question), { output: shown }),
      read: (reply) => {
        let said = answer(reply)?.guesses
        if (!Array.isArray(said)) return
        let guesses = said.map(str).slice(0, cap)
        return some({
          guesses,
          rank: rankOf(guesses, riddle),
          cap,
          leaked: gave,
        })
      },
    }
  }
  let order = group.toSorted((a, b) =>
    derivedEid(`among|${kase.entity.eid}|${a.entity.eid}`) <
        derivedEid(`among|${kase.entity.eid}|${b.entity.eid}`)
      ? -1
      : 1
  )
  let name = (c: Bundle) => str(comp(c, 'riddle').name)
  let letters = [...LETTERS.slice(0, order.length)]
  return {
    text: fill(str(j.question), {
      output: shown,
      n: String(order.length),
      sheets: order.map((c, i) =>
        `${letters[i]}\n-----\n${str(comp(c, 'case').body).trim()}\n-----`
      ).join('\n\n'),
    }),
    read: (reply) => {
      let said = answer(reply)?.ranking
      if (!Array.isArray(said)) return
      let picked = said.map((x) => letters.indexOf(str(x).trim().toUpperCase()))
        .filter((i) => i >= 0).map((i) => order[i])
      let at = picked.findIndex((c) => c.entity.eid == kase.entity.eid)
      return some({
        guesses: picked.map(name),
        among: order.map(name),
        rank: at < 0 ? undefined : at + 1,
        cap: order.length,
        leaked: gave,
      })
    },
  }
}

/** One call still to be made: the row that planned it, what is asked, the
 * persona its session selects, who answers, and how the reply becomes the
 * row's component. `session` is the one an earlier run asked. */
export type Call = {
  row: Eid
  comp: 'writing' | 'guess'
  /** what the estimate is read by: the arm of a writer, the form of a judge */
  kind: string
  label: string
  text: string
  persona?: Eid
  using: Row
  session?: Eid
  /** a guess at an attempt not yet written: counted in what the run will
   * cost, and asked once its attempt is */
  waits?: boolean
  read: (reply: string) => Row | undefined
}

/** Names a variant, a case or a judge in a call's label (./round.ts
 * `keyed`). */
export type Label = (b: Bundle) => string

/**
 * The calls a round still owes, writers first: each attempt with a variant
 * and no output, then each guess with no guesses. A guess at an attempt still
 * unwritten `waits`: what it asks is not known until a later look.
 */
export let owed = async (
  g: Graph,
  round: Eid,
  labelOf: Label = (b) => str(comp(b, 'doc').title),
): Promise<Call[]> => {
  let r = JSON.stringify(round)
  let [[head], attempts, guesses] = await Promise.all([
    g.get([round]),
    g.read(`.writing .writing.round=${r} *`),
    g.read(`.guess .guess.attempt.writing.round=${r} *`),
  ])
  let waiting = guesses.filter(unreturned)
  let ids = (rows: Bundle[], name: string, prop: string) =>
    rows.map((b) => str(comp(b, name)[prop])).filter((e) => e)
  let named = new Map(
    (await g.get([
      ...new Set([
        ...ids(attempts, 'writing', 'variant'),
        ...ids(attempts, 'writing', 'case'),
        ...ids(waiting, 'guess', 'judge'),
      ]),
    ])).filter((b) => b).map((b) => [b.entity.eid, b]),
  )
  let groups = new Map<string, Bundle[]>()
  let group = async (name: string) => {
    if (!groups.has(name)) {
      groups.set(
        name,
        await g.read(`.riddle .riddle.group=${JSON.stringify(name)} *`),
      )
    }
    return groups.get(name)!
  }
  let written = new Map(attempts.map((a) => [a.entity.eid, a]))
  let of = (a: Bundle) => {
    let at = comp(a, 'writing')
    return {
      variant: named.get(str(at.variant))!,
      kase: named.get(str(at.case))!,
      name: [
        labelOf(named.get(str(at.case))!),
        labelOf(named.get(str(at.variant))!),
        at.persona ? 'persona' : 'blank',
        str(at.run ?? 1),
      ].join('.'),
    }
  }
  let writers = attempts.filter(unreturned).map((a): Call => {
    let at = comp(a, 'writing')
    let { variant, kase, name } = of(a)
    let parts = list(comp(head, 'round').parts)
    return {
      row: a.entity.eid,
      comp: 'writing',
      kind: at.persona ? 'persona' : 'blank',
      label: name,
      text: task(head, variant, kase),
      ...at.persona ? { persona: str(at.persona) } : {},
      using: comp(head, 'using'),
      ...at.session ? { session: str(at.session) } : {},
      read: (reply) => {
        let made = output(reply, parts)
        return made ? { output: made, reply } : undefined
      },
    }
  })
  let judges: Call[] = []
  for (let w of waiting) {
    let said = comp(w, 'guess')
    let a = written.get(str(said.attempt))
    let judge = named.get(str(said.judge))
    if (!a || !judge) continue
    let { kase, name } = of(a)
    let form = str(comp(judge, 'judge').form) || 'open'
    let using = judge.using ? comp(judge, 'using') : comp(head, 'using')
    let label = `${name} ? ${labelOf(judge)}`
    if (unreturned(a)) {
      judges.push({
        row: w.entity.eid,
        comp: 'guess',
        kind: form,
        label,
        text: '',
        using,
        waits: true,
        read: () => undefined,
      })
      continue
    }
    let asked = question(
      judge,
      head,
      a,
      kase,
      form == 'among' ? await group(str(comp(kase, 'riddle').group)) : [],
    )
    judges.push({
      row: w.entity.eid,
      comp: 'guess',
      kind: form,
      label,
      text: asked.text,
      using,
      ...said.session ? { session: str(said.session) } : {},
      read: (reply) => {
        let read = asked.read(reply)
        return read ? { ...read, form } : undefined
      },
    })
  }
  return [...writers, ...judges]
}

/** What a call of each kind has cost: the mean dollars of the rows that
 * carry a cost, by the arm of a writer and the form of a judge, then by
 * writer or judge, then over all of them. Nothing where no row carries one. */
export let costs = async (
  g: Graph,
): Promise<(c: Pick<Call, 'comp' | 'kind'>) => number | undefined> => {
  let [written, guessed] = await Promise.all([
    g.read('.writing .cost .fields=writing.persona,cost.dollars'),
    g.read('.guess .cost .fields=guess.form,cost.dollars'),
  ])
  let by = new Map<string, number[]>()
  let add = (key: string, b: Bundle) => {
    let d = Number(comp(b, 'cost').dollars)
    if (Number.isFinite(d)) by.set(key, [...by.get(key) ?? [], d])
  }
  for (let b of written) {
    for (
      let key of [
        `writing|${comp(b, 'writing').persona ? 'persona' : 'blank'}`,
        'writing',
        '',
      ]
    ) add(key, b)
  }
  for (let b of guessed) {
    for (let key of [`guess|${str(comp(b, 'guess').form)}`, 'guess', '']) {
      add(key, b)
    }
  }
  return (c) => {
    let found = [`${c.comp}|${c.kind}`, c.comp, ''].map((k) => by.get(k))
      .find((ns) => ns?.length)
    return found && mean(found)
  }
}

/** What one call came back with: everything its model said, the model that
 * answered, what it cost and used. `why` is what it said instead of an
 * answer, where it stopped short. */
export type Said = {
  reply: string
  why?: string
  model?: string
  cost?: number
  /** the cost is every dollar its provider said, not one weighed at a price */
  reported?: boolean
  usage?: Row
}

/** Nothing more can be asked, and why: the budget refused it, or no model
 * answers the round's `using`. */
export type Stop = { stop: string }

/**
 * Who answers a run's calls: the one boundary a run has with the world. A
 * run asks through it and writes what comes back; it never knows whether a
 * session on this machine answered ({@link sessions}) or a model was asked
 * directly ({@link asking}).
 */
export type Asking = {
  /** asks one call and waits for what it said: nothing when the run was
   * stopped first, a {@link Stop} when nothing more can be asked */
  ask: (c: Call) => Promise<Said | Stop | undefined>
  /** what a call an earlier run asked (`Call.session`) has said since,
   * waiting for it; absent where nothing an earlier run asked lasts */
  again?: (c: Call) => Promise<Said | undefined>
  /** the most a call costs, where no earlier row says */
  quote?: (c: Call) => Promise<number | undefined>
}

// A session over, as what it said, cost and used; nothing while it runs.
let ended = async (g: Graph, session: Eid): Promise<Said | undefined> => {
  let [row] = await g.get([session])
  if (!row || !await over(g, row, await entryStatus(g, session))) return
  let s = JSON.stringify(session)
  let [said, paid] = await Promise.all([
    saidOf(g, session),
    g.read(
      `.entry.session=${s} .usage .fields=usage.input_tokens,usage.output_tokens,cost.dollars,cost.reported,ask.to`,
    ),
  ])
  let sum = (name: string, prop: string) => {
    let ns = paid.map((b) => comp(b, name)[prop]).filter((n) => n != null)
    return ns.length ? ns.reduce((a: number, n) => a + Number(n), 0) : undefined
  }
  return {
    // The model that answered, where its requests say (`ask.to`).
    model: paid.map((b) => comp(b, 'ask').to).findLast((m) => m) as
      | string
      | undefined,
    reply: said && !said.stop ? textOf(said) : '',
    why: said?.stop ? textOf(said) : '',
    cost: sum('cost', 'dollars'),
    // Reported only where its provider said every dollar of it; a request
    // weighed at its model's price is not.
    reported: paid.every((b) => !b.cost || comp(b, 'cost').reported === true),
    usage: some({
      input_tokens: sum('usage', 'input_tokens'),
      output_tokens: sum('usage', 'output_tokens'),
    }),
  }
}

/**
 * Calls answered by sessions on this graph: each is a session asked once and
 * offered no tools, which whatever answers sessions here starts bare
 * (@yaks/spawn). The row names its session in the write that asks, so a run
 * stopped part way loses nothing: the next reads what each session said
 * since.
 */
export let sessions = (
  g: Graph,
  o: Pick<Opts, 'pause' | 'signal' | 'mint'> = {},
): Asking => {
  let mint = o.mint ?? (() => crypto.randomUUID() as string)
  let pause = o.pause ?? (() => new Promise((go) => setTimeout(go, 1000)))
  let wait = async (session: Eid) => {
    let end = await ended(g, session)
    while (!end) {
      if (o.signal?.aborted) return undefined
      await pause()
      end = await ended(g, session)
    }
    return end
  }
  return {
    ask: async (c) => {
      let session = mint()
      await g.apply([
        {
          entity: { eid: session },
          session: c.persona ? { persona: c.persona } : {},
        },
        {
          entity: { eid: mint() },
          entry: { session },
          content: { body: c.text },
          using: c.using,
          sending: { tools: [] },
        },
        { entity: { eid: c.row }, [c.comp]: { session } },
      ])
      return await wait(session)
    },
    again: (c) => wait(c.session!),
  }
}

/** A model to ask, by the names a round's `using` gives: the model that
 * answers, the name it is asked by, and its price where it lists one. */
export type Answering = (
  names: { provider?: string; model?: string },
) => Promise<{ model: Model; name: string; price?: Price }>

/** The most a reply may write (`Request.tokens`) when asked directly. */
export let TOKENS = 4000

/**
 * Calls answered by asking a model directly, as a host that runs no sessions
 * does: one request, the call's words as the person's turn, no tools. A
 * refusal (`CallError`, or a `ModelError` that will not pass) stops the run,
 * since it would refuse every call after it; one that may pass is that call
 * saying nothing readable, asked again by the next run. Nothing an earlier
 * run asked lasts, so a call it left is asked again.
 */
export let asking = (
  g: Graph,
  answering: Answering,
  tokens = TOKENS,
): Asking => {
  let found = new Map<string, ReturnType<Answering>>()
  let names = async (using: Row) => {
    let ids = [using.provider, using.model].map(str)
    let rows = await g.get(ids.filter((e) => e))
    let name = (eid: string, of: string) =>
      eid
        ? str(comp(rows.find((b) => b?.entity.eid == eid), of).name) ||
          undefined
        : undefined
    return { provider: name(ids[0], 'provider'), model: name(ids[1], 'model') }
  }
  let answerer = async (c: Call) => {
    let said = await names(c.using)
    let key = JSON.stringify(said)
    let held = found.get(key) ?? answering(said)
    found.set(key, held)
    held.catch(() => found.delete(key))
    return await held
  }
  let refusal = (e: unknown): Stop | Said | undefined => {
    if (e instanceof ModelError && e.retry) {
      return { reply: '', why: `${e.code}: ${e.message}` }
    }
    if (e instanceof ModelError || e instanceof CallError) {
      return { stop: e.message }
    }
  }
  return {
    ask: async (c) => {
      try {
        let { model, name, price } = await answerer(c)
        let reply = await model({
          model: name,
          items: [{ kind: 'user', text: c.text }],
          tools: [],
          tokens,
        })
        let usage = some({
          input_tokens: reply.usage?.input_tokens,
          output_tokens: reply.usage?.output_tokens,
        })
        let cost = reply.cost ??
          (price && reply.usage ? weigh(price, reply.usage) : undefined)
        // The row names the model that answered by its row, where one is
        // kept; the one asked otherwise.
        let [answered] = reply.model == name ? [] : await g.read(
          `.model.name=${
            JSON.stringify(reply.model)
          } .limit=1 .fields=entity.eid`,
        )
        return {
          reply: reply.items.flatMap((i) =>
            i.kind == 'assistant' ? [i.text] : []
          )
            .join('\n'),
          model: answered?.entity.eid,
          cost,
          reported: reply.cost != null && reply.costReported !== false,
          usage,
        }
      } catch (e) {
        let said = refusal(e)
        if (said) return said
        throw e
      }
    },
    quote: async (c) => {
      let price = await answerer(c).then((a) => a.price, () => undefined)
      return price && weigh(price, {
        input_tokens: Math.ceil(c.text.length / 4),
        output_tokens: tokens,
      })
    },
  }
}

/** How a run goes, all but `cap` optional. */
export type Opts = {
  /** the dollars it may spend at list price; it asks nothing more once what
   * it spent, with what the calls going are expected to, would pass it */
  cap: number
  /** who answers its calls (default {@link sessions} on the graph) */
  asking?: Asking
  /** how many calls go at once (default 6) */
  jobs?: number
  /** each line of progress */
  out?: (line: string) => void
  /** names a variant, a case or a judge in a line */
  label?: Label
  /** with the default `asking`: waits between looks at a session (default
   * a second) */
  pause?: () => Promise<unknown>
  /** stops asking; calls already going are left to their sessions */
  signal?: AbortSignal
  /** with the default `asking`: mints a session's and an entry's eid
   * (default a uuid) */
  mint?: () => Eid
}

/** What a run did: calls asked, rows returned, calls that came back with
 * nothing readable, calls left unasked, and the dollars it spent. `stopped`
 * says why it left calls unasked, where it did: the cap, or the refusal that
 * stopped it. */
export type Ran = {
  asked: number
  returned: number
  failed: number
  left: number
  spent: number
  stopped?: string
}

let dollars = (n: number) => `$${n.toFixed(2)}`

/** What a round still owes and what that will cost: writers and judges to
 * ask, and the dollars at list price, by what earlier rows of each kind cost
 * and else the most a call can (`Asking.quote`). `dollars` is absent when
 * nothing says what any call costs. */
export type Owed = {
  calls: Call[]
  writers: number
  judges: number
  dollars?: number
  /** what each call is expected to cost */
  each: Map<Call, number>
}

/** What `round` still owes, priced. */
export let owing = async (
  g: Graph,
  round: Eid,
  o: { asking?: Asking; label?: Label } = {},
): Promise<Owed> => {
  let [calls, cost] = await Promise.all([owed(g, round, o.label), costs(g)])
  let each = new Map<Call, number>()
  for (let c of calls) {
    let n = cost(c) ?? await o.asking?.quote?.(c)
    if (n != null) each.set(c, n)
  }
  let count = (name: string) => calls.filter((c) => c.comp == name).length
  return {
    calls,
    writers: count('writing'),
    judges: count('guess'),
    ...each.size
      ? { dollars: [...each.values()].reduce((a, b) => a + b, 0) }
      : {},
    each,
  }
}

/// owes({ writers: 4, judges: 8, dollars: 0.12 }) -> '4 writers and 8 judges to ask, about $0.12 at list price'
/** What a round owes, in a line. */
export let owes = (o: Pick<Owed, 'writers' | 'judges' | 'dollars'>): string =>
  `${o.writers} writers and ${o.judges} judges to ask` +
  (o.dollars != null
    ? `, about ${dollars(o.dollars)} at list price`
    : ', and nothing says what one costs')

/** The dollars a round's calls have cost so far: every attempt and guess of
 * it that carries a cost. */
export let spent = async (g: Graph, round: Eid): Promise<number> => {
  let r = JSON.stringify(round)
  let rows = (await Promise.all([
    g.read(`.writing.round=${r} .cost .fields=cost.dollars`),
    g.read(`.guess.attempt.writing.round=${r} .cost .fields=cost.dollars`),
  ])).flat()
  let n = rows.reduce((a, b) => a + (Number(comp(b, 'cost').dollars) || 0), 0)
  return Math.round(n * 1e6) / 1e6
}

/**
 * Run what a round still owes. It says first what that will cost, from what
 * earlier rows cost, then asks `jobs` calls at a time: writers, then the
 * judges of what was written. Each row is written the moment its call
 * returns. It stops asking at the cap or at a refusal, and a call that
 * returns nothing readable is asked again by the next run.
 */
export let run = async (g: Graph, round: Eid, o: Opts): Promise<Ran> => {
  let out = o.out ?? (() => {})
  let answers = o.asking ?? sessions(g, o)
  let ran: Ran = { asked: 0, returned: 0, failed: 0, left: 0, spent: 0 }
  let held = 0

  // Write what a call said on the row that asked it. Answers whether the
  // row is returned.
  let settle = async (c: Call, end: Said, ms?: number) => {
    let read = end.reply ? c.read(end.reply) : undefined
    await g.apply([{
      entity: { eid: c.row },
      [c.comp]: some({
        ...read ??
          (c.comp == 'writing' && end.reply ? { reply: end.reply } : {}),
        model: end.model ?? c.using.model,
        ...c.comp == 'writing' ? { at: new Date().toISOString(), ms } : {},
      }),
      ...Object.keys(end.usage ?? {}).length ? { usage: end.usage } : {},
      ...end.cost == null
        ? {}
        : { cost: { dollars: end.cost, reported: !!end.reported } },
    }])
    out(
      `${c.label}: ${
        read
          ? c.comp == 'writing' ? 'written' : `rank ${str(read.rank) || '-'}`
          : `nothing readable (${
            (end.why || end.reply || 'no reply').slice(-160).replace(
              /\s+/g,
              ' ',
            )
          })`
      }${end.cost == null ? '' : ` ${dollars(end.cost)}`}`,
    )
    return { returned: !!read, cost: end.cost }
  }

  let ask = async (c: Call) => {
    let began = Date.now()
    let end = await answers.ask(c)
    if (!end || 'stop' in end) return end
    return await settle(c, end, Date.now() - began)
  }

  // Every call of `calls`, `jobs` at a time, until the cap or the signal.
  let work = async (calls: Call[], each: (c: Call) => Promise<void>) => {
    let queue = [...calls]
    await Promise.all(
      Array.from({ length: Math.max(1, o.jobs ?? 6) }, async () => {
        while (queue.length && !o.signal?.aborted) await each(queue.shift()!)
      }),
    )
  }

  let first = await owing(g, round, { asking: answers, label: o.label })
  out(`${owes(first)}. Cap ${dollars(o.cap)}.`)
  // Two looks: the writers and the judges of what was already written, then
  // the judges of what the first look wrote.
  for (let look of [first, undefined]) {
    let { calls, each } = look ??
      await owing(g, round, { asking: answers, label: o.label })
    calls = calls.filter((c) => !c.waits && (look || c.comp == 'guess'))
    // What an earlier run asked is read first, and costs this run nothing.
    let again: Call[] = []
    let earlier = answers.again ? calls.filter((c) => c.session) : []
    await work(earlier, async (c) => {
      let end = await answers.again!(c)
      let did = end && await settle(c, end)
      if (did?.returned) ran.returned++
      else if (did) again.push(c)
    })
    let fresh = calls.filter((c) => !earlier.includes(c))
    await work([...fresh, ...again], async (c) => {
      let est = each.get(c) ?? 0
      if (ran.stopped || ran.spent + held + est > o.cap || ran.spent >= o.cap) {
        ran.stopped ??= 'the cap'
        ran.left++
        return
      }
      held += est
      ran.asked++
      let did = await ask(c).finally(() => held -= est)
      if (did && 'stop' in did) {
        ran.stopped ??= did.stop
        ran.asked--
        ran.left++
        return
      }
      ran.spent += did?.cost ?? (did ? est : 0)
      if (did?.returned) ran.returned++
      else if (did) ran.failed++
    })
  }
  // Dollars are sums of fractions of a cent, kept to a millionth.
  ran.spent = Math.round(ran.spent * 1e6) / 1e6
  out(
    `${ran.asked} asked, ${ran.returned} returned, ${ran.failed} with nothing readable, ${ran.left} left unasked${
      ran.stopped ? `, stopped by ${ran.stopped}` : ''
    }; spent ${dollars(ran.spent)}.`,
  )
  return ran
}
