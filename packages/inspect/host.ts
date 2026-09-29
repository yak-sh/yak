/**
 * What an inspector view is, and what it asks of the host that draws it.
 *
 * A view is a domain component in the sense of https://yak.sh/composable-ui.md:
 * it knows no store. It says which bundles it draws (`match`, a @yaks/render
 * registration), the queries it needs as data (`asks`, a query line by the
 * name it reads the answer under), and draws what it is handed: the bundle,
 * each answer (`got`), and `io`, its doors to the world outside it. An edit
 * goes out through `io.apply` as bundles; the inspector's own state (a folded
 * section, a lens, the trail) is read and written in the page's own graph
 * through `io.state` and `io.set`.
 *
 * The host is what a browser or a terminal supplies once ({@link Host}): the
 * vocabulary, a hook answering a view's asks while it is mounted, where links
 * go, how an entity is named, and the doors that write. `inspector()`
 * (./door.ts) turns a host into the `Door` every view is drawn through.
 *
 * @module
 */

import type { ComponentChildren, FunctionComponent } from 'preact'
import type { Bundle, Context, EditOptions, Registration } from '@yaks/render'
import type { Vocab } from '@yaks/vocab'

export type { Bundle }

/** One query's answer, as the host holds it. */
export type Answer = {
  /** the rows it matched; none for an aggregate */
  rows: Bundle[]
  /** a `.count`'s number */
  count?: number
  /** a `.tally`'s count of each value */
  tally?: Record<string, number>
  /** answered: false while the host is still asking, and after a refusal */
  ready: boolean
  /** why the host refused it */
  error?: string
}

/** One query a view asks: a line, answered and kept live while the view is
 * mounted, or `{query, once: true}`, answered once when it mounts, for an
 * answer that reads too much to be asked again after every commit. */
export type Ask = string | { query: string; once: true }

/** The queries a view asks, each by the name its answer is read under. */
export type Asks = Record<string, Ask>

/** A page's own graph, as much as the inspector needs of it: a @yaks/client
 * `client()` is one. */
export type Front = {
  mutate: (change: Bundle[]) => unknown
  watch: (query: string) => {
    value: Bundle[]
    subscribe: (fn: (rows: Bundle[]) => void) => () => void
  }
  ent: (eid: string) => Bundle | undefined
}

/** What a browser or a terminal supplies, once. */
export type Host = {
  /** the graph's vocabulary: what a component is, what may be written */
  vocab: Vocab
  /** the answer to each ask, held while the view asking is mounted: a hook,
   * called once per render with the whole set */
  useAnswers: (asks: Asks) => Record<string, Answer>
  /** write a change to the graph; a write it refuses rejects, saying why */
  apply: (change: Bundle[]) => void | Promise<void>
  /** the page's own graph, where the inspector keeps its state */
  front: Front
  /** an entity the host holds, by eid, read reactively: one an answer
   * brought (the transactions a history asks for beside its changes) */
  get: (eid: string) => Bundle | undefined
  /** where the inspector's page for an entity is */
  link: (eid: string) => string
  /** where the map is, with this query in its bar */
  find: (query: string) => string
  /** the id a person reads: `T-9` */
  id: (b: Bundle) => string
  /** the kind it displays as: `task` */
  kind: (b: Bundle) => string
  /** what to call the entity an eid names, from whatever the host holds */
  name: (eid: string) => string
  /** a moment, in words */
  when: (at: string) => string
  /** whether its controls take input: a browser's do; a terminal paints
   * them, and a value there is read, not typed over */
  edits: boolean
  /** how an edit's typed input is read (@yaks/render `edit`) */
  editing?: EditOptions
  /** the query field (@yaks/filter) bound to the page's own graph: the
   * field's entity is `id`, and `run` is called with its line when it is
   * sent */
  Bar: FunctionComponent<{ id: string; run: (line: string) => void }>
}

/** A view's doors to the world outside it. */
export type Io = Omit<Host, 'useAnswers' | 'front'> & {
  /** another bundle, drawn through the same registry as `view` */
  show: (b: Bundle, view: string, ctx?: Context) => ComponentChildren
  /** whether the registry draws this bundle as `view` */
  can: (b: Bundle, view: string) => boolean
  /** one of the inspector's own entities, read reactively */
  state: (eid: string) => Bundle | undefined
  /** write the inspector's own state */
  set: (change: Bundle[]) => void
}

/** What a view is drawn with. */
export type Props = {
  /** the bundle it draws */
  e: Bundle
  /** each of its asks, answered */
  got: Record<string, Answer>
  io: Io
  /** what the caller drew it with */
  ctx: Context
}

/** An inspector view: a registration, what it asks, and its component. */
export type View = Registration & {
  asks?: (e: Bundle, io: Io, ctx: Context) => Asks
  Render: FunctionComponent<Props>
}
