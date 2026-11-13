/**
 * The tools: `trial_plan` plans a round from its file (./round.ts `load`),
 * `trial_cap` says what the round owes and sets the cap that runs it
 * (./effects.ts), `trial_tally` reads a skill round's rows and says what they
 * say (./skill.ts `tally`), `trial_pass` sets how much of the known answers a
 * judge of the round must get right, `trial_hold` marks the pairs whose tap
 * is kept from selectors (./skill.ts `hold`), and `trial_adopt` makes a
 * variant its skill's next version. Those that write a mark answer their
 * rows, which the runner applies as the caller; a plan is written as the
 * caller too.
 *
 * @module
 */
import type { Bundle, Eid, Graph } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import { actorOf, signed } from '@yaks/graph/provenance'
import type { Runs } from '@yaks/graph/tools'
import { said } from '@yaks/tools/result'
import { find, gather, keyed, load } from './round.ts'
import { type Asking, owes, owing, spent } from './run.ts'
import { hold, type RoundFile, tally } from './skill.ts'

/** What a host gives the tools: who would answer a round's calls, which
 * prices what `trial_cap` says a round will cost where no earlier row does,
 * and what whoever brings a round's cases hears before it runs, which a
 * plan's answer and a quote's carry: where the host shows them, say. */
export type Options = {
  asking?: (round: Bundle) => Asking | Promise<Asking>
  notice?: (round: Bundle) => string | undefined | Promise<string | undefined>
}

// The host's notice, after an answer that comes before a round runs.
let noticed = async (o: Options, graph: Graph, eid: Eid, line: string) => {
  if (!o.notice) return line
  let [row] = await graph.get([eid])
  let words = await o.notice(row)
  return words ? `${line} ${words}` : line
}

let usd = (n: number) => `$${n.toFixed(2)}`

// A round's file as a plan. What a run writes is refused, since only a run
// writes it: a skill's page shows only what the platform ran.
let plan = (file: unknown): RoundFile => {
  let f = file as RoundFile
  if (!f || typeof f != 'object' || typeof f.key != 'string' || !f.key) {
    throw new Refused('a round needs its file, with a `key`')
  }
  for (let need of ['title', 'skill'] as const) {
    if (typeof f[need] != 'string' || !f[need]) {
      throw new Refused(`a round's file needs its \`${need}\``)
    }
  }
  if (!Array.isArray(f.output) || !f.output.length) {
    throw new Refused(
      "a round's file needs its `output`: the parts every attempt returns",
    )
  }
  if (f.attempts?.some((a) => a.output || a.reply)) {
    throw new Refused(
      'a plan writes no attempt: only a run writes what a writer returned',
    )
  }
  if (f.guesses?.some((g) => g.guesses)) {
    throw new Refused(
      'a plan writes no guess: only a run writes what a judge said',
    )
  }
  return f
}

/** The tools this package runs. */
export let runs = (o: Options = {}): Runs => ({
  trial_plan: async (call, graph) => {
    let file = plan(argsOf(call).round)
    let { round, removed } = await load(graph, file, actorOf([call]))
    let all = await gather(graph, round, true)
    let count = (name: string) => all.filter((b) => b[name]).length
    let line = `${file.key} is planned: ${count('writing')} attempts, ${
      count('guess')
    } guesses and ${count('pair')} pairs${
      removed ? `, ${removed} rows of the last plan removed` : ''
    }. trial_cap says what it will cost.`
    return [said(call, await noticed(o, graph, round, line))]
  },
  trial_cap: async (call, graph) => {
    let { round, cap } = argsOf(call)
    let n = Number(cap)
    if (!(n >= 0)) throw new Refused(`a cap is dollars, as 2: ${cap}`)
    let eid = await find(graph, String(round))
    let [row] = await graph.get([eid])
    let [owed, paid] = await Promise.all([
      owing(graph, eid, { asking: await o.asking?.(row) }),
      spent(graph, eid),
    ])
    let line = `${owes(owed)}; its calls have cost ${usd(paid)} so far`
    if (!n) {
      return [
        said(
          call,
          await noticed(o, graph, eid, `${line}. Give a cap to run it.`),
        ),
      ]
    }
    if (n <= paid) {
      throw new Refused(
        `${line}, so a cap of ${usd(n)} asks nothing more: give one above it`,
      )
    }
    let entity = { eid }
    // A mark is stamped when first written: one already set is taken off
    // first, so who set this cap and when are whoever set it now, and
    // setting it again runs the round again.
    await graph.apply(signed([{ entity, capped: null }], actorOf([call])))
    return [
      { entity, capped: { dollars: n } },
      said(
        call,
        `${line}. Running, capped at ${
          usd(n)
        } in all: writers first, then the judges of what they wrote. trial_tally reads what came back.`,
      ),
    ]
  },
  trial_adopt: async (call, graph) => {
    let { round, variant } = argsOf(call)
    let all = await gather(graph, await find(graph, String(round)))
    let skill = String(
      (all.find((b) => b.round)?.round as { skill?: unknown })?.skill ?? '',
    )
    if (!skill) throw new Refused(`${round} develops no skill`)
    let label = await keyed(graph, all)
    let word = String(variant)
    let v = all.find((b) =>
      b.variant && (b.entity.eid == word || label(b) == word)
    )
    if (!v) throw new Refused(`${round} compared no variant ${word}`)
    let body = String((v.variant as { body?: unknown }).body ?? '')
    if (!body.trim()) {
      throw new Refused(
        `${
          label(v)
        } has no text, and a skill's next version needs its instructions`,
      )
    }
    await graph.apply(
      signed([{ entity: v.entity, adopted: null }], actorOf([call])),
    )
    return [
      { entity: { eid: skill }, content: { body } },
      { entity: v.entity, adopted: { skill } },
      said(
        call,
        `${
          label(v)
        } is now the skill's text, its next version. Where the skill is published, publish it again to offer this version; it is reviewed first.`,
      ),
    ]
  },
  trial_tally: async (call, graph) => {
    let all = await gather(
      graph,
      await find(graph, String(argsOf(call).round)),
    )
    return [said(call, tally(all, await keyed(graph, all)))]
  },
  trial_pass: async (call, graph) => {
    let { round, share } = argsOf(call)
    let n = Number(share)
    if (!(n >= 0 && n <= 1)) {
      throw new Refused(`a passing share is from 0 to 1, as 0.8: ${share}`)
    }
    let entity = { eid: await find(graph, String(round)) }
    // A mark is stamped when first written, so one already set is taken off
    // first: who set the share and when are whoever set this one.
    await graph.apply(signed([{ entity, passing: null }], actorOf([call])))
    return [
      { entity, passing: { share: n } },
      said(
        call,
        `a judge of ${round} now passes by agreeing on ${
          Math.round(100 * n)
        }% of the known answers it sat`,
      ),
    ]
  },
  trial_hold: async (call, graph) => {
    let { round, share } = argsOf(call)
    let all = await gather(graph, await find(graph, String(round)))
    let held = hold(all, Number(share))
    let pairs = all.filter((b) => b.pair)
    return [
      ...held.map((eid) => ({ entity: { eid }, held_out: {} })),
      said(
        call,
        `${held.length} more of ${round}'s pairs held out: ${
          pairs.filter((b) => b.held_out).length + held.length
        } of ${pairs.length} now are`,
      ),
    ]
  },
})
