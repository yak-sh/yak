/**
 * A skill round, run: each attempt still to be written is asked of a writer
 * and each guess still to be made of a judge, and what comes back is written
 * on the row that planned it.
 *
 * A writer and a judge are each a session asked once and offered no tools
 * (`sending{tools: []}`), which whatever answers sessions on this graph starts
 * with nothing of its machine (@yaks/spawn: a bare run). The arm that carries
 * a persona differs by one thing, the persona its session selects. This
 * module starts no process and names no provider: it writes the request,
 * waits for the session to be over, and reads what it said and what it cost.
 *
 * The words are the round's. `writers{task, skilled, rule}` on the round is
 * what a writer is asked, `judge{form, shown, question, cap}` what a judge
 * is, and `using{provider, model, effort}` who answers. A reply is read as
 * its last ```json block.
 *
 * A row names its session in the write that asks, so a run stopped part way
 * loses nothing: the next one reads what each session said since, and asks
 * again only what never answered.
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
import { entryStatus, saidOf, textOf } from '@yaks/session'
import { over } from '@yaks/spawn/tools'
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
  read: (reply: string) => Row | undefined
}

/** Names a variant, a case or a judge in a call's label (./round.ts
 * `keyed`). */
export type Label = (b: Bundle) => string

/**
 * The calls a round still owes, writers first: each attempt with a variant
 * and no output, then each guess with no guesses whose attempt has been
 * written. A guess at an attempt still unwritten waits for a later look.
 */
