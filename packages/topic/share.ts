/**
 * A topic's share of the week: `attended{share}`, the part of each plan's
 * week that work for the topic may use. Topics nest, and a subtopic's share
 * is part of its parent's, so what a topic keeps is its share less the shares
 * below it, computed here and never stored. Work for a topic with no share is
 * charged to the nearest topic above it that has one. How much of a share is
 * used is @yaks/spend's to say (`shared`).
 *
 * @module
 */
import type { Eid, Graph } from '@yaks/graph'
import { HOLDS, TOPIC, TOPICS } from './topic.ts'

/** The component that gives a topic its share. */
export let SHARE = 'attended'

/** The shares topics have, and how the topics nest. */
export type Shares = {
  /** each topic's share, 0 to 1, where it has one */
  share: Map<Eid, number>
  /** the topics that contain each topic */
  up: Map<Eid, Eid[]>
}

/**
 * The nearest topic above `topic` that has a share: of its containers, then
 * of theirs, and of two as near the first by eid.
 *
 * ```ts
 * import { above } from './share.ts'
 * import { equal } from '@yaks/testing'
 *
 * let s = {
 *   share: new Map([['pilots', 0.4], ['grove', 0.1]]),
 *   up: new Map([['grove', ['pilots']], ['site', ['grove']], ['copy', ['site']]]),
 * }
 * equal([above(s, 'copy'), above(s, 'grove'), above(s, 'pilots')], ['grove', 'pilots', undefined])
 * ```
 */
export let above = (s: Shares, topic: Eid): Eid | undefined => {
  let seen = new Set([topic])
  for (let level = [topic]; level.length;) {
    level = [...new Set(level.flatMap((t) => s.up.get(t) ?? []))]
      .filter((t) => !seen.has(t)).sort()
    let found = level.find((t) => s.share.has(t))
    if (found) return found
    for (let t of level) seen.add(t)
  }
}

/**
 * The topic work for `topic` is charged to: itself where it has a share,
 * else the nearest topic above it that has one. With none above, nothing
 * was allotted for it.
 *
 * ```ts
 * import { holder } from './share.ts'
 * import { equal } from '@yaks/testing'
 *
 * let s = { share: new Map([['pilots', 0.4]]), up: new Map([['grove', ['pilots']]]) }
 * equal([holder(s, 'pilots'), holder(s, 'grove'), holder(s, 'funnel')], ['pilots', 'pilots', undefined])
 * ```
 */
export let holder = (s: Shares, topic: Eid): Eid | undefined =>
  s.share.has(topic) ? topic : above(s, topic)

/**
 * What each topic with a share keeps: its share less the shares of the
 * nearest topics below it that have one.
 *
 * ```ts
 * import { kept } from './share.ts'
 * import { equal } from '@yaks/testing'
 *
 * let s = {
 *   share: new Map([['pilots', 0.5], ['grove', 0.25], ['funnel', 0.125]]),
 *   up: new Map([['grove', ['pilots']]]),
 * }
 * equal([...kept(s)], [['pilots', 0.25], ['grove', 0.25], ['funnel', 0.125]])
 * ```
 */
export let kept = (s: Shares): Map<Eid, number> => {
  let out = new Map(s.share)
  for (let [topic, share] of s.share) {
    let up = above(s, topic)
    if (up) out.set(up, out.get(up)! - share)
  }
  return out
}

/** The shares a graph's topics have, and the topics that contain each
 * topic. A graph with no share reads no nesting. */
export let shares = async (g: Graph): Promise<Shares> => {
  let out: Shares = { share: new Map(), up: new Map() }
  if (!g.vocab.comp(SHARE)) return out
  for (let b of await g.read(`.${TOPIC}&.${SHARE}&.limit=${TOPICS}`)) {
    let share = Number((b[SHARE] as { share?: unknown }).share)
    if (share >= 0) out.share.set(b.entity.eid, share)
  }
  if (!out.share.size) return out
  let topics = new Set(
    (await g.read(`.${TOPIC}&.limit=${TOPICS}`)).map((b) => b.entity.eid),
  )
  let edges = await g.read(
    `.${HOLDS}&.edge.to=${[...topics].join(',')}&?edge&.limit=${TOPICS}`,
  )
  for (let b of edges) {
    let { from, to } = b.edge as { from: Eid; to: Eid }
    if (!topics.has(from)) continue
    out.up.set(to, [...out.up.get(to) ?? [], from])
  }
  return out
}
