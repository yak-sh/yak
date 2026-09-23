/**
 * The portable renderer contract: a tree belongs to the injected hyperscript,
 * while selection and actions remain data. A renderer is generic over the node
 * type its backend builds, so the same registration can be given to a browser
 * backend or to a text one.
 */

import type { Bundle } from '@yaks/match'
import type { Query } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import type { ArchetypeLookup } from './archetype.ts'

/** A node the backend built, literal content, an empty child, or nested
 * children. */
export type Child<Node> =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Child<Node>[]

/** The shared set of element names; each backend decides what a tag becomes. */
export type H<Node> = (
  tag: string,
  props: Record<string, unknown> | null,
  ...children: Child<Node>[]
) => Node

/** Extra values the caller supplies; comp and prop together select a property
 * schema. */
export type Context = {
  comp?: string
  prop?: string
  [key: string]: unknown
}

/** The backend supplies nested rendering through the same registry and
 * bundle. */
export type RenderContext<Node> = Context & {
  render?: (view: string, ctx?: Context) => Node | null
}

/** The fields selection needs, shared by portable renderers and by ones a
 * backend defines itself. */
export type Registration = { view: string; match: Query | true }

/** A pure view of a bundle, independent of any backend's node type. */
export type Renderer = Registration & {
  render: <Node>(bundle: Bundle, h: H<Node>, ctx: RenderContext<Node>) => Node
}

/** Component changes for the caller to apply to the action's entity. */
export type Patch = Record<string, Record<string, unknown> | null>

/** An offered verb; listing it never invokes run or applies its patch. */
export type Action = {
  name: string
  when?: Query
  run: (bundle: Bundle, input?: unknown) => Patch
}

/** A dynamic contribution; selection reads a bundle, while the source stays typed. */
export type Contributor<A = Action, E = Bundle> = {
  match: Query | true
  acts: (source: E) => readonly (A & { when?: Query })[]
}

/** Registry configuration; actions preserve component and contribution order. */
export type Options<A = Action, E = Bundle> = {
  /** Immutable table sets held by the caller's descriptor subscription. */
  archetypes?: ArchetypeLookup
  actions?:
    | Readonly<Record<string, readonly (A & { when?: Query })[]>>
    | readonly Contributor<A, E>[]
  /** Vocabulary for action conditions when actions() is called with two args. */
  vocab?: Vocab
  /** Views eligible for an unnamed request; defaults to every registered view. */
  views?: readonly string[]
}

/** One curated registry, with no global registrations and no backend state. */
export type Registry<
  R extends Registration = Renderer,
  A = Action,
  E = Bundle,
> = Options<A, E> & { renderers: readonly R[] }

/** The part of a registry selection needs, independent of its action types. */
export type Selection<R extends Registration = Renderer> = Pick<
  Registry<R>,
  'renderers' | 'views' | 'archetypes'
>
