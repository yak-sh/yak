/**
 * A skill trial, as data: a round's file read into rows, the deck of pairs a
 * person taps through, and the tally of what the taps and the judges say.
 * All of it pure; the commands (./cli.ts, ./tools.ts) and the page
 * (./routes.ts) hand it rows and take what it gives.
 *
 * - A **variant** is a candidate text of a skill: `doc{title}` +
 *   `variant{body, theory, source, licence, from}`.
 * - A **case** is what a writer is handed: `doc{title}` + `case{body, base}`,
 *   with `riddle{name, aliases, forbidden, forbidden_exact, group}` where a
 *   judge guesses what the attempt describes, or `found{name, source}` where
 *   the attempt is what somebody else published.
 * - An **attempt** is what one writer returned: `writing{round, case, variant,
 *   persona, run, model, at, ms, reply, output}` beside @yaks/model's
 *   `usage{input_tokens, output_tokens}` and `cost{dollars, reported}`.
 * - A **pair** is two attempts to compare: `pair{round, a, b, ord}`.
 * - A person's taps are `preference{first, second, chose, why}` and
 *   `grabbed{attempt}`, each a row its `created.by` wrote.
 * - A judge's guesses are `guess{attempt, form, model, guesses, among, rank,
 *   cap, leaked}`.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { rows } from '@yaks/trial/skill'
 *
 * let made = rows({
 *   key: 'r1', title: 'Round one', skill: 'copywriting', output: ['headline'],
 *   variants: [{ key: 'none', title: 'No skill', body: '' }],
 *   cases: [{ key: 'office', title: 'The office', body: 'facts' }],
 *   attempts: [{
 *     key: 'office.none.blank.1', case: 'office', variant: 'none',
 *     persona: false, run: 1, output: { headline: 'Hello' },
 *   }],
 * })
 * equal(made.length, 4) // the round, its variant, its case, the attempt
 * equal(made[0].round, { skill: 'copywriting', parts: ['headline'] })
 * ```
 *
 * @module
 */
import type { Bundle, Eid } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'

/** A round as the runner writes it: `rounds/<key>/round.json`. Keys name
 * things within the file; the graph holds eids. */
export type RoundFile = {
  key: string
  title: string
  /** the skill being developed; variants and cases are named under it */
  skill: string
  /** the parts every attempt returns, in order */
  output: string[]
  /** the persona a `persona: true` writer carried, by id (`N-4053`) */
  persona?: string | null
  variants?: {
    key: string
    title: string
    body: string
    theory?: string | null
    source?: string | null
    licence?: string | null
    from?: string | null
  }[]
  cases?: {
    key: string
    title: string
    body: string
    /** `riddle`: a judge guesses its `name`; `found`: published by `name` at
     * `source`; anything else is a brief */
    kind?: string
    base?: string | null
    name?: string
    source?: string | null
    aliases?: string[]
    forbidden?: string[]
    forbidden_exact?: string[]
    group?: string
  }[]
  attempts?: {
    key: string
    case: string
    variant: string
    persona: boolean
    run?: number
    model?: string
    at?: string
    reply?: string
    output: Record<string, string>
    usage?: { input?: number; output?: number; dollars?: number; ms?: number }
  }[]
  pairs?: [string, string][]
  guesses?: {
    attempt: string
    form: string
    model?: string
    guesses: string[]
    among?: string[]
    rank?: number | null
    cap?: number
    leaked?: string[]
  }[]
}

/** The names a round, a variant and a case are found again by (@yaks/alias):
 * a second load lands on the rows of the first. */
export let named = {
  round: (key: string): string => `round:${key}`,
  variant: (skill: string, key: string): string => `variant:${skill}:${key}`,
  case: (skill: string, key: string): string => `case:${skill}:${key}`,
}

/** The eid of a row a load must find again and nobody names: an attempt, a
 * pair, a guess, each derived from its round's key and its own. */
export let loaded = (comp: string, round: string, ...key: string[]): Eid =>
  derivedEid([comp, round, ...key].join('|'))

// A component without its absent properties: a file says null for none.
let some = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))

/**
 * The rows of a round file, as one batch: the round, its variants and cases
 * (each under its name, so a file that names one a former round loaded lands
 * on it), the models named, then attempts, pairs and guesses on derived eids.
 * A key the file does not hold is taken as one a former round loaded.
 */
