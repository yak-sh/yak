// The three words this package spells, and the ladder each one is a rung on.
//
// A ROLE is a seat on a space's roster: you are its owner, or you are one of
// its members. A LEVEL is what a grant hands one person on one app: owner,
// editor, viewer. A MODE is what an app says about everyone else — the people
// with no seat and no grant at all.
//
// Two levels are kept apart on purpose. `owner` and `member` say whether you
// belong to the club; `owner`, `editor` and `viewer` say what you may do with
// one of its things. Belonging is not access: a member with no grant reaches
// an app exactly as far as a stranger does, which is what makes a roster safe
// to be generous with.

/** A seat on a space's roster. An `owner` runs the space and is an implicit
 * owner of everything in it; a `member` belongs, and reaches only what they
 * are granted. */
export type Role = 'owner' | 'member'

/** What a grant hands one person on one app: `owner` shares and deletes it,
 * `editor` writes, `viewer` reads. */
export type Level = 'owner' | 'editor' | 'viewer'

/** What an app says about everyone with no grant on it:
 *
 * - `public` — anyone with the link reads it; only the granted write.
 * - `open` — anyone with the link reads it AND writes it, signed in or not.
 * - `private` — only the granted see it at all.
 */
export type Mode = 'public' | 'open' | 'private'

/** The roles, least to most. */
export let ROLES: Role[] = ['member', 'owner']

/** The levels a grant confers, least to most. */
export let LEVELS: Level[] = ['viewer', 'editor', 'owner']

/** The modes an app can be in. */
export let MODES: Mode[] = ['public', 'open', 'private']

/** A stored `member.role`, read: an unwritten one is a plain `member`. */
export let role = (v: unknown): Role => v == 'owner' ? 'owner' : 'member'

/** A stored `grant.access`, read: an unwritten one is a `viewer` — the least
 * a grant can mean, never the most. */
export let level = (v: unknown): Level =>
  v == 'owner' ? 'owner' : v == 'editor' ? 'editor' : 'viewer'

/** A stored `access.mode`, read: an app that never said is `public`, which is
 * what an app does before anyone thinks about it. */
export let mode = (v: unknown): Mode =>
  v == 'open' ? 'open' : v == 'private' ? 'private' : 'public'

/** May someone holding this level write? An `owner` and an `editor` write; a
 * `viewer`, and nobody at all, do not. */
export let writes = (l: Level | null): boolean => l == 'owner' || l == 'editor'

// THE TWO RULES, said once. Everything else in this package — the `policy`
// a door asks, the `precondition` a batch passes — reads the ladder out of
// storage and then asks one of these two questions. A host that already knows
// both answers (a platform that authenticated the caller at its edge and holds
// the mode in a directory) asks them here, with no storage at all, and cannot
// drift from the graph that enforces them.

/** May someone holding this level READ a thing in this mode? Anything not
 * `private` is readable by anyone with the link; a `private` thing is readable
 * by whoever holds any level on it. */
export let reads = (m: Mode, l: Level | null): boolean =>
  m != 'private' || l != null

/** May someone holding this level WRITE a thing in this mode? An `open` thing
 * is written by anyone, signed in or not; anything else wants owner or
 * editor. */
export let edits = (m: Mode, l: Level | null): boolean =>
  m == 'open' || writes(l)
