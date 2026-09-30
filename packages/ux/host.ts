/**
 * What a UX component asks of the page it is on, handed down once from the
 * root of the tree it draws (`Ux`), so one page may hold several: web's page
 * and the inspector's views on one of its cards each hand down their own. The
 * host says what the values mean (the vocabulary, what an entity is called),
 * where each component keeps its own state (the page's graph), where a bundle
 * it emits goes when its caller names nowhere else, and the platform's
 * primitives (where a popout floats). The rest is optional: a host without it
 * gets the plain behavior (no suggestions, a query typed as text, no inline
 * markdown, a popout in the flow).
 *
 * @module
 */

import {
  type ComponentChildren,
  createContext,
  type FunctionComponent,
  h,
  type JSX,
} from 'preact'
import { useContext } from 'preact/hooks'
import type { Bundle } from '@yaks/graph'
import type { Filters } from '@yaks/filter'
import type { EditOptions } from '@yaks/render'
import type { Vocab } from '@yaks/vocab'
import type { Find } from './hits.ts'

export type { Bundle }

/** A page's own graph, as much as a UX component needs of it: a @yaks/client
 * `client()` over this package's vocabulary (./vocab.ts) is one. */
export type Front = {
  mutate: (change: Bundle[]) => unknown
  watch: (query: string) => {
    value: Bundle[]
    subscribe: (fn: (rows: Bundle[]) => void) => () => void
  }
  ent: (eid: string) => Bundle | undefined
}

/** Where a popout floats: beside `anchor`, on `side` first. @yaks/ui `Float`
 * is a browser's. */
export type Float = FunctionComponent<{
  anchor: { current: HTMLElement | null }
  side?: 'above' | 'below'
  children?: ComponentChildren
}>

/** What a page supplies. */
export type Host = {
  /** the vocabulary of the values it changes: what a property is, and
   * whether a client may write it */
  vocab: Vocab
  /** the page's own graph, where each component keeps its own state */
  front: Front
  /** where a bundle a component emits goes when its caller names nowhere
   * else: a value to the graph it came from, an event (./vocab.json) to
   * whoever says it */
  write: (b: Bundle) => unknown
  /** what to call the entity an eid names */
  name: (eid: string) => string
  /** the id a person reads: `T-9` */
  id: (b: Bundle) => string
  /** the kind it displays as: `task` */
  kind: (b: Bundle) => string
  /** a moment, in words */
  when: (at: string) => string
  /** the entities a query line answers, asked of the server: a picker's
   * candidates, over the whole graph rather than what this page holds */
  find: Find<Bundle>
  /** how typed input is read (@yaks/render `edit`) */
  editing?: EditOptions
  /** the values seen so far in a well (a property declared `well`) */
  values?: (well: string) => string[]
  /** the query fields (@yaks/filter) a saved query is typed in; without
   * them a query is typed as text */
  fields?: Pick<Filters, 'Filter' | 'set'>
  /** inline markdown as HTML: a value shown `inline` at rest */
  markup?: (text: string) => string
  /** what a choice wears beside its word: a status's dot */
  wears?: (comp: string, prop: string, value: string) => ComponentChildren
  /** where a popout floats; without it, in the flow */
  Float?: Float
}

type Given = { host?: Host; at: string }

let Given = createContext<Given>({ at: '' })

/**
 * `<Ux host={host}>…</Ux>`: every UX component under it reads through
 * `host`. `at` names the consumer that owns what is under it (a card's own
 * eid, a view drawn on it), so the same value drawn in two places keeps two
 * states, and a remount finds its own again. An inner `Ux` names a consumer
 * within the one above it, and keeps its host unless given one.
 */
export let Ux = (
  { host, at, children }: {
    host?: Host
    at?: string
    children?: ComponentChildren
  },
): JSX.Element => {
  let up = useContext(Given)
  return h(Given.Provider, {
    value: {
      host: host ?? up.host,
      at: at == null ? up.at : up.at ? `${up.at}/${at}` : at,
    },
    children,
  })
}

/** The host handed down. */
export let useHost = (): Host => {
  let { host } = useContext(Given)
  if (!host) throw new Error('@yaks/ux: no host above (wrap the tree in Ux)')
  return host
}

/** The consumer that owns what is drawn here: every `Ux`'s `at` above it,
 * outermost first. */
export let useOwner = (): string => useContext(Given).at
