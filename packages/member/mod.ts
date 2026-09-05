/**
 * @yaks/member — who belongs, and what they may touch: the membership
 * component domain for a {@link https://jsr.io/@yaks/graph | @yaks/graph}.
 *
 * Say a book club keeps its reading list, its potluck sign-up sheet and its
 * private notes in one place. Three questions come up at once, and this
 * package is the three answers:
 *
 * - **Who belongs?** A `member{space, person, role}` row is a seat on the
 *   club's roster. `owner` runs the club; `member` belongs to it.
 * - **What may they touch?** A `grant{app, person, access}` hands one person
 *   one level — `owner`, `editor` or `viewer` — on one thing.
 * - **And everyone else?** An `access{mode}` on that thing says: `public`
 *   (anyone with the link reads it), `open` (anyone with the link reads AND
 *   writes it, signed in or not), or `private` (only the granted see it at
 *   all).
 *
 * ## Belonging is not access
 * A seat on the roster gives nothing on its own. A member with no grant
 * reaches the potluck sheet exactly as far as a stranger with the link does —
 * which is what makes a roster safe to be generous with. The one shortcut is
 * the club's **owner**, who is an implicit owner of everything in it, never
 * stored per thing. Eviction is then one row: take the seat away and every
 * implicit ownership goes with it.
 *
 * ## Two rules, said once
 * ```text
 * read    the mode is not `private`, OR the asker holds any level
 * write   the mode is `open`,        OR the asker holds owner or editor
 * ```
 * A `viewer` never writes, under any mode. A `member` who was never granted
 * anything holds no level at all.
 *
 * ## Two places they are enforced
 * A WRITE is refused inside `apply()`: {@link members} registers a
 * `precondition` hook, so the check reads through the batch's own transaction
 * before a row moves, and a refused batch rolls back whole ({@link Denied}).
 * A READ never reaches `apply()`, so the door asks first —
 * {@link policy}`(storage).canRead(who, app)`.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { memberDoc, members, policy } from '@yaks/member'
 *
 * let vocab = loadVocab([memberDoc, club])
 * // let g = graph({ storage, vocab, plugins: [members({ app: list, space: club })] })
 * // let may = policy(storage, { space: club })
 * // may.canRead(dana, list)
 * ```
 *
 * ## The roster governs itself
 * Only an owner may write a `member`, a `grant` or an `access` — an editor
 * writes the data and does not hand out keys. That matters most on an `open`
 * thing, where anyone may write: without the rule, a visitor invited to sign
 * the guest book could rewrite the roster. The first owner is therefore seeded
 * before the guard is added; see {@link members}.
 *
 * ## Share links
 * A grant may name a `token` instead of a person. Whoever opens that link acts
 * AS the grant, so the door signs their writes with the grant's own entity and
 * everything above works unchanged — no account, no seat, one revocable row.
 *
 * ## What is deliberately not here
 * Authentication: establishing who someone IS belongs to the door. Invitations:
 * a new `member` row usually means writing to somebody, which is a
 * `created('member')` handler on
 * {@link https://jsr.io/@yaks/effects | @yaks/effects} — the slot this package
 * leaves for `@yaks/mail` to fill. And per-grant filters (a grant good for
 * only part of the data) — one level per thing, on purpose.
 *
 * It imports no platform API, so the same rules run on a server, in a worker,
 * and in a browser tab.
 *
 * @module
 */

export * from './words.ts'
export * from './comp.ts'
export * from './policy.ts'
export * from './deny.ts'
export * from './guard.ts'
export * from './plugin.ts'
