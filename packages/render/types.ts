/**
 * The portable renderer contract: a tree belongs to the injected hyperscript,
 * while selection and verbs remain data. A renderer is generic over the host's
 * node so the same registration can be handed to a browser or a text host.
 */

import type { Bundle } from '@yaks/match'
import type { Query } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'

/** A host node, literal content, an empty child, or nested children. */
export type Child<Node> =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Child<Node>[]

/** The common element vocabulary; a host owns what each tag becomes. */
export type H<Node> = (
  tag: string,
  props: Record<string, unknown> | null,
  ...children: Child<Node>[]
) => Node

/** Extra values a host supplies; comp and col together select a column schema. */
export type Context = {
  comp?: string
  col?: string
  [key: string]: unknown
}

/** A pure view of a bundle, independent of any host's node representation. */
export type Renderer = {
  view: string
  match: Query | true
  render: <Node>(bundle: Bundle, h: H<Node>, ctx: Context) => Node
}

/** Component changes for the caller to apply to the action's entity. */
export type Patch = Record<string, Record<string, unknown> | null>

/** An offered verb; listing it never invokes run or applies its patch. */
export type Action = {
  name: string
  when?: Query
  run: (bundle: Bundle) => Patch
}

/** Registry configuration; actions preserve component and contribution order. */
export type Options = {
  aliases?: Readonly<Record<string, string>>
  actions?: Readonly<Record<string, readonly Action[]>>
  /** Vocabulary for action conditions when actions() is called with two args. */
  vocab?: Vocab
  /** Views eligible for an unnamed request; defaults to every registered view. */
  views?: readonly string[]
}

/** One curated registry, with no global registrations or host state. */
export type Registry = Options & { renderers: readonly Renderer[] }