export let rows = (file: RoundFile): Bundle[] => {
  let held = (keys: { key: string }[] = []) => new Set(keys.map((k) => k.key))
  let variants = held(file.variants), cases = held(file.cases)
  let attempts = held(file.attempts)
  let variant = (key: string) =>
    variants.has(key) ? `$variant:${key}` : named.variant(file.skill, key)
  let kase = (key: string) =>
    cases.has(key) ? `$case:${key}` : named.case(file.skill, key)
  let attempt = (key: string) => {
    if (!attempts.has(key)) throw new Error(`no attempt in the file: ${key}`)
    return loaded('writing', file.key, key)
  }
  let models = [
    ...new Set(
      [...file.attempts ?? [], ...file.guesses ?? []].flatMap((x) =>
        x.model ? [x.model] : []
      ),
    ),
  ]
  let nth = new Map<string, number>()
  return [
    {
      entity: { eid: '$round' },
      alias: { name: named.round(file.key) },
      round: { skill: file.skill, parts: file.output },
      doc: { title: file.title },
    },
    ...(file.variants ?? []).map((v): Bundle => ({
      entity: { eid: `$variant:${v.key}` },
      alias: { name: named.variant(file.skill, v.key) },
      variant: some({
        body: v.body,
        theory: v.theory,
        source: v.source,
        licence: v.licence,
        from: v.from && variant(v.from),
      }),
      doc: { title: v.title },
    })),
    ...(file.cases ?? []).map((c): Bundle => ({
      entity: { eid: `$case:${c.key}` },
      alias: { name: named.case(file.skill, c.key) },
      case: some({ body: c.body, base: c.base && kase(c.base) }),
      doc: { title: c.title },
      ...c.kind == 'found'
        ? { found: some({ name: c.name, source: c.source }) }
        : {},
      ...c.kind == 'riddle'
        ? {
          riddle: some({
            name: c.name,
            aliases: c.aliases,
            forbidden: c.forbidden,
            forbidden_exact: c.forbidden_exact,
            group: c.group,
          }),
        }
        : {},
    })),
    ...models.map((name): Bundle => ({
      entity: { eid: `$model:${name}` },
      model: { name },
    })),
    ...(file.attempts ?? []).map((a): Bundle => {
      if (a.persona && !file.persona) {
        throw new Error(
          `${a.key} carried a persona and the file names none: add "persona": "<its id>" beside "skill"`,
        )
      }
      return {
        entity: { eid: attempt(a.key) },
        writing: some({
          round: '$round',
          case: kase(a.case),
          variant: variant(a.variant),
          persona: a.persona ? file.persona : null,
          run: a.run,
          model: a.model && `$model:${a.model}`,
          at: a.at,
          ms: a.usage?.ms,
          reply: a.reply,
          output: a.output,
        }),
        ...a.usage
          ? {
            usage: some({
              input_tokens: a.usage.input,
              output_tokens: a.usage.output,
            }),
          }
          : {},
        ...a.usage?.dollars != null
          ? { cost: { dollars: a.usage.dollars, reported: false } }
          : {},
      }
    }),
    ...(file.pairs ?? []).map(([a, b], ord): Bundle => ({
      entity: { eid: loaded('pair', file.key, a, b) },
      pair: { round: '$round', a: attempt(a), b: attempt(b), ord },
    })),
    ...(file.guesses ?? []).map((g): Bundle => {
      let said = [g.attempt, g.form, g.model ?? '']
      let n = nth.get(said.join('|')) ?? 0
      nth.set(said.join('|'), n + 1)
      return {
        entity: { eid: loaded('guess', file.key, ...said, String(n)) },
        guess: some({
          attempt: attempt(g.attempt),
          form: g.form,
          model: g.model && `$model:${g.model}`,
          guesses: g.guesses,
          among: g.among,
          rank: g.rank,
          cap: g.cap,
          leaked: g.leaked,
        }),
      }
    }),
  ]
}

type Row = Record<string, unknown>
let comp = (b: Bundle | undefined, name: string): Row =>
  (b?.[name] ?? {}) as Row
