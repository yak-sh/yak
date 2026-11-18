// Portable answer preparation and text output. The CLI supplies its terminal
// presentation from ./tty.ts.
import type { Bundle } from '@yaks/graph'
import { whole } from '@yaks/query'
import { prepared, type Registry, type Renderer } from '@yaks/render'
import type { Vocab } from '@yaks/vocab/runtime'
import {
  type Drawn,
  type Held,
  type Near,
  nearOf,
  nearQuery,
  NONE,
  nothing,
  parted,
  printed,
  referenced,
  type Source,
  standing,
  type Tty,
  viewOf,
} from './answer.ts'

/** A prepared answer, handed to the caller's presentation boundary. */
export type Presentation = (
  views: Registry,
  answer: Bundle[],
  named: Bundle[],
  page: Near | undefined,
  answers: ReadonlyMap<string, Bundle[]>,
) => void | Promise<void>

let none: Source = { lookup: () => [], query: () => [] }

/** Prepare an answer's views and the references and queries they read, then
 * present it through `present`, or print its portable text. A tool that wrote
 * draws its answer as it now stands, and a page draws a lone entity whole,
 * beside the links and comments its page asks for. */
export let show = async (
  c: { tui: boolean; tty?: Tty; out: (line: string) => void },
  views: Registry,
  vocab: Vocab,
  said: Bundle[],
  held: { views?: Held; config?: string } = {},
  from: Source = none,
  tool: Drawn = { readOnly: true },
  present?: Presentation,
): Promise<void> => {
  let answer = tool.readOnly ? said : await standing(said, from)
  // A read that found nothing says so: a blank answer reads as a command
  // that did nothing, or one still working.
  if (tool.readOnly && !answer.length && !c.tui) {
    return c.tty ? c.tty.write(NONE) : c.out(NONE)
  }
  let them = parted(answer).them
  let lone = viewOf(them, !!tool.page) == 'Page' ? them[0] : undefined
  let asked = lone ? nearQuery(vocab, lone.entity.eid) : null
  let page = !lone
    ? undefined
    : asked
    ? nearOf(lone.entity.eid, await from.query(asked))
    : nothing
  let near = page ?? nothing
  // Portable renderers are pure. Discover the references and queries the
  // drawing reads, including nested views and declared needs, rather than
  // fetching every reference carried by a bundle that a tile never shows. A
  // terminal paints with what the printout read, and the references its
  // components may read beside it.
  let known = new Set(
    [...answer, ...near.links, ...near.comments].map((b) => b.entity.eid),
  )
  let painting = c.tui || c.tty
  let refs = painting
    ? referenced(
      vocab,
      [...answer, ...near.links, ...near.comments],
      held.views ?? views,
      lone?.entity.eid,
    )
    : []
  let named: Bundle[] = refs.length ? await from.lookup(refs) : []
  named.forEach((b) => known.add(b.entity.eid))
  let answers = new Map<string, Bundle[]>()
  let text = ''
  while (true) {
    let pending = new Set<string>()
    let asking = new Set<string>()
    let loading = new Set<Renderer>()
    try {
      text = printed(views, vocab, answer, named, page, {
        answers,
        eid: (eid) => eid && !known.has(eid) && pending.add(eid),
        query: (q) => asking.add(q),
        deferred: (r) => loading.add(r),
      })
    } catch (error) {
      // A drawing may require a declared or newly-read dependency before
      // it can finish. Retry after those reads; failures without new reads
      // remain drawing errors, including required references that are gone.
      if (!pending.size && !loading.size && !asking.size) throw error
    }
    if (!pending.size && !loading.size && !asking.size) break
    let ids = [...pending]
    ids.forEach((id) => known.add(id))
    let [ready, found, said] = await Promise.all([
      loading.size ? prepared(views, [...loading]) : views,
      ids.length ? from.lookup(ids) : [],
      Promise.all(
        [...asking].map(async (q) =>
          // A renderer's declared query, as its author wrote it.
          [
            q,
            await Promise.resolve(from.query(whole(q))).catch(() => []),
          ] as const
        ),
      ),
    ])
    views = ready
    named.push(...found)
    found.forEach((b) => known.add(b.entity.eid))
    said.forEach(([q, rows]) => answers.set(q, rows))
  }
  if (present) return await present(views, answer, named, page, answers)
  if (text) {
    if (c.tty) c.tty.write(text)
    else c.out(text)
  }
}
