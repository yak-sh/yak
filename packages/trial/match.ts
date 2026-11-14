/**
 * A round of matches between any sides, and where each side stands after
 * them. A match round develops no skill and has no writers: its sides are
 * whatever is to be chosen between (drafts of an app, images, documents), each
 * two of them a pair under each question asked. People tap between them, and a
 * judge of the `pair` form may compare them too, each pair in both orders.
 *
 * Where a side stands is computed from the round's `preference` rows, never
 * stored: rated (./rating.ts) under each question on its own, from every
 * person's taps and the verdicts of each judge that passed the round's known
 * answers (./skill.ts `standings`). That is what narrows many sides to the few
 * a decision offers, and what each choice says was measured.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { matched, places } from '@yaks/trial/match'
 *
 * let made = matched({ key: 'r1', title: 'Covers', sides: ['x', 'y', 'z'] })
 * equal(made.filter((b) => b.pair).length, 3)
 * let pair = made.find((b) => b.pair)!
 * let tap = { entity: { eid: 't' }, created: { by: 'ada' },
 *   preference: { first: 'x', second: 'y', chose: 'x', pair: pair.entity.eid } }
 * equal(places([...made, tap]).map((p) => p.eid), ['x', 'z', 'y'])
 * ```
 *
 * @module
 */
import type { Bundle, Eid } from '@yaks/graph'
import { rate } from './rating.ts'
import { loaded, named, standings } from './skill.ts'

/** A round of matches to plan: its key (found again as `round:<key>`), its
 * title, the sides by eid, the questions each pair is asked (none asks which
 * is better as a whole), and a judge of the `pair` form to compare each pair
 * in both orders: its `question` the words it is asked (`$a`, `$b` and
 * `$question` filled in), and the provider and model asked, by name. */
export type Match = {
  key: string
  title: string
  sides: Eid[]
  questions?: string[]
  judge?: { title: string; question: string; provider: string; model: string }
}

let comp = (b: Bundle | undefined, name: string) =>
  (b?.[name] ?? {}) as Record<string, unknown>
let str = (v: unknown) => v == null ? '' : String(v)

/** The rows of a match round, as one batch: the round, a pair of each two
 * sides under each question, and, with a judge, the judge and its verdicts
 * still to be asked. Each row's eid is derived from the round's key, so
 * planning again lands on the rows of the first. */
export let matched = (m: Match): Bundle[] => {
  let sides = [...new Set(m.sides)]
  let questions = m.questions?.length ? [...new Set(m.questions)] : ['']
  let round = loaded('round', m.key)
  let judge = loaded('judge', m.key)
  let pairs = questions.flatMap((question) =>
    sides.flatMap((a, i) => sides.slice(i + 1).map((b) => ({ a, b, question })))
  ).map(({ a, b, question }, ord): Bundle => ({
    entity: {
      eid: loaded('pair', m.key, a, b, ...question ? [question] : []),
    },
    pair: { round, a, b, ord, ...question ? { question } : {} },
  }))
  let verdicts = m.judge
    ? pairs.flatMap((p) => {
      let { a, b, question } = comp(p, 'pair')
      return [[a, b], [b, a]].map(([first, second]): Bundle => ({
        entity: {
          eid: loaded(
            'preference',
            m.key,
            str(first),
            str(second),
            ...question ? [str(question)] : [],
          ),
        },
        preference: { first, second, pair: p.entity.eid, judge },
      }))
    })
    : []
  return [
    {
      entity: { eid: round },
      alias: { name: named.round(m.key) },
      round: {},
      doc: { title: m.title },
    },
    ...m.judge
      ? [{
        entity: { eid: judge },
        judge: { form: 'pair', question: m.judge.question },
        doc: { title: m.judge.title },
        using: { provider: '$provider', model: '$model' },
      }, {
        entity: { eid: '$provider' },
        provider: { name: m.judge.provider },
      }, {
        entity: { eid: '$model' },
        model: { name: m.judge.model },
      }]
      : [],
    ...pairs,
    ...verdicts,
  ]
}

/** How one side did under one question: its rating, the picks it was in
 * and won, and how many people and judges picked. */
export type Rated = {
  question: string
  rating: number
  picks: number
  won: number
  people: number
  judges: number
}