let str = (v: unknown): string => v == null ? '' : String(v)
let wearing = (all: Bundle[], name: string) => all.filter((b) => b[name])
let byEid = (all: Bundle[]) => new Map(all.map((b) => [b.entity.eid, b]))

// The case a case's bases lead to: two cases with one root are about one
// thing.
let root = (cases: Map<Eid, Bundle>, eid: Eid): Eid => {
  let seen = new Set<Eid>()
  while (!seen.has(eid)) {
    seen.add(eid)
    let base = str(comp(cases.get(eid), 'case').base)
    if (!base || !cases.has(base)) break
    eid = base
  }
  return eid
}

/** One attempt as the page shows it: its parts and nothing that says who or
 * what wrote it. `grabbed` is the row that marks it, when the judge has. */
export type Pitch = { eid: Eid; parts: Record<string, string>; grabbed?: Eid }

/** One pair as the page shows it, in the order shown: `title` says what both
 * are about, empty where saying would name what the judge must not know.
 * `preference` is the judge's row for it, when they have tapped: `chose` the
 * attempt, or null for neither. */
export type Card = {
  title: string
  case: Eid
  first: Pitch
  second: Pitch
  preference?: Eid
  chose?: Eid | null
  why?: string
}

/** What the page is handed: the round's cards in order, and the parts each
 * pitch has. */
export type Deck = { title: string; parts: string[]; cards: Card[] }

/** How many of the round's attempts a person's own attempt is set against. */
export let AGAINST = 3

// Whether a pair is shown b first: a bit of its two eids, so the order holds
// across reloads and follows nothing the runner chose.
let swapped = (a: Eid, b: Eid) =>
  parseInt(derivedEid(`shown|${a}|${b}`).slice(-1), 16) % 2 == 1

/**
 * The deck a judge taps through: the round's pairs in their order, each
 * shuffled, then each attempt a person wrote themselves set against
 * {@link AGAINST} attempts about the same thing. A card carries the judge's
 * own preference and marks, and never an attempt's variant, persona or model.
 */
export let deck = (all: Bundle[], judge?: Eid): Deck => {
  let round = wearing(all, 'round')[0]
  let attempts = byEid(wearing(all, 'writing'))
  let cases = byEid(wearing(all, 'case'))
  let mine = (b: Bundle) => !judge || comp(b, 'created').by == judge
  let between = (a: Eid, b: Eid) => [a, b].sort().join('|')
  let preferred = new Map(
    wearing(all, 'preference').filter(mine).map((p) => [
      between(
        str(comp(p, 'preference').first),
        str(comp(p, 'preference').second),
      ),
      p,
    ]),
  )
  let grabs = new Map(
    wearing(all, 'grabbed').filter(mine).map((g) => [
      str(comp(g, 'grabbed').attempt),
      g.entity.eid,
    ]),
  )
  let about = (a: Eid) =>
    root(cases, str(comp(attempts.get(a), 'writing').case))
  // A case with a name to keep from the judge is shown untitled.
  let secret = (a: Eid) => {
    let c = cases.get(str(comp(attempts.get(a), 'writing').case))
    return !!(c?.found || c?.riddle)
  }
  let pitch = (eid: Eid): Pitch => ({
    eid,
    parts: (comp(attempts.get(eid), 'writing').output ?? {}) as Record<
      string,
      string
    >,
    ...grabs.has(eid) ? { grabbed: grabs.get(eid) } : {},
  })
  let card = (a: Eid, b: Eid): Card => {
    let [first, second] = swapped(a, b) ? [b, a] : [a, b]
    let p = preferred.get(between(a, b))
    let said = comp(p, 'preference')
    return {
      title: secret(a) || secret(b)
        ? ''
        : str(comp(cases.get(about(a)), 'doc').title),
      case: about(a),
      first: pitch(first),
      second: pitch(second),
      ...p
        ? {
          preference: p.entity.eid,
          chose: said.chose ? str(said.chose) : null,
          ...said.why ? { why: str(said.why) } : {},
        }
        : {},
    }
  }
  let planned = wearing(all, 'pair')
    .map((p) => comp(p, 'pair'))
    .filter((p) => attempts.has(str(p.a)) && attempts.has(str(p.b)))
    .sort((x, y) => Number(x.ord) - Number(y.ord))
    .map((p): [Eid, Eid] => [str(p.a), str(p.b)])
  let inDeck = [...new Set(planned.flat())]
  let own = [...attempts.values()]
    .filter((a) => !comp(a, 'writing').variant)
    .sort((x, y) =>
      str(comp(x, 'created').at) < str(comp(y, 'created').at) ? -1 : 1
    )
    .flatMap((a) =>
      inDeck
        .filter((o) => about(o) == about(a.entity.eid))
        .sort((x, y) =>
          derivedEid(a.entity.eid + x) < derivedEid(a.entity.eid + y) ? -1 : 1
        )
        .slice(0, AGAINST)
        .map((o): [Eid, Eid] => [a.entity.eid, o])
    )
  return {
    title: str(comp(round, 'doc').title),
    parts: (comp(round, 'round').parts ?? []) as string[],
    cards: [...planned, ...own].map(([a, b]) => card(a, b)),
  }
}

