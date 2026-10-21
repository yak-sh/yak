/**
 * The shelves: every topic laid out as a catalogue's tree. A shelf is a topic
 * and the shelves under it, the topics it holds (`contains`); the top shelves
 * are the topics no topic holds. Each level runs by title. A topic held by two
 * stands under both, and one met again on its own path stands there without
 * what it holds, so a cycle ends; topics held only by each other are still
 * shelved, at the top. Pure: the topics and their `contains` edges in, the
 * tree out, so the views draw it and a test reads it without a graph.
 *
 * @module
 */

import type { Bundle } from '@yaks/graph'
import { about, fits, title } from './topic.ts'

/** A topic, and the shelves of the topics it holds. */
export type Shelf = { topic: Bundle; under: Shelf[] }

let by = (a: Bundle, b: Bundle) =>
  title(a).localeCompare(title(b), undefined, { sensitivity: 'base' })

let eidOf = (b: Bundle) => b.entity.eid

let end = (e: Bundle, side: 'from' | 'to'): string => {
  let v = (e.edge as Record<string, unknown> | undefined)?.[side]
  return typeof v == 'string' ? v : ''
}

/**
 * The topics as shelves, from the topics and the `contains` edges among them;
 * an edge to or from anything else is left out.
 */
/// let t = (eid: string, body = '') => ({ entity: { eid }, doc: { title: eid, body } })
/// let held = (from: string, to: string) => ({ entity: { eid: from + to }, edge: { from, to }, contains: {} })
/// let names = (s: Shelf[]): unknown[] => s.map((x) => x.under.length ? [x.topic.entity.eid, names(x.under)] : x.topic.entity.eid)
/// names(shelves([t('b'), t('a'), t('c')], [held('a', 'c')])) -> [['a', ['c']], 'b']
/// names(shelves([t('a'), t('b')], [held('a', 'b'), held('b', 'a')])) -> [['a', [['b', ['a']]]]]
/// names(shelves([t('a')], [held('a', 'x')])) -> ['a']
export let shelves = (topics: Bundle[], edges: Bundle[]): Shelf[] => {
  let all = new Map(topics.map((t) => [eidOf(t), t]))
  let inside = new Map<string, Bundle[]>()
  for (let e of edges) {
    let [from, to] = [all.get(end(e, 'from')), all.get(end(e, 'to'))]
    if (from && to) {
      inside.set(eidOf(from), [...inside.get(eidOf(from)) ?? [], to])
    }
  }
  let kept = new Set([...inside.values()].flat().map(eidOf))
  let seen = new Set<string>()
  let shelf = (t: Bundle, path: string[]): Shelf => {
    let eid = eidOf(t)
    seen.add(eid)
    return {
      topic: t,
      under: path.includes(eid)
        ? []
        : [...new Set(inside.get(eid) ?? [])].sort(by)
          .map((u) => shelf(u, [...path, eid])),
    }
  }
  let top = [...all.values()].filter((t) => !kept.has(eidOf(t))).sort(by)
    .map((t) => shelf(t, []))
  // What only a cycle holds is shelved at the top, from its first by title.
  for (let t of [...all.values()].sort(by)) {
    if (!seen.has(eidOf(t))) top.push(shelf(t, []))
  }
  return top
}

/**
 * The shelves narrowed to what was said: each topic whose words fit it
 * (`fits`), under the topics that hold it. Nothing said narrows nothing.
 */
/// let s = shelves([t('data', 'how data is shaped'), t('ids', 'what names a thing'), t('git', 'commits')], [held('data', 'ids')])
/// names(within(s, 'names')) -> [['data', ['ids']]]
/// names(within(s, 'commit')) -> ['git']
/// names(within(s, '')) -> [['data', ['ids']], 'git']
export let within = (all: Shelf[], said: string): Shelf[] =>
  all.flatMap((s) => {
    let under = within(s.under, said)
    return under.length || fits(said, about(s.topic)) ? [{ ...s, under }] : []
  })

/** Every topic on the shelves, top to bottom, as they are drawn. */
/// every(s).map((b) => b.entity.eid) -> ['data', 'ids', 'git']
export let every = (all: Shelf[]): Bundle[] =>
  all.flatMap((s) => [s.topic, ...every(s.under)])

/** Whether a shelf holds a topic somewhere under it. */
/// holds(s[0], 'ids') -> true
/// holds(s[0], 'data') -> false
export let holds = (s: Shelf, eid: string): boolean =>
  s.under.some((u) => eidOf(u.topic) == eid || holds(u, eid))