/** Where one side of a round stands: its place, highest first, its rating
 * (the mean of its ratings under each question it was picked under; 0 where
 * none), and how it did under each. */
export type Place = { eid: Eid; place: number; rating: number; rated: Rated[] }

/**
 * Every side of a round's pairs, highest rated first: rated from each
 * person's taps and each passing judge's verdicts, under each question apart.
 * A tap or verdict of neither counts as a pick for neither side.
 */
export let places = (all: Bundle[]): Place[] => {
  let pairs = all.filter((b) => b.pair)
  let asks = new Map(
    pairs.map((p) => [p.entity.eid, str(comp(p, 'pair').question)]),
  )
  let passed = new Set(
    standings(all).filter((s) => s.result == 'passed').map((s) => s.eid),
  )
  let picks = all.filter((b) => b.preference).flatMap((b) => {
    let p = comp(b, 'preference')
    let judge = str(p.judge)
    if (!asks.has(str(p.pair)) || judge && !passed.has(judge)) return []
    return [{
      a: str(p.first),
      b: str(p.second),
      chose: p.chose ? str(p.chose) : null,
      question: asks.get(str(p.pair)) ?? '',
      by: judge ? '' : str(comp(b, 'created').by),
      judge,
    }]
  })
  let sides = [
    ...new Set(pairs.flatMap((p) => [comp(p, 'pair').a, comp(p, 'pair').b])),
  ].map(str)
  let questions = [...new Set(picks.map((p) => p.question))]
  let rated = new Map(sides.map((s) => [s, [] as Rated[]]))
  for (let question of questions) {
    let here = picks.filter((p) => p.question == question)
    let rating = rate(here)
    for (let side of sides) {
      let mine = here.filter((p) => p.a == side || p.b == side)
      if (!mine.length) continue
      rated.get(side)!.push({
        question,
        rating: rating.get(side) ?? 0,
        picks: mine.length,
        won: mine.filter((p) => p.chose == side).length,
        people: new Set(mine.map((p) => p.by).filter((e) => e)).size,
        judges: new Set(mine.map((p) => p.judge).filter((e) => e)).size,
      })
    }
  }
  let mean = (rs: Rated[]) =>
    rs.length ? rs.reduce((n, r) => n + r.rating, 0) / rs.length : 0
  return sides
    .map((eid) => ({
      eid,
      rating: mean(rated.get(eid)!),
      rated: rated.get(eid)!,
    }))
    .sort((x, y) => y.rating - x.rating)
    .map((p, i) => ({ ...p, place: i + 1 }))
}

let many = (n: number, one: string, more = `${one}s`) =>
  `${n} ${n == 1 ? one : more}`

/** What was measured of one side, in a line a decision's choice can carry:
 * its place among `of`, its rating, and under each question the picks it
 * won and who made them. */
export let measured = (p: Place, of: number): string => {
  if (!p.rated.length) return `Not picked between yet (one of ${of})`
  let ORD = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth']
  let place = ORD[p.place - 1] ?? `${p.place}th`
  let who = (r: Rated) =>
    [
      r.people ? many(r.people, 'person', 'people') : '',
      r.judges ? many(r.judges, 'judge') : '',
    ].filter((s) => s).join(' and ')
  return `${place} of ${of} by its rating, ${Math.round(p.rating)}: ${
    p.rated.map((r) =>
      `chosen in ${r.won} of ${many(r.picks, 'pick')} by ${who(r)}${
        r.question ? ` under “${r.question}”` : ''
      }`
    ).join('; ')
  }`
}

/** Where a match round stands, as text: every side highest first, by eid,
 * with what was measured of it, the `few` a decision may offer marked. */
export let ranking = (all: Bundle[], few = 4): string => {
  let title = str(comp(all.find((b) => b.round), 'doc').title)
  let placed = places(all)
  if (!placed.length) return `${title || 'The round'} has no pairs.`
  return [
    `${title || 'The round'}: ${many(placed.length, 'side')}, highest first${
      placed.length > few ? `; the first ${few} are the ones to offer` : ''
    }.`,
    ...placed.map((p) =>
      `${p.place <= few ? '*' : '-'} ${p.eid}: ${measured(p, placed.length)}`
    ),
  ].join('\n')
}
