// Reading around a memory, the way `grep -C` reads around a line. A memory is a
// mark on where somebody said something, and the words alone are rarely enough
// to understand it: what came just before them in the conversation, what the
// comment was on, who replied, which session it was and what that session was
// working on. These four tools answer those, one each, so a model building
// beliefs from memories walks out from one only as far as it needs.
//
// They are ordinary reads over the graph. What they know of other packages'
// components (a transcript entry's `entry{session, seq}`, a comment's
// `comment{target}`, a `worked` edge, a `claim`) they learn from the rows a
// query answers and the names a query speaks, never by importing the package
// that declares them; where a graph does not declare one, the tool answers
// without it or says it cannot.

import {
  argsOf,
  type Bundle,
  type Comp,
  type Graph,
  Refused,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'

/** How many entries either side of one `memory_around` reads when not told. */
export let CONTEXT = 3

let str = (v: unknown): string => v == null ? '' : String(v)

let comp = (b: Bundle | undefined, name: string): Comp | undefined =>
  (b?.[name] ?? undefined) as Comp | undefined

let count = (v: unknown): number => {
  let n = Number(v ?? CONTEXT)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : CONTEXT
}

// Entities as they stand, whole, in the order asked and each once; one deleted
// or never there is left out.
let wholes = async (graph: Graph, eids: string[]): Promise<Bundle[]> => {
  let want = [...new Set(eids.filter(Boolean))]
  if (!want.length) return []
  let found = new Map(
    (await graph.get(want)).filter((b) => !b.tombstone)
      .map((b) => [b.entity.eid, b]),
  )
  return want.flatMap((eid) => found.has(eid) ? [found.get(eid)!] : [])
}

// The one entity a call names, whole, or a refusal saying there is none.
let named = async (graph: Graph, call: Bundle): Promise<Bundle> => {
  let id = str(argsOf(call).id)
  let [b] = await wholes(graph, [id])
  if (!b) throw new Refused(`nothing is ${id}`)
  return b
}

// Oldest first: by when each was made, then by number, then by eid, so two
// written in the same millisecond still come back in one order.
let oldest = (a: Bundle, b: Bundle): number =>
  str(comp(a, 'created')?.at).localeCompare(str(comp(b, 'created')?.at)) ||
  Number(a.entity.num ?? 0) - Number(b.entity.num ?? 0) ||
  a.entity.eid.localeCompare(b.entity.eid)

/** The reads, as the tools ./vocab.json declares them. */
export let around: Runs = {
  // The entries either side of one in its transcript, counted by position,
  // whatever their kind: `.entry.seq` orders a transcript and may skip numbers.
  memory_around: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let e = await named(graph, call)
    let at = comp(e, 'entry')
    if (!at?.session) {
      throw new Refused(`${str(args.id)} is no transcript entry`)
    }
    let side = async (op: '<' | '>', n: number) =>
      n
        ? await graph.read(
          `.entry.session=${at.session}&.entry.seq${op}${Number(at.seq)}&*` +
            `&.order=${op == '<' ? '-' : ''}entry.seq&.limit=${n}`,
        )
        : []
    let ahead = await side('<', count(args.before))
    let behind = await side('>', count(args.after))
    return [...ahead.reverse(), e, ...behind]
  },

  // Every target the entity's components name, whichever component names it:
  // a comment's, and any other package's aimed thing (a letter, a knock).
  memory_target: async (call, graph): Promise<Bundle[]> => {
    let e = await named(graph, call)
    let aims = Object.keys(e).flatMap((c) =>
      graph.vocab.prop(c, 'target')?.category == 'ref'
        ? [str(comp(e, c)?.target)]
        : []
    )
    let found = await wholes(graph, aims)
    if (!found.length) {
      throw new Refused(`${str(argsOf(call).id)} is aimed at nothing`)
    }
    return found
  },

  // Up past every comment the entity replies to, to what they are all about;
  // then down through every comment below that, a level at a time.
  memory_thread: async (call, graph): Promise<Bundle[]> => {
    let root = await named(graph, call)
    let seen = new Set([root.entity.eid])
    for (;;) {
      let t = str(comp(root, 'comment')?.target)
      let [up] = seen.has(t) ? [] : await wholes(graph, [t])
      if (!up) break
      seen.add(t)
      root = up
    }
    let below: Bundle[] = []
    let known = new Set([root.entity.eid])
    for (let level = [root.entity.eid]; level.length;) {
      let found = (await graph.read(`.comment.target=${level.join(',')}&*`))
        .filter((b) => !known.has(b.entity.eid))
      for (let b of found) known.add(b.entity.eid)
      below.push(...found)
      level = found.map((b) => b.entity.eid)
    }
    return [root, ...below.sort(oldest)]
  },

  // The session: a transcript entry's own, or the one anything else was
  // written through. Then what it worked on (`worked` edges from it) and what
  // it holds a claim on now, where the graph declares either.
  memory_session: async (call, graph): Promise<Bundle[]> => {
    let e = await named(graph, call)
    let s = str(comp(e, 'entry')?.session) || str(comp(e, 'created')?.via)
    let [session] = await wholes(graph, [s])
    // Written through something else (a process, a client): no session.
    if (!comp(session, 'session')) {
      throw new Refused(
        `${str(argsOf(call).id)} was written through no session`,
      )
    }
    let has = (c: string) => !!graph.vocab.comp(c)
    let worked = has('edge') && has('worked')
      ? (await graph.read(`.edge.from=${s}&.worked&?edge`))
        .map((b) => str(comp(b, 'edge')?.to))
      : []
    let claimed = has('claim')
      ? (await graph.read(`.claim.session=${s}`)).map((b) => b.entity.eid)
      : []
    return [session, ...await wholes(graph, [...worked, ...claimed])]
  },
}
