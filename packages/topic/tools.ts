// What anybody may ask of the topics: the `@yaks/topic/tools` entry point, the
// implementations behind the `tool: true` declarations in ./vocab.json. Find
// before you make: `topic_find` answers the topics that exist, and `topic_new`
// makes one only under a name no topic holds; the name's unique index refuses
// the second of two builds that looked at once and found nothing. `topic_add`
// puts things under a topic, a `contains` edge each, so whoever reads the
// topic finds them.

import type { Bundle, Graph } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import { link, unlink } from '@yaks/edge'
import {
  about,
  FIND,
  fits,
  found,
  HOLDS,
  named,
  overlaps,
  TOPIC,
} from './topic.ts'

let str = (v: unknown): string => v == null ? '' : String(v)

// A topic as a refusal names it: its id, title and the first line of its
// cover, since a project's cover runs on for pages.
let brief = (t: Bundle): string => {
  let doc = (t.doc ?? {}) as { title?: string; body?: string }
  return `${t.entity.eid} (${str(doc.title)}: ${str(doc.body).split('\n')[0]})`
}

let nameOf = (t: Bundle): string =>
  str((t[TOPIC] as { name?: unknown } | undefined)?.name)

/** The implementations of `topic_new`, `topic_find` and `topic_add`. A
 * factory, like every such module, although these need nothing from the
 * server. */
export let runs = (): Runs => ({
  topic_new: async (call, graph: Graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let title = str(args.name).trim().replace(/\s+/g, ' ')
    let body = str(args.body).trim()
    let scope = str(args.scope)
    if (!title) throw new Refused('a topic needs a name')
    if (!body) {
      throw new Refused('a topic needs a brief saying what belongs under it')
    }
    // Every topic, by name: they are few and broad, and a word longer than
    // theirs ("markets" for "market design") no prefix search finds.
    let topics = await graph.read(found({}))
    let held = topics.find((t) => nameOf(t) == named(title))
    if (held) {
      throw new Refused(
        `the topic ${named(title)} is ${brief(held)} already; use it`,
      )
    }
    let same = topics.filter((t) => nameOf(t) && overlaps(title, nameOf(t)))
    if (same.length) {
      throw new Refused(
        `${named(title)} names the subject of ${
          same.map(brief).join(', ')
        }; use it, or a name that holds none of its words`,
      )
    }
    // The graph mints its id, and the answer names it, so a model reading the
    // answer learns the id to use.
    return [{
      entity: { eid: '$topic' },
      [TOPIC]: { name: named(title), ...(scope ? { scope } : {}) },
      doc: { title, body },
    }]
  },

  // Every topic, its words matched here (`fits`), the ones that fit answered
  // whole, in the order they were read.
  topic_find: async (call, graph: Graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let hits = (await graph.read(found({ near: str(args.near) })))
      .filter((t) => fits(str(args.said), about(t)))
      .slice(0, Number(args.limit ?? FIND))
      .map((t) => t.entity.eid)
    let whole = new Map(
      (hits.length ? await graph.get(hits) : []).map((b) => [b.entity.eid, b]),
    )
    return hits.flatMap((eid) => whole.get(eid) ?? [])
  },

  // A `contains` edge from the topic to each entity, or each taken away. The
  // topic is read first, so a word that names something else is refused
  // rather than holding things nobody browses.
  topic_add: async (call, graph: Graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let topic = str(args.topic)
    let ids = [args.ids].flat().map(str).filter(Boolean)
    let [held] = await graph.get([topic])
    if (!held || held.tombstone || !held[TOPIC]) {
      throw new Refused(
        `${topic} is not a topic: find one with topic_find, or make one ` +
          'with topic_new',
      )
    }
    if (ids.includes(topic)) throw new Refused('a topic never holds itself')
    let edge = args.drop ? unlink : link
    return ids.map((id) => edge(topic, HOLDS, id))
  },
})
