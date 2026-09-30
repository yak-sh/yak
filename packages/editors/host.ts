/**
 * What the editors ask of the page they are on. A browser, a terminal or a
 * test supplies it once (`bind`), and every editor reads through it: the
 * vocabulary, the entities it holds, the door a change goes out through and
 * where a refusal is said, what a reference is called, and the server search
 * a picker offers candidates from. The rest is optional: a page without it
 * gets the plain behavior (no suggestions, a query typed as text, no inline
 * markdown).
 *
 * @module
 */

import type { ComponentChildren } from 'preact'
import type { Bundle } from '@yaks/graph'
import type { Filters } from '@yaks/filter'
import type { Context, EditOptions, Registration } from '@yaks/render'
import type { Events } from '@yaks/preact'
import type { Vocab } from '@yaks/vocab'
import type { Editor } from './types.ts'

export type { Bundle }

/** What a page supplies, once. */
export type Host = {
  /** the graph's vocabulary: what a property is, whether it may be written */
  vocab: Vocab
  /** an entity, read reactively: a render that reads one redraws when it
   * changes */
  get: (eid: string) => Bundle | undefined
  /** write a change; one the graph refuses throws, or rejects, saying why */
  apply: (change: Bundle[]) => unknown
  /** say why a change to this entity was refused */
  problem: (message: string, eid: string) => void
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
  find: (line: string, limit: number, signal?: AbortSignal) => Promise<Bundle[]>
  /** how typed input is read (@yaks/render `edit`) */
  editing?: EditOptions
  /** draw an entity's view through the page's own registry, which holds
   * this package's views (./editors.ts `editorViews`); without it, they are
   * drawn from a registry of their own */
  renderView?: (
    eid: string,
    view: string,
    ctx: Context & Events,
  ) => ComponentChildren
  /** the registration a property selects in the page's own registry */
  columnView?: (
    eid: string,
    comp: string,
    prop: string,
    view: string,
  ) => (Registration & Pick<Editor, 'show'>) | undefined
  /** the values seen so far in a well (a property declared `well`) */
  values?: (well: string) => string[]
  /** the query fields (@yaks/filter) a saved query is typed in; without
   * them a query is typed as text */
  fields?: Pick<Filters, 'Filter' | 'set'>
  /** inline markdown as HTML: a value shown `inline` at rest */
  markup?: (text: string) => string
  /** ask for a property the page holds back until it is asked (a body):
   * until it lands, it is not offered for typing over */
  want?: (eid: string, comp: string, prop: string) => void
  /** typing began (`insert`) or ended (`normal`) */
  mode?: (mode: 'insert' | 'normal') => void
  /** what a choice wears beside its word: a status's dot */
  wears?: (comp: string, prop: string, value: string) => ComponentChildren
}

let bound: Host | undefined

/** The editors on this page read through `host`; the one bound before is
 * returned, so a test can put it back. */
export let bind = (host: Host | undefined): Host | undefined => {
  let was = bound
  bound = host
  return was
}

/** The page's host. */
export let host = (): Host => {
  if (!bound) throw new Error('@yaks/editors: no host is bound')
  return bound
}
