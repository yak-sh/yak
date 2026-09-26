/**
 * @yaks/member — access control for a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}: who belongs to a space, and
 * what each of them may do.
 *
 * A **principal** is the entity acting — a person, or the grant behind a share
 * link. An **app** is any entity access is decided about; this package never
 * declares what an app is. Three components answer three questions:
 *
 * - **Who belongs?** A `member{space, person, role}` row puts one person on a
 *   space's roster. `owner` runs the space; `member` belongs to it.
 * - **What may they do?** A `grant{app, person, access}` gives one principal
 *   one level — `owner`, `editor` or `viewer` — on one app.
 * - **And everyone else?** An `access{mode}` on the app declares `public`
 *   (anyone with the link reads it), `open` (anyone with the link reads AND
 *   writes it, signed in or not), or `private` (only principals holding a
 *   permission see it at all).
 *
 * ## Membership is not permission
 * A row on the roster gives nothing by itself. A member with no grant reaches
 * an app exactly as far as a stranger with the link does — which is what makes
 * a roster safe to be generous with. The one shortcut is the space's **owner**,
 * who holds `owner` on every app in it, never stored per app. Removing someone
 * is then one row: delete the membership and every permission implied by it
 * goes too.
 *
 * ## The three checks
 * ```text
 * read      the mode is not `private`, or the principal holds any level
 * write     the mode is `open`,        or the principal holds owner or editor
 * call out  the credential is open to anyone, or the principal holds any level
 * ```
 * A `viewer` never writes, under any mode. A `member` who was never granted
 * anything holds no level at all.
 *
 * ## Where each check runs
 * A write is refused inside `apply()`: {@link members} registers a
 * `precondition` hook, which runs inside the transaction before any row has
 * moved, so a refused set of changes rolls back whole ({@link Denied}). A read
 * never reaches `apply()`, so the HTTP layer checks first —
 * {@link policy}`(storage).canRead(who, app)`.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { memberDoc, members, policy } from '@yaks/member'
 *
 * let vocab = loadVocab([memberDoc])
 * let storage = ram(vocab)
 * let g = graph({ storage, vocab })
 * await g.apply([
 *   { entity: { eid: 'club' } },
 *   { entity: { eid: 'dana' } },
 *   { entity: { eid: 'list' }, access: { mode: 'private' } },
 *   {
 *     entity: { eid: 'm1' },
 *     member: { space: 'club', person: 'dana', role: 'owner' },
 *   },
 * ])
 * g.use(members({ app: 'list', space: 'club' }))
 *
 * let may = policy(storage, { space: 'club' })
 * await may.canRead('dana', 'list') // true
 * ```
 *
 * ## Only an owner edits the access rows
 * Writing a `member`, a `grant` or an `access` requires `owner` — an editor
 * writes the app's data and does not hand out permissions. That matters most on
 * an `open` app, where anyone may write: without the rule, a visitor invited to
 * sign the guest book could rewrite the roster. The first owner is therefore
 * written before the guard is installed; see {@link members}.
 *
 * ## Share links
 * A grant may name a `token` instead of a person. Whoever opens that link acts
 * as the grant, so the HTTP layer signs their changes with the grant's own
 * entity id and everything above works unchanged — no account, no roster row,
 * one revocable row.
 *
 * ## What is deliberately not here
 * Authentication: establishing who someone is belongs to the HTTP layer.
 * Invitations: a new `member` row usually means messaging somebody, which is a
 * `created('member')` handler on
 * {@link https://jsr.io/@yaks/effects | @yaks/effects} — the hook this package
 * leaves for `@yaks/mail` to register. And per-grant filters (a grant good for
 * only part of an app's data) — one level per app, on purpose.
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
