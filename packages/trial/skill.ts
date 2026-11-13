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
 * - A **pair** is two attempts to compare: `pair{round, a, b, ord}`, wearing
 *   `known{winner}` where its winner was settled when it was planned, and
 *   `held_out{at, by, via}` where a person's tap on it is kept from selectors.
 * - A person's taps are `preference{first, second, chose, judge, why}` and
 *   `grabbed{attempt}`, each a row its `created.by` wrote and naming no judge.
 * - An automated **judge** is `doc{title}` + `judge{taught}`. Its verdicts
 *   name it: a `preference`, or `guess{attempt, judge, form, model, guesses,
 *   among, rank, cap, leaked}`.
 * - A round's `passing{share, at, by, via}` is how much of the known answers
 *   a judge must get right before its verdicts count.
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
 * equal(made.length, 5) // the skill, the round, its variant, its case, the attempt
 * equal(made[1].round, { skill: '$skill', parts: ['headline'] })
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
  /** the title of the skill being developed, found again as
   * `skill:<title>`; variants and cases are named under it */
  skill: string
  /** the parts every attempt returns, in order */
  output: string[]
  /** the persona a `persona: true` writer carried, by id (`N-4053`) */
  persona?: string | null
  /** the provider and model its writers and judges are asked, by name */
  using?: { provider: string; model: string; effort?: string }
  /** the wording its writers are given (`writers{task, skilled, rule}`) */
  writers?: { task: string; skilled?: string; rule?: string }
  /** attempts still to be written, and the judges to ask of each: every
   * variant at every case, by each arm (`true` carries the persona), `runs`
   * times over */
  plan?: {
    variants: string[]
    cases: string[]
    personas: boolean[]
    runs?: number
    judges?: string[]
  }
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
    /** absent on an attempt still to be written */
    output?: Record<string, string>
    usage?: { input?: number; output?: number; dollars?: number; ms?: number }
  }[]
  /** automated judges, each found again as `judge:<skill>:<key>`; `taught`
   * for one handed a person's taps as examples. One that guesses says its
   * `form`, the parts it is `shown`, its `question` and its `cap`
   * (`judge{taught, form, shown, question, cap}`) */
  judges?: {
    key: string
    title: string
    taught?: boolean
    form?: string
    shown?: string[]
    question?: string
    cap?: number
  }[]
  pairs?: [string, string][]
  /** planted known answers: pairs whose winner is settled, the winner first.
   * Each is a pair of the deck besides `pairs`, placed among them */
  known?: [string, string][]
  guesses?: {
    attempt: string
    /** the key of the judge that guessed; a guess naming none is given the
     * round's guessing game in its form, `<round>.guess-<form>`. One that
     * names a judge and has no `guesses` is still to be asked */
    judge?: string
    form?: string
    model?: string
    guesses?: string[]
    among?: string[]
    rank?: number | null
    cap?: number
    leaked?: string[]
    dollars?: number | null
  }[]
}

/** The names a round, a variant and a case are found again by (@yaks/alias):
 * a second load lands on the rows of the first. */
export let named = {
  round: (key: string): string => `round:${key}`,
  skill: (title: string): string => `skill:${title}`,
  variant: (skill: string, key: string): string => `variant:${skill}:${key}`,
  case: (skill: string, key: string): string => `case:${skill}:${key}`,
  judge: (skill: string, key: string): string => `judge:${skill}:${key}`,
}

/** The eid of a row a load must find again and nobody names: an attempt, a
 * pair, a guess, each derived from its round's key and its own. */
export let loaded = (comp: string, round: string, ...key: string[]): Eid =>
  derivedEid([comp, round, ...key].join('|'))

// A component without its absent properties: a file says null for none.
let some = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))

/// planned({ variants: ['none'], cases: ['office'], personas: [false, true] }).attempts.map((a) => a.key) -> ['office.none.blank.1', 'office.none.persona.1']
/** A plan written out: one attempt still to be written for each case,
 * variant, arm and run, and one guess still to be asked for each of them and
 * each judge the plan names. */
