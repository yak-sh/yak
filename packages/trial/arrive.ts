/**
 * What a variant adds at a door, replayed at a case's moment, for
 * `@yaks/trial/moment` to put in front beside the persona:
 *
 * - {@link beside}: beside each of the person's words in the window, what the
 *   prompt hook recalls (@yaks/memory/earlier): their nearest earlier words,
 *   memories and decisions, at a floor for the last two.
 * - {@link related}: beside each write's hit rows, the few nearest resources
 *   of any kind (@yaks/embedding/neighbours `hit.related`), as the graph
 *   stood when the write returned.
 * - {@link open}: at the session's start and after each compaction, what was
 *   open with the person, and the decisions they answered in the day before.
 *
 * Each reads the graph as it stands now, cut back at the moment: a row
 * created later is left out, and a body edited since reads as it does now.
 * The recall is given all the time it needs; the live hook gives it 700 ms.
 *
 * @module
 */
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { called } from '@yaks/graph/hit'
import type { Meaning } from '@yaks/host'
import { earlier } from '@yaks/memory/earlier'
import { FEW, resources } from '@yaks/embedding/neighbours'
import {
  and,
  eq,
  every,
  limit,
  lt,
  ne,
  near,
  order,
  present,
} from '@yaks/query'
import type { Part } from './mod.ts'
import { type Arrival, asOf, hits, prompt } from './moment.ts'

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''
let at = (b: Bundle): string => str(comp(b, 'created').at)
let body = (b: Bundle): string =>
  str(comp(b, 'content').body) || str(comp(b, 'doc').body)

// The ids a recall's lines open with ("M-17952 · …"), as eids.
let named = async (g: Graph, text: string): Promise<Eid[]> => {
  let ids = [...text.matchAll(/^(\S+) · /gm)].map((m) => m[1])
  let found = await g.address(ids)
  return ids.flatMap((id) => found.get(id) ?? [])
}

/** The prompt recall beside each of the person's words, its memories and
 * decisions kept to `floor`. */
export let beside = (
  g: Graph,
  { person, meaning, floor }: {
    person: Eid
    meaning?: Meaning
    floor?: number
  },
): Arrival =>
async ({ had }) => {
  let theirs = had.filter((b) =>
    prompt(b) && comp(b, 'created').by == person && !b.notice
  )
  let parts: Part[] = []
  for (let b of theirs) {
    let text = await earlier(g, {
      person,
      words: body(b),
      before: at(b),
      meaning,
      floor,
      wait: null,
    })
    if (text) parts.push({ door: 'notice', eids: await named(g, text), text })
  }
  return parts
}

/** The related list beside each write's hit rows: the {@link FEW} nearest
 * resources of any kind to the entity it made, past the ones its own list
 * showed, none written by the session itself. Cases that share a window share
 * its writes, so each write's list is read once. */
export let related = (g: Graph): Arrival => {
  let lists = new Map<string, Promise<Bundle[]>>()
  return async ({ vocab, m, had }) => {
    let kept = resources(vocab)
    let list = async (result: Bundle, rows: Bundle[], of: Eid) => {
      let shown = new Set([of, ...rows.map((r) => r.entity.eid)])
      let found = await g.read(and(
        lt('created.at', at(result)),
        ne('created.via', m.session),
        ...kept,
        near(of),
        order('similar'),
        limit(FEW + shown.size),
        every(),
      ))
      return found.filter((b) => !shown.has(b.entity.eid)).slice(0, FEW)
    }
    let out: Bundle[] = []
    for (let result of had) {
      let rows = hits(result)
      for (let of of new Set(rows.map((r) => str(comp(r, 'hit').near)))) {
        let key = `${result.entity.eid} ${of}`
        if (!lists.has(key)) lists.set(key, list(result, rows, of))
        out.push(...await lists.get(key)!)
      }
    }
    let name = called(vocab)
    return out.length
      ? [{
        door: 'hit',
        eids: out.map((b) => b.entity.eid),
        text: out.map((b) =>
          JSON.stringify({
            id: name(b),
            kind: vocab.kindOf(b),
            title: str(comp(b, 'doc').title) || body(b).slice(0, 120),
          })
        ).join('\n'),
      }]
      : []
  }
}

let DAY = 24 * 60 * 60 * 1000

/** What is open with the person at the window's start, and the decisions they
 * answered in the day before it. */
export let open =
  (person: Eid): Arrival => async ({ storage, vocab, since }) => {
    let then = asOf(storage, vocab, since)
    let day = new Date(Date.parse(since) - DAY).toISOString()
    let asks =
      (await then.read(and(eq('filed.assignee', person), present('task'))))
        .filter((b) => comp(b, 'task').status == 'open')
    let answered = (await then.read(and(
      eq('decided.by', person),
      present('decision'),
    ))).filter((b) => str(comp(b, 'decided').at) >= day)
    let rows = [...asks, ...answered]
    let name = called(vocab)
    return rows.length
      ? [{
        door: 'notice',
        eids: rows.map((b) => b.entity.eid),
        text: rows.map((b) =>
          `${name(b)} · ${str(comp(b, 'doc').title)}${
            b.decided ? ` → ${str(comp(b, 'decided').choice)}` : ''
          }`
        ).join('\n'),
      }]
      : []
  }
