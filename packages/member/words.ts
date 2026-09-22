// The three enumerated values this package defines, the helpers that read one
// out of storage, and the two access rules stated once.
//
// A role is what a `member` row records: you are a space's owner, or one of its
// members. A level is what a `grant` gives one principal on one app: owner,
// editor, viewer. A mode is what an app allows everyone else — the people with
// no membership and no grant at all.
//
// Roles and levels are kept apart on purpose. `owner` and `member` record
// whether you belong to the space; `owner`, `editor` and `viewer` record what
// you may do with one app in it. Membership is not permission: a member with no
// grant reaches an app exactly as far as a stranger does, which is what makes a
// roster safe to be generous with.

/** What a `member` row records. An `owner` runs the space and holds `owner`
 * permission on every app in it; a `member` belongs, and holds only what a
 * grant gives them. */
export type Role = 'owner' | 'member'

/** What a `grant` gives one principal on one app: `owner` shares and deletes
 * it, `editor` writes it, `viewer` reads it. */
export type Level = 'owner' | 'editor' | 'viewer'

/** What an app allows everyone with no grant on it:
 *
 * - `public` — anyone with the link reads it; only the granted write.
 * - `open` — anyone with the link reads it and writes it, signed in or not.
 * - `private` — only principals holding a permission see it at all.
 */
export type Mode = 'public' | 'open' | 'private'

/** The roles, least to most. */
export let ROLES: Role[] = ['member', 'owner']

/** The levels a grant confers, least to most. */
export let LEVELS: Level[] = ['viewer', 'editor', 'owner']

/** The modes an app can be in. */
export let MODES: Mode[] = ['public', 'open', 'private']

/** Read a stored `member.role`: an unset one is a plain `member`. */
export let role = (v: unknown): Role => v == 'owner' ? 'owner' : 'member'

/** Read a stored `grant.access`: an unset one is a `viewer` — the least a grant
 * can mean, never the most. */
export let level = (v: unknown): Level =>
  v == 'owner' ? 'owner' : v == 'editor' ? 'editor' : 'viewer'

/** Read a stored `access.mode`: an app with no `access` component is `public`,
 * which is what an app is before anyone thinks about it. */
export let mode = (v: unknown): Mode =>
  v == 'open' ? 'open' : v == 'private' ? 'private' : 'public'

/** May a principal holding this level write? An `owner` and an `editor` write;
 * a `viewer`, and a principal holding nothing, do not. */
export let writes = (l: Level | null): boolean => l == 'owner' || l == 'editor'

// The two rules, stated once. Everything else in this package — the `policy`
// helpers the HTTP layer calls, the `precondition` hook a transaction passes —
// reads a mode and a level out of storage and then calls one of these two
// functions. A service that already knows both (one that authenticated the
// caller at its edge and keeps modes in a directory) calls them directly, with
// no storage at all, and so cannot drift from the graph that enforces them.

/** May a principal holding this level read an app in this mode? Anything not
 * `private` is readable by anyone with the link; a `private` app is readable by
 * whoever holds any level on it. */
export let reads = (m: Mode, l: Level | null): boolean =>
  m != 'private' || l != null

/** May a principal holding this level write an app in this mode? An `open` app
 * is written by anyone, signed in or not; anything else requires owner or
 * editor. */
export let edits = (m: Mode, l: Level | null): boolean =>
  m == 'open' || writes(l)
