/**
 * @yaks/member — the access component domain for a yaks graph: who belongs to a
 * space, and who may reach a given app.
 *
 * This plugin contributes two components. A `membership` places a person in a
 * space — the roster that says which people exist to an app at all. A `grant`
 * gives a member a level of access to a particular entity, so a space can hold
 * apps its members reach differently. Together they are the model an app
 * consults to decide what a viewer may see and change.
 *
 * The package owns these components and the checks over them; it does not
 * authenticate anyone — establishing who a viewer IS happens upstream, and this
 * plugin decides what that identity may do. It plugs into
 * {@link https://jsr.io/@yaks/graph | @yaks/graph} like any other domain.
 *
 * @module
 */

import type { Eid, Plugin } from '@yaks/graph'

/** A level of access, from least to most. */
export type Level = 'none' | 'read' | 'write' | 'admin'

/** A `membership` component: a person's place in a space. */
export type Membership = {
  /** the space the person belongs to */
  space: Eid
  /** the person's address (how they sign in) */
  who: string
  /** their default level in the space */
  level: Level
}

/** A `grant` component: a member's access to one entity. */
export type Grant = {
  /** the entity the grant is on */
  on: Eid
  /** the member the grant is for */
  member: Eid
  /** the level the grant confers */
  level: Level
}

/** The plugin that contributes `membership` and `grant` to a graph. */
export type plugin = () => Plugin
