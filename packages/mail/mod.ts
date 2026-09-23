/**
 * @yaks/mail — letters, in the graph: the mail components for a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}.
 *
 * Say a book club runs on a graph. It has people, a reading list, a potluck
 * sign-up. Sooner or later it has to write to somebody — an invitation, a
 * reminder, an answer to a question that arrived by email — and that is this
 * package: a letter is an entity like everything else, so it is queryable,
 * attributable, and hangs off the thing it is about.
 *
 * ## A letter is an entity
 * ```ts
 * import { mailDoc } from '@yaks/mail'
 * // { entity: { eid: 'e1' },
 * //   doc: { title: 'Potluck Friday', body: 'Bring a dish.' },
 * //   mail: { from: 'hello@books.example', target: potluck },
 * //   deliver: { to: ana } }
 * ```
 * `mail` is the envelope, `deliver` is the request to send it, and `target` is
 * what it is about — any entity at all. Because the recipient is an entity
 * rather than a string, the address it goes to is whatever their
 * {@link mailDoc | `email`} component holds at the moment it leaves.
 *
 * ## The subject and the body are a `doc` They are `doc{title, body}`, from
 * {@link https://jsr.io/@yaks/doc | @yaks/doc}, which this package depends on.
 * The words a person reads belong in the one component every readable thing
 * has, so a letter is searched, rendered and edited by whatever already handles
 * a `doc` — instead of by a second copy of the same two properties.
 *
 * Compose `docs()` beside {@link mailbox}, never inside it: a vocabulary
 * rejects a component declared twice, so an application that already declares
 * `doc` is not fought over it.
 *
 * ## Sending is an effect, not a write
 * Nothing in `apply()` talks to a mail server. {@link sending} is a
 * `created(mail)` handler on {@link https://jsr.io/@yaks/effects | @yaks/effects}:
 * it runs after the transaction commits, hands the letter to the
 * {@link Sender} the caller supplied, and writes back what happened —
 * `delivered{at, via}` or `bounced{at, reason}`. So the write cannot fail
 * because a mail server is down, and "what became of that letter?" is a query.
 *
 * Two senders ship: {@link cloudflare} (Cloudflare Email Sending, credentials
 * passed in, never held here) and {@link stash} (keeps them in an array — what
 * a test and a development environment want).
 *
 * ## Receiving is a pure function {@link inbound} turns a message as an Email
 * Worker receives it into the bundles that record it. It queries the graph for
 * nothing, so it can be tested without one. The two properties that are lookups
 * — whom the letter is about, which letter it answers — are answered by {@link
 * arrived} one file over, where there is a graph to query, and
 * `@yaks/mail/routes` exports the HTTP route a mail edge posts a letter on.
 *
 * ## The worked example
 * {@link invited} fills the `created(member)` handler slot
 * {@link https://jsr.io/@yaks/member | @yaks/member} documents and leaves
 * empty: somebody joins the club, and an invitation is written — the sending
 * effect carries it like any other letter.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { effects } from '@yaks/effects'
 * import { loadVocab } from '@yaks/vocab'
 * import { docDoc, docs } from '@yaks/doc'
 * import { invited, mailbox, mailDoc, stash } from '@yaks/mail'
 *
 * let vocab = loadVocab([docDoc, mailDoc, club])
 * let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
 * let post = stash()
 * let g = graph({ storage, vocab, plugins: [fx, docs(), mailbox({ domain: 'books.example', sender: post, effects: fx })] })
 *
 * fx.created('member', invited({
 *   apply: (bundles) => g.apply(bundles),
 *   welcome: () => ({
 *     from: 'hello@books.example',
 *     subject: 'You are in the book club',
 *     body: 'Welcome. We meet Thursdays.',
 *   }),
 * }))
 * ```
 *
 * ## What is deliberately not here
 * MIME parsing (pass {@link inbound} the text — a parser is a parser's job),
 * queues and retries (a bounced letter is data; writing a fresh one is the
 * retry), and any credential of any kind.
 *
 * The core — the vocabulary, {@link canon}, {@link inbound}, {@link sending} —
 * imports no platform API, so it runs on a server, in a Worker, and in a
 * browser tab. The Cloudflare sender is one file away in `./cloudflare.ts`.
 *
 * @module
 */

export * from './comp.ts'
export * from './addr.ts'
export * from './md.ts'
export * from './send.ts'
export * from './stash.ts'
export * from './cloudflare.ts'
export * from './inbound.ts'
export * from './arrive.ts'
export * from './invite.ts'
export * from './plugin.ts'
export * from './options.ts'
export * from './pull.ts'