export let owed = async (
  g: Graph,
  round: Eid,
  label: Label = (b) => str(comp(b, 'doc').title),
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
        label(named.get(str(at.case))!),
        label(named.get(str(at.variant))!),
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
    if (!a || !judge || unreturned(a)) continue
    let { kase, name } = of(a)
    let form = str(comp(judge, 'judge').form) || 'open'
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
      label: `${name} ? ${label(judge)}`,
      text: asked.text,
      using: judge.using ? comp(judge, 'using') : comp(head, 'using'),
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

/** How a run goes, all but `cap` optional. */
export type Opts = {
  /** the dollars it may spend at list price; it asks nothing more once what
   * it spent, with what the calls going are expected to, would pass it */
  cap: number
  /** how many calls go at once (default 6) */
  jobs?: number
  /** each line of progress */
  out?: (line: string) => void
  /** names a variant, a case or a judge in a line */
  label?: Label
  /** waits between looks at a session (default: a second) */
  pause?: () => Promise<unknown>
  /** stops asking; calls already going are left to their sessions */
  signal?: AbortSignal
  /** mints a session's and an entry's eid (default a uuid) */
  mint?: () => Eid
}

/** What a run did: calls asked, rows returned, calls that came back with
 * nothing readable, calls left unasked, and the dollars it spent. */
export type Ran = {
  asked: number
  returned: number
  failed: number
  left: number
  spent: number
}

let dollars = (n: number) => `$${n.toFixed(2)}`

// A session over, as its row and what it said, cost and used; nothing while
// it runs.
let ended = async (g: Graph, session: Eid) => {
  let [row] = await g.get([session])
  if (!row || !await over(g, row, await entryStatus(g, session))) return
  let s = JSON.stringify(session)
  let [said, paid] = await Promise.all([
    saidOf(g, session),
    g.read(
      `.entry.session=${s} .usage .fields=usage.input_tokens,usage.output_tokens,cost.dollars,ask.to`,
    ),
  ])
  let sum = (name: string, prop: string) => {
    let ns = paid.map((b) => comp(b, name)[prop]).filter((n) => n != null)
    return ns.length ? ns.reduce((a: number, n) => a + Number(n), 0) : undefined
  }
  return {
    // The model that answered, where its requests say (`ask.to`).
    model: paid.map((b) => comp(b, 'ask').to).findLast((m) => m),
    reply: said && !said.stop ? textOf(said) : '',
    why: said?.stop ? textOf(said) : '',
    cost: sum('cost', 'dollars'),
    usage: some({
      input_tokens: sum('usage', 'input_tokens'),
      output_tokens: sum('usage', 'output_tokens'),
    }),
  }
}

/**
 * Run what a round still owes. It says first what that will cost, from what
 * earlier rows cost, then asks `jobs` calls at a time: writers, then the
 * judges of what was written. Each row is written the moment its session is
 * over. It stops asking at the cap, and a call that returns nothing readable
 * keeps its session and is asked again by the next run.
 */
export let run = async (g: Graph, round: Eid, o: Opts): Promise<Ran> => {
  let out = o.out ?? (() => {})
  let mint = o.mint ?? (() => crypto.randomUUID() as string)
  let pause = o.pause ?? (() => new Promise((go) => setTimeout(go, 1000)))
  let cost = await costs(g)
  let ran: Ran = { asked: 0, returned: 0, failed: 0, left: 0, spent: 0 }
  let held = 0

  // Write what a session said on the row that asked it. Answers whether the
  // row is returned.
  let settle = async (c: Call, session: Eid, began?: number) => {
    let end = await ended(g, session)
    while (!end) {
      if (o.signal?.aborted) return undefined
      await pause()
      end = await ended(g, session)
    }
    let read = end.reply ? c.read(end.reply) : undefined
    let ms = began == null ? undefined : Date.now() - began
    await g.apply([{
      entity: { eid: c.row },
      [c.comp]: some({
        ...read ??
          (c.comp == 'writing' && end.reply ? { reply: end.reply } : {}),
        model: end.model ?? c.using.model,
        ...c.comp == 'writing' ? { at: new Date().toISOString(), ms } : {},
      }),
      ...Object.keys(end.usage).length ? { usage: end.usage } : {},
      ...end.cost == null
        ? {}
        : { cost: { dollars: end.cost, reported: true } },
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
    let session = mint()
    let began = Date.now()
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
    return await settle(c, session, began)
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

  let first = await owed(g, round, o.label)
  let total = first.reduce((n, c) => n + (cost(c) ?? 0), 0)
  let count = (name: string) => first.filter((c) => c.comp == name).length
  out(
    `${count('writing')} writers and ${count('guess')} judges to ask` +
      (first.some((c) => cost(c) != null)
        ? `, about ${dollars(total)} at list price by what earlier rows cost`
        : ', and no earlier row says what one costs') +
      `; judges of what is yet to be written come after. Cap ${
        dollars(o.cap)
      }.`,
  )
  let stopped = false
  // Two looks: the writers and the judges of what was already written, then
  // the judges of what the first look wrote.
  for (let look of [first, undefined]) {
    let calls = look ??
      (await owed(g, round, o.label)).filter((c) => c.comp == 'guess')
    // What an earlier run asked is read first, and costs this run nothing.
    let again: Call[] = []
    await work(calls.filter((c) => c.session), async (c) => {
      let did = await settle(c, c.session!)
      if (did?.returned) ran.returned++
      else if (did) again.push(c)
    })
    await work([...calls.filter((c) => !c.session), ...again], async (c) => {
      let est = cost(c) ?? 0
      if (stopped || ran.spent + held + est > o.cap || ran.spent >= o.cap) {
        stopped = true
        ran.left++
        return
      }
      held += est
      ran.asked++
      let did = await ask(c).finally(() => held -= est)
      ran.spent += did?.cost ?? (did ? est : 0)
      if (did?.returned) ran.returned++
      else if (did) ran.failed++
    })
  }
  // Dollars are sums of fractions of a cent, kept to a millionth.
  ran.spent = Math.round(ran.spent * 1e6) / 1e6
  out(
    `${ran.asked} asked, ${ran.returned} returned, ${ran.failed} with nothing readable, ${ran.left} left unasked${
      stopped ? ' at the cap' : ''
    }; spent ${dollars(ran.spent)}.`,
  )
  return ran
}
