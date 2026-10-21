// What anybody may ask of the topics: the `@yaks/topic/tools` entry point, the
// implementations behind the `tool: true` declarations in ./vocab.json. Find
// before you make: `topic_find` answers the topics that exist, and `topic_new`
// makes one only under a name no topic holds. Its refusal is checked when the
// topic is written, so two builds that looked at once and found nothing still
// meet.

import type { Bundle, Graph } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import {
  about,
  FIND,
  fits,
  found,
  named,
  overlaps,
  TOPIC,
  topicEid,
} from './topic.ts'

let str = (v: unknown): string => v == null ? '' : String(v)

let brief = (t: Bundle): string => {
  let doc = (t.doc ?? {}) as { title?: string; body?: string }
  return `${t.entity.eid} (${str(doc.title)}: ${str(doc.body)})`
}

/** The implementations of `topic_new` and `topic_find`. A factory, like every
 * such module, although these need nothing from the server. */
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
    let [held] = await graph.get([topicEid(title)])
    if (held && !held.tombstone) {
      throw new Refused(
        `the topic ${named(title)} is ${brief(held)} already; use it`,
      )
    }
    // Every topic, by name: they are few and broad, and a word longer than
    // theirs ("markets" for "market design") no prefix search finds.
    let same = (await graph.read(found({}))).filter((t) =>
      overlaps(title, str((t[TOPIC] as { name?: unknown })?.name))
    )
    if (same.length) {
      throw new Refused(
        `${named(title)} names the subject of ${
          same.map(brief).join(', ')
        }; use it, or a name that holds none of its words`,
      )
    }
    // Its id, not an alias: the name decides it, and the caller is answered
    // what was written, so a model reading the answer learns the id to use.
    return [{
      entity: { eid: topicEid(title) },
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
})