type Count = {
  shown: number
  preferred: number
  neither: number
  grabbed: number
  attempts: number
  ranks: number[]
  among: number[]
}
let count = (): Count => ({
  shown: 0,
  preferred: 0,
  neither: 0,
  grabbed: 0,
  attempts: 0,
  ranks: [],
  among: [],
})
let mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length

// Ranks with ties sharing their mean place, for Spearman's coefficient.
let ranked = (ns: number[]): number[] => {
  let order = ns.map((n, i) => [n, i]).sort((a, b) => a[0] - b[0])
  let out = new Array<number>(ns.length)
  for (let i = 0; i < order.length;) {
    let j = i
    while (j < order.length && order[j][0] == order[i][0]) j++
    for (let k = i; k < j; k++) out[order[k][1]] = (i + j - 1) / 2
    i = j
  }
  return out
}

/// spearman([1, 2, 3], [3, 2, 1]) -> -1
/// spearman([1, 2, 3], [5, 5, 5]) -> undefined
/** Spearman's rank correlation of two lists, undefined where either does not
 * vary. */
export let spearman = (xs: number[], ys: number[]): number | undefined => {
  let [a, b] = [ranked(xs), ranked(ys)]
  let [ma, mb] = [mean(a), mean(b)]
  let dot = (p: number[], mp: number, q: number[], mq: number) =>
    p.reduce((s, v, i) => s + (v - mp) * (q[i] - mq), 0)
  let d = Math.sqrt(dot(a, ma, a, ma) * dot(b, mb, b, mb))
  return d ? dot(a, ma, b, mb) / d : undefined
}

let table = (lines: string[][]): string[] => {
  let wide = lines[0].map((_, i) => Math.max(...lines.map((l) => l[i].length)))
  return lines.map((l) =>
    l.map((c, i) => i ? c.padStart(wide[i]) : c.padEnd(wide[i])).join('  ')
      .trimEnd()
  )
}

/**
 * What a round's rows say, as text for whoever plans the next round. For each
 * variant, persona arm and case: how many comparisons its attempts were shown
 * in, how often preferred, how often neither was, how many attempts grabbed a
 * judge; and from the guessing judges, the mean guesses until right (a miss
 * counts as its cap plus one) and how often a choice among the group was
 * right. Then whether the variants preferred are the ones guessed soonest,
 * each attempt that grabbed, and each why. `label` names a variant or case
 * more shortly than its title, where the caller knows how.
 */
