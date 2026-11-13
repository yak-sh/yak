/**
 * What a skill's rounds measured, as a public page shows it: for each round,
 * what was compared (its variants), on which cases, every output, who judged
 * and what won; and, across rounds, each version the skill became.
 *
 * A round counts as measured once a person has chosen between two of its
 * attempts. Automated judges are named only when they passed the round's
 * known answers. `ran` says which attempts written by a model are the
 * platform's own; an attempt it rejects is left out, with every tap on it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { measured } from '@yaks/trial/measured'
 *
 * let m = measured([{ entity: { eid: 'r' }, round: { parts: ['headline'] } }])
 * equal(m.measured, false)
 * ```
 *
 * @module
 */
import type { Bundle, Eid } from '@yaks/graph'
import { standings } from './skill.ts'

/** A candidate text of the skill, with how a person's taps went for it. */
export type Variant = {
  eid: Eid
  title: string
  body: string
  theory: string
  source: string
  licence: string
  from: Eid | null
  /** comparisons a person was shown it in */
  shown: number
  /** of those, how many they chose it in */
  preferred: number
}

/** One round of a skill, as its page shows it. */
export type Measured = {
  round: Eid
  title: string
  parts: string[]
  /** a person chose between two of its attempts */
  measured: boolean
  /** the people who chose, and how many choices they made */
  people: number
  picks: number
  variants: Variant[]
  /** what writers were handed. A case that is something its maker published
   * shows neither its title nor its text, which would name it. */
  cases: { eid: Eid; title: string; body: string }[]
  /** every attempt: its case, its variant (null for a person's own) and its
   * parts */
  outputs: {
    eid: Eid
    case: Eid
    variant: Eid | null
    parts: Record<string, string>
  }[]
  /** the automated judges that passed the round's known answers */
  judges: { eid: Eid; title: string; sat: number; agreed: number }[]
  /** the variant people preferred most often, when one led */
  winner: Eid | null
}

type Row = Record<string, unknown>
let comp = (b: Bundle | undefined, name: string): Row =>
  (b?.[name] ?? {}) as Row
let str = (v: unknown): string => v == null ? '' : String(v)

/** One round's rows (./round.ts `gather`), as its page shows them. */
export let measured = (
  all: Bundle[],
  ran: (attempt: Bundle) => boolean = () => true,
): Measured => {
  let round = all.find((b) => b.round)
  let kept = all.filter((b) =>
    b.writing && (!comp(b, 'writing').variant || ran(b))
  )
  let ids = new Set(kept.map((b) => b.entity.eid))
  let rows = all.filter((b) => {
    if (b.writing) return ids.has(b.entity.eid)
    let p = comp(b, 'preference'), pair = comp(b, 'pair')
    if (b.preference) return ids.has(str(p.first)) && ids.has(str(p.second))
    if (b.pair) return ids.has(str(pair.a)) && ids.has(str(pair.b))
    let at = comp(b, 'grabbed').attempt ?? comp(b, 'guess').attempt
    return at == null || ids.has(str(at))
  })
  let byEid = new Map(rows.map((b) => [b.entity.eid, b]))
  let taps = rows.filter((b) => b.preference && !comp(b, 'preference').judge)
  let chosen = taps.filter((b) => comp(b, 'preference').chose)
  let variantOf = (attempt: unknown) =>
    str(comp(byEid.get(str(attempt)), 'writing').variant)
  let tally = new Map<string, { shown: number; preferred: number }>()
  for (let t of taps) {
    let p = comp(t, 'preference')
    for (let side of [p.first, p.second]) {
      let v = variantOf(side)
      if (!v) continue
      let c = tally.get(v) ?? { shown: 0, preferred: 0 }
      c.shown++
      if (p.chose == side) c.preferred++
      tally.set(v, c)
    }
  }
  let used = (prop: string) =>
    [...new Set(kept.map((a) => str(comp(a, 'writing')[prop])))]
      .filter((e) => byEid.has(e)).map((e) => byEid.get(e)!)
  let variants = used('variant').map((b): Variant => {
    let v = comp(b, 'variant')
    return {
      eid: b.entity.eid,
      title: str(comp(b, 'doc').title),
      body: str(v.body),
      theory: str(v.theory),
      source: str(v.source),
      licence: str(v.licence),
      from: v.from ? str(v.from) : null,
      ...tally.get(b.entity.eid) ?? { shown: 0, preferred: 0 },
    }
  })
  let rate = (v: Variant) => v.shown ? v.preferred / v.shown : -1
  let [best, next] = [...variants].sort((a, b) => rate(b) - rate(a))
  let names = new Map(all.map((b) => [b.entity.eid, str(comp(b, 'doc').title)]))
  return {
    round: round?.entity.eid ?? '',
    title: str(comp(round, 'doc').title),
    parts: (comp(round, 'round').parts ?? []) as string[],
    measured: chosen.length > 0,
    people: new Set(chosen.map((t) => str(comp(t, 'created').by))).size,
    picks: chosen.length,
    variants,
    cases: used('case').map((b) => ({
      eid: b.entity.eid,
      title: b.found ? '' : str(comp(b, 'doc').title),
      body: b.found ? '' : str(comp(b, 'case').body),
    })),
    outputs: kept.filter((a) => comp(a, 'writing').output).map((a) => {
      let w = comp(a, 'writing')
      return {
        eid: a.entity.eid,
        case: str(w.case),
        variant: w.variant ? str(w.variant) : null,
        parts: w.output as Record<string, string>,
      }
    }),
    judges: standings(rows).filter((j) => j.result == 'passed').map((j) => ({
      eid: j.eid,
      title: names.get(j.eid) || j.eid,
      sat: j.sat,
      agreed: j.agreed,
    })),
    winner: best && best.shown && (!next || rate(best) > rate(next))
      ? best.eid
      : null,
  }
}

/** Each version the skill became, oldest first: the winner of each measured
 * round, with the title of the variant it was changed from. */
export let versions = (
  rounds: Measured[],
): { round: string; variant: Variant; from: string | null }[] => {
  let titles = new Map(
    rounds.flatMap((r) => r.variants.map((v) => [v.eid, v.title] as const)),
  )
  return rounds.flatMap((r) => {
    let won = r.measured && r.variants.find((v) => v.eid == r.winner)
    return won
      ? [{
        round: r.title,
        variant: won,
        from: won.from ? titles.get(won.from) ?? null : null,
      }]
      : []
  })
}