export let planned = (
  plan: NonNullable<RoundFile['plan']>,
): Required<Pick<RoundFile, 'attempts' | 'guesses'>> => {
  let attempts = plan.cases.flatMap((kase) =>
    plan.variants.flatMap((variant) =>
      plan.personas.flatMap((persona) =>
        Array.from({ length: plan.runs ?? 1 }, (_, i) => ({
          key: `${kase}.${variant}.${persona ? 'persona' : 'blank'}.${i + 1}`,
          case: kase,
          variant,
          persona,
          run: i + 1,
        }))
      )
    )
  )
  return {
    attempts,
    guesses: attempts.flatMap((a) =>
      (plan.judges ?? []).map((judge) => ({ attempt: a.key, judge }))
    ),
  }
}

/**
 * The rows of a round file, as one batch: the round, its variants and cases
 * (each under its name, so a file that names one a former round loaded lands
 * on it), its judges the same way, the models named, then attempts, pairs
 * and guesses on derived eids. A key the file does not hold is taken as one a
 * former round loaded.
 */
export let rows = (file: RoundFile): Bundle[] => {
  let plan = file.plan ? planned(file.plan) : { attempts: [], guesses: [] }
  file = {
    ...file,
    attempts: [...file.attempts ?? [], ...plan.attempts],
    guesses: [...file.guesses ?? [], ...plan.guesses],
  }
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
  // A guess that names no judge is the round's own guessing game in its form.
  let game = (form: string) => `${file.key}.guess-${form}`
  let form = (g: { form?: string }) => g.form ?? 'open'
  let judges = [
    ...file.judges ?? [],
    ...[
      ...new Set(
        (file.guesses ?? []).filter((g) => !g.judge).map((g) => form(g)),
      ),
    ].map((form): NonNullable<RoundFile['judges']>[number] => ({
      key: game(form),
      title: `The guessing game, ${form} form (${file.key})`,
      form,
    })),
  ]
  let judged = held(judges)
  let judge = (key: string) =>
    judged.has(key) ? `$judge:${key}` : named.judge(file.skill, key)
  // A planted pair's place among the planned ones: a bit of its eid, so it
  // holds across loads and says nothing of what it is.
  let among = (eid: Eid) =>
    parseInt(derivedEid(`ord|${eid}`).slice(-6), 16) %
      ((file.pairs?.length ?? 0) + 1) - 0.5
  let models = [
    ...new Set(
      [
        ...file.using ? [file.using] : [],
        ...file.attempts ?? [],
        ...file.guesses ?? [],
      ]
        .flatMap((x) => x.model ? [x.model] : []),
    ),
  ]
  let nth = new Map<string, number>()
  return [
    // The skill, found again by its title: a load makes it where none is.
    {
      entity: { eid: '$skill' },
      alias: { name: named.skill(file.skill) },
      skill: {},
      doc: { title: file.skill },
    },
    {
      entity: { eid: '$round' },
      alias: { name: named.round(file.key) },
      round: { skill: '$skill', parts: file.output },
      doc: { title: file.title },
      ...file.writers ? { writers: some(file.writers) } : {},
      ...file.using
        ? {
          using: some({
            provider: '$provider',
            model: `$model:${file.using.model}`,
            effort: file.using.effort,
          }),
        }
        : {},
    },
    ...file.using
      ? [{
        entity: { eid: '$provider' },
        provider: { name: file.using.provider },
      }]
      : [],
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
    ...judges.map((j): Bundle => ({
      entity: { eid: `$judge:${j.key}` },
      alias: { name: named.judge(file.skill, j.key) },
      judge: some({
        taught: j.taught,
        form: j.form,
        shown: j.shown,
        question: j.question,
        cap: j.cap,
      }),
      doc: { title: j.title },
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
    ...(file.known ?? []).map(([winner, other]): Bundle => {
      let eid = loaded('pair', file.key, winner, other)
      return {
        entity: { eid },
        pair: {
          round: '$round',
          a: attempt(winner),
          b: attempt(other),
          ord: among(eid),
        },
        known: { winner: attempt(winner) },
      }
    }),
    ...(file.guesses ?? []).map((g): Bundle => {
      // A judge guesses once at an attempt; guesses that name none are told
      // apart by their form, their model and their place among the like.
      let said = g.judge
        ? [g.attempt, g.judge]
        : [g.attempt, g.form ?? '', g.model ?? '']
      let n = nth.get(said.join('|')) ?? 0
      nth.set(said.join('|'), n + 1)
      return {
        entity: {
          eid: loaded(
            'guess',
            file.key,
            ...said,
            ...g.judge ? [] : [String(n)],
          ),
        },
        ...g.dollars != null
          ? { cost: { dollars: g.dollars, reported: false } }
          : {},
        guess: some({
          attempt: attempt(g.attempt),
          judge: judge(g.judge ?? game(form(g))),
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

// Two attempts as one pair, whichever is named first.
let between = (a: unknown, b: unknown) => [str(a), str(b)].sort().join('|')
let ends = (p: Bundle) => between(comp(p, 'pair').a, comp(p, 'pair').b)
// A person's taps: the comparisons that name no judge.
let taps = (all: Bundle[]) =>
  wearing(all, 'preference').map((p) => comp(p, 'preference'))
    .filter((p) => !p.judge)
// The pairs whose tap is kept from selectors.
let heldOut = (all: Bundle[]) =>
  new Set(wearing(all, 'pair').filter((p) => p.held_out).map(ends))

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

/** What the page is handed for a round: its cards in order, and the parts
 * each pitch has. */
export type Deck = {
  round: Eid
  title: string
  parts: string[]
  cards: Card[]
}

/** How many of the round's attempts a person's own attempt is set against. */
export let AGAINST = 3

// Whether a pair is shown b first: a bit of its two eids, so the order holds
// across reloads and follows nothing the runner chose.
let swapped = (a: Eid, b: Eid) =>
  parseInt(derivedEid(`shown|${a}|${b}`).slice(-1), 16) % 2 == 1

/**
 * The deck a judge taps through: the round's pairs in their order, each
 * shuffled, then each attempt a person wrote themselves set against
 * {@link AGAINST} attempts about the same thing. It is what any judge is
 * handed, a person or an automated one: a card carries that judge's own
 * preference and marks and nobody else's, and never an attempt's variant,
 * persona or model, nor whether the pair's answer is known or held out. With
 * no judge it carries no preference at all.
 */
export let deck = (all: Bundle[], judge?: Eid): Deck => {
  let round = wearing(all, 'round')[0]
  let attempts = byEid(wearing(all, 'writing'))
  let cases = byEid(wearing(all, 'case'))
  let mine = (b: Bundle) =>
    !!judge && (comp(b, 'preference').judge ?? comp(b, 'created').by) == judge
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
    wearing(all, 'grabbed').filter((g) =>
      !!judge && comp(g, 'created').by == judge
    ).map((g) => [
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
    round: round?.entity.eid ?? '',
    title: str(comp(round, 'doc').title),
    parts: (comp(round, 'round').parts ?? []) as string[],
    cards: [...planned, ...own].map(([a, b]) => card(a, b)),
  }
}

/** A pair whose winner is settled: the attempt every judge should pick, and
 * the one it was set against. `tapped` when a person's tap settled it, and
 * then `held` when that tap is kept from selectors; otherwise it was planted
 * (`known{winner}`). */
export type Answer = {
  winner: Eid
  other: Eid
  tapped: boolean
  held: boolean
}

/**
 * A round's known answers, by pair: each pair a person tapped and chose in,
 * then each pair wearing `known{winner}` that no person has tapped. A
 * person's tap outranks a planted answer, so a pair they called neither, or
 * that two people chose differently in, is not known. Nothing here is on a
 * card: a judge cannot tell these pairs from the rest.
 */
export let answers = (all: Bundle[]): Map<string, Answer> => {
  let out = new Map<string, Answer>()
  for (let p of wearing(all, 'pair')) {
    let { a, b } = comp(p, 'pair'), winner = str(comp(p, 'known').winner)
    if (winner && (winner == a || winner == b)) {
      out.set(between(a, b), {
        winner,
        other: str(winner == a ? b : a),
        tapped: false,
        held: false,
      })
    }
  }
  let held = heldOut(all), said = new Map<string, Row[]>()
  for (let t of taps(all)) {
    let key = between(t.first, t.second)
    said.set(key, [...said.get(key) ?? [], t])
  }
  for (let [key, [t, ...more]] of said) {
    let winner = str(t.chose)
    if (winner && more.every((m) => m.chose == winner)) {
      out.set(key, {
        winner,
        other: str(winner == t.first ? t.second : t.first),
        tapped: true,
        held: held.has(key),
      })
    } else out.delete(key)
  }
  return out
}

/**
 * What a selector is handed to learn one person's taste: the cards that
 * person tapped, less every one whose pair is `held_out`. Those taps test the
 * selector, so it never sees them.
 */
export let examples = (all: Bundle[], person: Eid): Card[] => {
  let held = heldOut(all)
  return deck(all, person).cards.filter((c) =>
    c.preference && !held.has(between(c.first.eid, c.second.eid))
  )
}

/**
 * The pairs to mark `held_out` so that `share` of the round's pairs are:
 * chosen among those no person has tapped yet, in an order made from their
 * eids. A pair already held stays, and a tapped pair is never added, since a
 * selector may already have been handed its tap.
 */
export let hold = (all: Bundle[], share: number): Eid[] => {
  let pairs = wearing(all, 'pair')
  let tapped = new Set(taps(all).map((t) => between(t.first, t.second)))
  let place = (p: Bundle) => derivedEid(`held|${p.entity.eid}`)
  return pairs
    .filter((p) => !p.held_out && !tapped.has(ends(p)))
    .sort((x, y) => place(x) < place(y) ? -1 : 1)
    .slice(
      0,
      Math.max(
        0,
        Math.round(share * pairs.length) -
          pairs.filter((p) => p.held_out).length,
      ),
    )
    .map((p) => p.entity.eid)
}

// How far from right one guess was: in the open form the guesses until right
// (a miss counts as its cap plus one), in the among form 0 for right and 1
// for wrong.
let off = (g: Row): number =>
  g.form == 'among'
    ? g.rank == 1 ? 0 : 1
    : Number(g.rank ?? Number(g.cap ?? 0) + 1)

/**
 * One judge's pick of a pair, from its own rows. Where it compared the two
 * (`preference`), the one it chose. Where it scored attempts one at a time
 * (`guess`), the one it was less far from right on, over its guesses at
 * each. `null` when it judged the pair and picked neither, or scored the two
 * the same; `undefined` when it did not judge the pair, or guessed at only
 * one of the two.
 */
export let picker = (
  preferences: Row[],
  guesses: Row[],
): (a: Eid, b: Eid) => Eid | null | undefined => {
  let chose = new Map<string, Row[]>(), far = new Map<string, number[]>()
  for (let p of preferences) {
    let key = between(p.first, p.second)
    chose.set(key, [...chose.get(key) ?? [], p])
  }
  for (let g of guesses) {
    far.set(str(g.attempt), [...far.get(str(g.attempt)) ?? [], off(g)])
  }
  let less = (x: number, y: number, a: Eid, b: Eid) =>
    x < y ? a : y < x ? b : null
  return (a, b) => {
    let rows = chose.get(between(a, b))
    let times = (e: Eid) => rows!.filter((r) => r.chose == e).length
    if (rows) return less(times(b), times(a), a, b)
    let [x, y] = [far.get(a), far.get(b)]
    return x && y ? less(mean(x), mean(y), a, b) : undefined
  }
}

/** One automated judge of a round, held to its known answers: what it
 * compared and guessed, its pick of a pair, how many known answers it `sat`
 * and `agreed` on, and its `result` against the round's passing share. */
export type Standing = {
  eid: Eid
  taught: boolean
  compared: Row[]
  guessed: Row[]
  pick: (a: Eid, b: Eid) => Eid | null | undefined
  sat: number
  agreed: number
  result: 'passed' | 'failed' | 'untested' | 'no passing share'
}

/** Every automated judge that gave a round a verdict, and where it stands.
 * A taught judge sits only planted pairs and held-out taps. */
export let standings = (all: Bundle[]): Standing[] => {
  let named = byEid(all), known = answers(all)
  let verdicts = wearing(all, 'preference').map((p) => comp(p, 'preference'))
    .filter((p) => p.judge)
  let guesses = wearing(all, 'guess').map((g) => comp(g, 'guess'))
  let share = comp(wearing(all, 'round')[0], 'passing').share
  let bar = share == null ? undefined : Number(share)
  return [
    ...new Set([...verdicts, ...guesses].map((v) => str(v.judge))),
  ].map((eid) => {
    let taught = !!comp(named.get(eid), 'judge').taught
    let mine = (v: Row) => str(v.judge) == eid
    let compared = verdicts.filter(mine), guessed = guesses.filter(mine)
    let pick = picker(compared, guessed)
    let picks = [...known.values()]
      .filter((k) => !taught || !k.tapped || k.held)
      .map((k) => [pick(k.winner, k.other), k.winner])
      .filter(([p]) => p !== undefined)
    let sat = picks.length, agreed = picks.filter(([p, w]) => p == w).length
    let result: Standing['result'] = !sat
      ? 'untested'
      : bar == undefined
      ? 'no passing share'
      : agreed / sat >= bar
      ? 'passed'
      : 'failed'
    return { eid, taught, compared, guessed, pick, sat, agreed, result }
  })
}

type Count = {
  shown: number
  preferred: number
  neither: number
  grabbed: number
  attempts: number
  judged: number
  picked: number
  ranks: number[]
  among: number[]
}
let count = (): Count => ({
  shown: 0,
  preferred: 0,
  neither: 0,
  grabbed: 0,
  attempts: 0,
  judged: 0,
  picked: 0,
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

// A count with its noun: `1 pair`, `2 guesses`.
let many = (n: number, one: string, more = `${one}s`) =>
  `${n} ${n == 1 ? one : more}`
let share = (n: number, of: number) =>
  of ? `${n} (${Math.round(100 * n / of)}%)` : '-'

let table = (lines: string[][]): string[] => {
  let wide = lines[0].map((_, i) => Math.max(...lines.map((l) => l[i].length)))
  return lines.map((l) =>
    l.map((c, i) => i ? c.padStart(wide[i]) : c.padEnd(wide[i])).join('  ')
      .trimEnd()
  )
}

// A column of a tally's tables: its heading and what it says of one count.
type Column = [string, (c: Count) => string]
let TAPPED: Column[] = [
  ['attempts', (c) => String(c.attempts)],
  ['shown', (c) => String(c.shown)],
  ['preferred', (c) => share(c.preferred, c.shown)],
  ['neither', (c) => share(c.neither, c.shown)],
  ['grabbed', (c) => String(c.grabbed)],
]
let JUDGED: Column[] = [
  ['judged', (c) => String(c.judged)],
  ['picked', (c) => share(c.picked, c.judged)],
]
let GUESSED: Column[] = [
  [
    'guesses',
    (c) =>
      c.ranks.length
        ? `${mean(c.ranks).toFixed(1)} (n=${c.ranks.length})`
        : '-',
  ],
  [
    'among',
    (c) =>
      c.among.length
        ? `${Math.round(100 * mean(c.among))}% (n=${c.among.length})`
        : '-',
  ],
]

/**
 * What a round's rows say, as text for whoever plans the next round.
 *
 * First a person's taps. For each variant, persona arm and case: how many
 * comparisons its attempts were shown in, how often preferred, how often
 * neither was, and how many attempts grabbed.
 *
 * Then the judges. The round's known answers ({@link answers}) are counted,
 * and each automated judge is scored on those it sat: its pick of the pair
 * ({@link picker}) was the winner, or was not. A judge taught from a
 * person's taps sits only planted pairs and held-out taps. A judge passes
 * when it agreed on at least the round's `passing{share}` of what it sat;
 * with no share set, or nothing sat, none has. Each judge's verdicts on the
 * pairs with no known answer follow, the judges that passed first and every
 * other apart, under "Not to be used": `judged` and `picked` count the pairs
 * it gave a verdict on and the attempts it picked, and a guessing judge adds
 * its mean guesses until right and how often its pick among the group was
 * right, with whether the variants a person preferred are the ones it guessed
 * soonest.
 *
 * Last, each attempt that grabbed and each why. `label` names a variant or
 * case more shortly than its title, where the caller knows how.
 */
export let tally = (
  all: Bundle[],
  label: (b: Bundle) => string = (b) => str(comp(b, 'doc').title),
): string => {
  let round = wearing(all, 'round')[0]
  let attempts = byEid(wearing(all, 'writing'))
  let named = byEid(all)
  let titled = (eid: unknown) =>
    str(comp(named.get(str(eid)), 'doc').title) || str(eid)
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
  type Counts = Map<string, Map<string, Count>>
  // Counts by variant, persona arm and case, and the way to add to them for
  // one attempt.
  let counting = (): [
    Counts,
    (eid: unknown, f: (c: Count) => void) => void,
  ] => {
    let counts: Counts = new Map()
    return [counts, (eid, f) => {
      let a = attempts.get(str(eid))
      if (!a) return
      for (let [by, name] of keys(a)) {
        let of = counts.get(by) ?? new Map<string, Count>()
        counts.set(by, of)
        of.set(name, of.get(name) ?? count())
        f(of.get(name)!)
      }
    }]
  }
  let sections = (counts: Counts, columns: Column[]): string[] =>
    ['variant', 'persona', 'case'].flatMap((by) => [
      '',
      ...table([
        [`By ${by}`, ...columns.map(([name]) => name)],
        ...[...counts.get(by) ?? []].map(([name, c]) => [
          name,
          ...columns.map(([, say]) => say(c)),
        ]),
      ]),
    ])

  let [tapped, tap] = counting()
  for (let a of attempts.values()) tap(a.entity.eid, (c) => c.attempts++)
  let preferences = taps(all)
  for (let p of preferences) {
    for (let side of [p.first, p.second]) {
      tap(side, (c) => {
        c.shown++
        if (!p.chose) c.neither++
        else if (p.chose == side) c.preferred++
      })
    }
  }
  let grabbed = wearing(all, 'grabbed')
  for (let g of grabbed) tap(comp(g, 'grabbed').attempt, (c) => c.grabbed++)

  let known = answers(all)
  let pairs = wearing(all, 'pair')
  let guesses = wearing(all, 'guess').map((g) => comp(g, 'guess'))
  let passing = comp(round, 'passing')
  let bar = passing.share == null ? undefined : Number(passing.share)
  // Whether the variants a person preferred are the ones a judge guessed
  // soonest.
  let agreement = (judged: Counts): string => {
    let both = [...judged.get('variant') ?? []].flatMap(([name, c]) => {
      let t = tapped.get('variant')?.get(name)
      return t?.shown && c.ranks.length
        ? [[t.preferred / t.shown, mean(c.ranks)]]
        : []
    })
    let rho = both.length > 2
      ? spearman(both.map(([p]) => p), both.map(([, r]) => r))
      : undefined
    return rho == undefined
      ? `By variant: not enough to say whether it guesses soonest what a person preferred (variants with both a comparison and a guess: ${both.length}; three that vary are needed).`
      : `By variant: over ${both.length} variants, Spearman's rho between the share a person preferred and its mean guesses until right is ${
        rho.toFixed(2)
      }: ${
        rho <= -0.3
          ? 'the variants preferred are guessed sooner (they agree)'
          : rho >= 0.3
          ? 'the variants preferred take more guesses (they disagree)'
          : 'no clear relation'
      }.`
  }
  let judges = standings(all).map((
    { eid, taught, compared, guessed, pick, sat, agreed, result },
  ) => {
    let [counts, add] = counting()
    let unknown = new Map<string, [Eid, Eid]>()
    for (let p of pairs) {
      unknown.set(ends(p), [str(comp(p, 'pair').a), str(comp(p, 'pair').b)])
    }
    for (let p of compared) {
      unknown.set(between(p.first, p.second), [str(p.first), str(p.second)])
    }
    let judged = 0
    for (let [key, [a, b]] of unknown) {
      let p = known.has(key) ? undefined : pick(a, b)
      if (p === undefined) continue
      judged++
      for (let side of [a, b]) {
        add(side, (c) => {
          c.judged++
          if (p == side) c.picked++
        })
      }
    }
    for (let g of guessed) {
      add(g.attempt, (c) =>
        (g.form == 'among' ? c.among : c.ranks).push(
          g.form == 'among' ? 1 - off(g) : off(g),
        ))
    }
    let title = (eid ? titled(eid) : '(no judge named)') +
      (taught ? ' (taught)' : '')
    let stands = result == 'passed'
      ? `${title} passed.`
      : `Not to be used: ${title} ${
        result == 'failed'
          ? `failed (it agreed on ${agreed} of the ${sat} known answers it sat)`
          : result == 'untested'
          ? 'is untested (it sat no known answer)'
          : 'has not passed (no passing share is set)'
      }.`
    return {
      title,
      row: [title, String(sat), share(agreed, sat), result],
      passed: result == 'passed',
      says: [
        '',
        judged || guessed.length
          ? `${stands} Its ${
            [
              ...judged ? ['verdicts on the pairs with no known answer'] : [],
              ...guessed.length ? ['guesses at every attempt'] : [],
            ].join(', and its ')
          }${result == 'passed' ? '' : ', apart'}:`
          : `${stands} It gave no verdict on a pair with no known answer.`,
        ...judged || guessed.length
          ? sections(counts, [
            ...judged ? JUDGED : [],
            ...guessed.length ? GUESSED : [],
          ])
          : [],
        ...guessed.some((g) => g.form != 'among')
          ? ['', agreement(counts)]
          : [],
      ],
    }
  }).sort((x, y) =>
    Number(y.passed) - Number(x.passed) || (x.title < y.title ? -1 : 1)
  )
  let settled = [...known.values()]
  let heldPairs = pairs.filter((p) => p.held_out).length

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
      titled(comp(round, 'round').skill)
    })`,
    [
      many(attempts.size, 'attempt'),
      many(pairs.length, 'pair'),
      `${many(preferences.length, 'comparison')} made`,
      `${preferences.filter((p) => !p.chose).length} of them neither`,
      `${grabbed.length} grabbed`,
      many(guesses.length, 'guess', 'guesses'),
    ].join(', ') + '.',
    ...sections(tapped, TAPPED),
    '',
    settled.length
      ? `Known answers: ${many(settled.length, 'pair')} (${
        settled.filter((k) => k.tapped).length
      } a person tapped, ${settled.filter((k) => !k.tapped).length} planted).`
      : 'Known answers: none yet. A person\'s tap on a pair makes it one, and a round file plants them under "known".',
    ...heldPairs
      ? [
        `Held out from selectors: ${heldPairs} of ${
          many(pairs.length, 'pair')
        }, ${settled.filter((k) => k.held).length} of them tapped.`,
      ]
      : [],
    bar == undefined
      ? 'Passing: no share is set on this round, so no judge has passed (yak trial pass <round> <share>).'
      : `Passing: a judge's pick is the winner on at least ${
        Math.round(100 * bar)
      }% of the known answers it sat${
        passing.by ? ` (set by ${titled(passing.by)})` : ''
      }.`,
    ...judges.length
      ? [
        'sat: the known answers the judge gave a verdict on; a taught judge sits only planted pairs and held-out taps. agreed: its pick was the winner; neither, or a tie, is not agreeing.',
        ...guesses.length
          ? [
            'guesses: mean guesses until right in the open form, a miss counted as its cap plus one. among: how often the pick among the group was right.',
          ]
          : [],
        '',
        ...table([
          ['Judge', 'sat', 'agreed', 'result'],
          ...judges.map((j) => j.row),
        ]),
        ...judges.flatMap((j) => j.says),
      ]
      : [],
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