export let tally = (
  all: Bundle[],
  label: (b: Bundle) => string = (b) => str(comp(b, 'doc').title),
): string => {
  let round = wearing(all, 'round')[0]
  let attempts = byEid(wearing(all, 'writing'))
  let named = byEid(all)
  let said = (eid: unknown) =>
    named.has(str(eid)) ? label(named.get(str(eid))!) : '(their own)'
  let keys = (a: Bundle): [string, string][] => {
    let at = comp(a, 'writing')
    return [
      ['variant', said(at.variant)],
      [
        'persona',
        !at.variant ? '(their own)' : at.persona ? 'persona' : 'blank',
      ],
      ['case', said(at.case)],
    ]
  }
  let counts = new Map<string, Map<string, Count>>()
  let each = (eid: unknown, f: (c: Count) => void) => {
    let a = attempts.get(str(eid))
    if (!a) return
    for (let [by, name] of keys(a)) {
      let of = counts.get(by) ?? new Map<string, Count>()
      counts.set(by, of)
      of.set(name, of.get(name) ?? count())
      f(of.get(name)!)
    }
  }
  for (let a of attempts.values()) each(a.entity.eid, (c) => c.attempts++)
  let preferences = wearing(all, 'preference').map((p) => comp(p, 'preference'))
  for (let p of preferences) {
    for (let side of [p.first, p.second]) {
      each(side, (c) => {
        c.shown++
        if (!p.chose) c.neither++
        else if (p.chose == side) c.preferred++
      })
    }
  }
  let grabbed = wearing(all, 'grabbed')
  for (let g of grabbed) each(comp(g, 'grabbed').attempt, (c) => c.grabbed++)
  let guesses = wearing(all, 'guess').map((g) => comp(g, 'guess'))
  for (let g of guesses) {
    each(g.attempt, (c) => {
      if (g.form == 'among') c.among.push(g.rank == 1 ? 1 : 0)
      else c.ranks.push(Number(g.rank ?? Number(g.cap ?? 0) + 1))
    })
  }
  let share = (n: number, of: number) =>
    of ? `${n} (${Math.round(100 * n / of)}%)` : '-'
  let section = (by: string): string[] => [
    '',
    ...table([
      [
        `By ${by}`,
        'attempts',
        'shown',
        'preferred',
        'neither',
        'grabbed',
        'guesses',
        'among',
      ],
      ...[...counts.get(by) ?? []].map(([name, c]) => [
        name,
        String(c.attempts),
        String(c.shown),
        share(c.preferred, c.shown),
        share(c.neither, c.shown),
        String(c.grabbed),
        c.ranks.length
          ? `${mean(c.ranks).toFixed(1)} (n=${c.ranks.length})`
          : '-',
        c.among.length
          ? `${Math.round(100 * mean(c.among))}% (n=${c.among.length})`
          : '-',
      ]),
    ]),
  ]
  let both = [...counts.get('variant') ?? []].filter(([, c]) =>
    c.shown && c.ranks.length
  )
  let rho = both.length > 2
    ? spearman(
      both.map(([, c]) => c.preferred / c.shown),
      both.map(([, c]) => mean(c.ranks)),
    )
    : undefined
  let agreement = rho == undefined
    ? `Agreement: not enough to say (${both.length} variants have both a comparison and a guess; three that vary are needed).`
    : `Agreement: over ${both.length} variants, Spearman's rho between the share preferred and the mean guesses until right is ${
      rho.toFixed(2)
    }: ${
      rho <= -0.3
        ? 'the variants preferred are guessed sooner (they agree)'
        : rho >= 0.3
        ? 'the variants preferred take more guesses (they disagree)'
        : 'no clear relation'
    }.`
  let line = (eid: unknown) => {
    let a = attempts.get(str(eid))
    let parts = Object.values(
      (comp(a, 'writing').output ?? {}) as Record<string, string>,
    )
    return a
      ? `"${str(parts[0])}" [${keys(a).map(([, v]) => v).join(' / ')}]`
      : str(eid)
  }
  let whys = preferences.filter((p) => p.why)
  return [
    `${str(comp(round, 'doc').title)} (skill: ${
      str(comp(round, 'round').skill)
    })`,
    `${attempts.size} attempts, ${
      wearing(all, 'pair').length
    } pairs, ${preferences.length} comparisons made, ${
      preferences.filter((p) => !p.chose).length
    } of them neither, ${grabbed.length} grabbed, ${guesses.length} guesses.`,
    'guesses: mean guesses until right in the open form, a miss counted as its cap plus one. among: how often the pick among the group was right.',
    ...['variant', 'persona', 'case'].flatMap(section),
    '',
    agreement,
    ...grabbed.length
      ? [
        '',
        'Grabbed:',
        ...grabbed.map((g) => `- ${line(comp(g, 'grabbed').attempt)}`),
      ]
      : [],
    ...whys.length
      ? [
        '',
        'Why:',
        ...whys.map((p) =>
          `- ${str(p.why)}: ${
            p.chose ? `chose ${line(p.chose)} over` : 'neither of'
          } ${line(p.chose == p.first ? p.second : p.first)}${
            p.chose ? '' : ` and ${line(p.second)}`
          }`
        ),
      ]
      : [],
  ].join('\n')
}
