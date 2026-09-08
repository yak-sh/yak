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

/** Selection metadata shared by portable and host-owned renderer payloads. */
export type Registration = { view: string; match: Query | true }

/** A pure view of a bundle, independent of any host's node representation. */
export type Renderer = Registration & {
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

/** A dynamic contribution; selection reads a bundle, while the source stays typed. */
export type Contributor<A = Action, E = Bundle> = {
  match: Query | true
  acts: (source: E) => readonly (A & { when?: Query })[]
}

/** Registry configuration; actions preserve component and contribution order. */
export type Options<A = Action, E = Bundle> = {
  aliases?: Readonly<Record<string, string>>
  actions?:
    | Readonly<Record<string, readonly (A & { when?: Query })[]>>
    | readonly Contributor<A, E>[]
  /** Vocabulary for action conditions when actions() is called with two args. */
  vocab?: Vocab
  /** Views eligible for an unnamed request; defaults to every registered view. */
  views?: readonly string[]
}

/** One curated registry, with no global registrations or host state. */
export type Registry<
  R extends Registration = Renderer,
  A = Action,
  E = Bundle,
> = Options<A, E> & { renderers: readonly R[] }

/** The part of a registry selection needs, independent of its action types. */
export type Selection<R extends Registration = Renderer> = Pick<
  Registry<R>,
  'renderers' | 'aliases' | 'views'
>
