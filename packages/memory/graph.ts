// What a write is answered with from memory: the `reply` the graph facet
// gives the host, beside the neighbours @yaks/embedding answers with.
//
// An agent that writes a task, a comment or a memory is told what the graph's
// person said and decided before that bears on it: their few nearest earlier
// words, and the nearest decisions already answered (./earlier.ts `bearing`).
// A prompt recalls by the person's message; this recalls by what the agent is
// doing about it, which is where a correction it never saw would have helped.
// Each is a `hit` naming, under `said`, the entity it bears on and, under
// `by`, who said it. What the calling session wrote or was told since its
// latest compaction is left out: it holds that already. The person's own
// writes are answered with nothing.
//
// Nothing here fails or holds a write: it committed before a reply is asked
// for, and a recall slower than WAIT answers nothing.

import { type Bundle, type Comp, type Eid, who } from '@yaks/graph'
import { called } from '@yaks/graph/hit'
import type { Host } from '@yaks/host'
import { and, eq, present } from '@yaks/query'
import { became, type Reply } from '@yaks/tools'
import { bearing, clip, type Held, titleOf } from './earlier.ts'

/** How long a write's answer waits for what was said before, in
 * milliseconds: as long as it waits for its neighbours (@yaks/embedding
 * `WAIT`), which are asked at the same time. */
export let WAIT = 1000

/** How many of one call's new entities are looked at. */
export let MOST = 3

/** How much of a written entity's text the recall is keyed on. */
export let TEXT = 4000

let part = (b: Bundle | undefined, c: string): Comp => (b?.[c] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''

/** The text of something written, as a recall is keyed on it: its title and
 * its words. */
export let textOf = (b: Bundle): string =>
  [part(b, 'doc').title, part(b, 'doc').body, part(b, 'content').body]
    .map(str).filter((s) => s.trim()).join('\n').slice(0, TEXT)

// What the session behind a call already holds: everything since its latest
// compaction, or since it began.
let held = async (host: Host, via?: Eid): Promise<Held | undefined> => {
  if (!via) return
  let cuts = host.vocab.comp('checkpoint') && host.vocab.comp('entry')
    ? await host.graph.read(
      and(eq('entry.session', via), present('checkpoint')),
    )
    : []
  let since = cuts.map((b) => str(part(b, 'created').at)).sort().at(-1)
  return { via, since }
}

/** The reply: for each entity the call's write made, the person's nearest
 * earlier words and answered decisions, as `hit` bundles. */
export let reply = (host: Host): Reply => async (call, _answer, wrote) => {
  let configured = host.config.person
  if (!configured || !host.meaning) return []
  let born = wrote.filter((b) =>
    (became(host.vocab, b) ?? 'entity') != 'entity'
  )
    .map((b) => b.entity.eid)
  if (!born.length) return []
  let person = (await host.graph.address([configured])).get(configured) ??
    configured
  let actor = who(call)
  if (actor?.by == person) return []
  let [p] = await host.graph.get([person], ['doc'])
  let name = str(part(p, 'doc').title)
  let made = (await host.graph.get(born.slice(0, MOST), ['doc', 'content']))
    .filter((b) => textOf(b).trim())
  if (!made.length) return []
  let holds = await held(host, actor?.via)
  let before = new Date().toISOString()
  let id = called(host.vocab)
  let shown = new Set<Eid>()
  let out: Bundle[] = []
  let found = await Promise.all(made.map((b) =>
    bearing(host.graph, {
      person,
      name,
      words: textOf(b),
      before,
      meaning: host.meaning,
      held: holds,
      wait: WAIT,
    })
  ))
  // Each row whole, for the kind its components make it and its status, and
  // the ids the comments among them are on: a comment's words alone do not
  // say which task they are about.
  let rows = found.flatMap((f) => [...f.said.map((q) => q.from), ...f.decided])
  let targets = rows.map((b) => str(part(b, 'comment').target)).filter(Boolean)
  let whole = new Map(
    (await host.graph.get([
      ...new Set([...rows.map((b) => b.entity.eid), ...targets]),
    ])).map((b) => [b.entity.eid, b]),
  )
  let status = (b: Bundle) =>
    Object.values(b).map((c) => str((c as Comp | null)?.status)).find(Boolean)
  made.forEach((b, i) => {
    let hit = (found: Bundle, rest: Comp) => {
      let from = whole.get(found.entity.eid) ?? found
      if (shown.has(from.entity.eid)) return
      shown.add(from.entity.eid)
      let state = status(from)
      out.push({
        entity: from.entity,
        hit: {
          id: id(from),
          kind: host.vocab.kindOf(from),
          source: 'meaning',
          said: b.entity.eid,
          ...name ? { by: name } : {},
          ...state ? { status: state } : {},
          ...rest,
        },
      })
    }
    for (let q of found[i].said) {
      let target = whole.get(str(part(q.from, 'comment').target))
      hit(q.from, {
        ...target ? { target: id(target) } : {},
        snippet: `${q.at.slice(0, 10)} ${JSON.stringify(clip(q.words))}`,
      })
    }
    for (let d of found[i].decided) hit(d, { title: titleOf(d), snippet: '' })
  })
  return out
}
