# @yaks/mail

Email storage, incoming-message processing, and outgoing delivery for
[@yaks/graph](../graph/README.md). Use it to record correspondence, send
messages when graph entities are created, or provide an inbox through the CLI
and MCP.

The graph's storage adapter stores messages, addresses, recipients, and delivery
outcomes. This package opens no database of its own. You supply the email
transport; `stash()` provides an in-memory transport for tests and development.
A **bundle** is one entity's components as a JSON object. A **batch** is a list
of changes applied in one transaction.

## Install

```sh
deno add jsr:@yaks/mail
# or: npx jsr add @yaks/mail
```

## Example: membership and messages

A message is an entity with these components:

```ts
// g is a configured graph; ana and potluck are existing entity ids.
await g.apply([{
  entity: { eid: 'e1' },
  doc: {
    title: 'Potluck Friday',
    body: 'Bring a dish. [Sign up](https://books.example/potluck)',
  },
  mail: { from: 'hello@books.example', target: potluck },
  deliver: { to: ana },
}])
```

| Component   | Stored information                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mail`      | Sender and recipient addresses, time, related entity (`target`), threading fields, Message-ID, verification result, and transport id. |
| `email`     | An entity's email address (`address`).                                                                                                |
| `deliver`   | The recipient entity id (`to`) and when the message was handed to the sender (`tried`); requests outgoing delivery.                   |
| `delivered` | Delivery time and transport receipt (`at`, `via`).                                                                                    |
| `bounced`   | Failed delivery time and reason (`at`, `reason`).                                                                                     |
| `notified`  | When a recipient was notified, by whom, and through which entity (`at`, `by`, `via`).                                                 |

The subject and body use `doc{title, body}` from [@yaks/doc](../doc/README.md).
Load that package alongside this one. `mail.target` can refer to any entity, so
a page or task can have related correspondence. `deliver.to` refers to an entity
whose `email.address` is looked up at send time; `mail.to` records the address
used once delivery succeeds.

## Delivery requests

A message with both `mail` and `deliver` requests sending. A message with only
`mail` is stored without sending, as a draft or received message. Received
messages have no `deliver`, so receiving them does not send them back out.

The default sending handler runs when `mail` is created. To send a draft when
`deliver` is added later, also register
`fx.created('deliver', sending({ sender }))`. The handler skips a message that
already has `delivered`, `bounced` or `deliver.tried`; retry by creating a new
message.

Sending is at most once. The handler stamps `deliver.tried` before the message
reaches the transport, so a crash between the send and its outcome leaves a
message with `tried` and no outcome, which is never handed over again. The
handler declares a sweep over the messages still owed a send (`PENDING`), so a
host replays it at start-up and a message written while no sender could run goes
out with the first process that has one.

## Delivery after commit

`sending()` registers with [@yaks/effects](../effects/README.md) and calls the
transport after the original transaction commits. It records the outcome through
a second `graph.apply()` call. This makes the outcome available to queries,
subscriptions, and journaling when those plugins are configured. A transport
failure does not roll back the original message. Effects are awaited, so a slow
transport can still delay completion of the call.

This complete in-memory example sends through `stash()`:

```ts
import { effects } from '@yaks/effects'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc, docs } from '@yaks/doc'
import { mailbox, mailDoc, stash } from '@yaks/mail'

let vocab = loadVocab([docDoc, mailDoc])
let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
let post = stash()
let g = graph({
  storage: ram(vocab),
  vocab,
  plugins: [
    fx,
    docs(),
    mailbox({ domain: 'books.example', sender: post, effects: fx }),
  ],
})

await g.apply([
  { entity: { eid: 'ana' }, email: { address: 'ana@books.example' } },
  {
    entity: { eid: 'message' },
    doc: { title: 'Thursday', body: 'We meet at seven.' },
    mail: { from: 'hello@books.example' },
    deliver: { to: 'ana' },
  },
])
console.log(post.last()?.subject) // Thursday
```

The outcome writer uses `trusted: true` because `delivered` and `bounced`
properties are server-owned. `docs()` supplies the document component
separately; `mailbox()` declares only the six mail components and normalizes
addresses. Pass both `effects` and `sender` to `mailbox()` to enable automatic
sending.

Success writes `delivered{at, via}`, with the receipt id or, when absent, the
recipient address as `via`. A rejected send writes `bounced{at, reason}`.
Missing recipient addresses and missing sender addresses also produce `bounced`.

### The transport is supplied by the caller

```ts
type Sender = { send: (message: Message) => Promise<Receipt> }
```

`cloudflare({ account, token })` implements this interface using Cloudflare
Email Sending and `fetch`. Credentials are arguments, not read from environment
variables by the sender. Its optional `base` and `fetch` arguments support tests
and alternate endpoints. `stash()` retains messages in `sent`, provides
`last()`, and returns receipts named `stash-1`, `stash-2`, and so on.
`stash({ refuse: 'reason' })` simulates delivery failure.

### Local delivery

For addresses whose recipients read messages directly from this graph, pass a
local domain:

```ts
mailbox({
  domain: 'books.example',
  local: 'books.example',
  sender,
  effects: fx,
})
```

Recipients at that domain get `delivered{via: 'local'}` and `mail.to` without a
transport call. Omit `local` when mail for that domain must reach an external
mailbox. The configuration-file form uses `local: true` with `domain`; the
direct `mailbox()` API takes the domain string as `local`.

## Incoming messages

`inbound()` converts a message into a bundle without querying the graph. It
accepts `from`, `to`, and a `headers` object with a `get(name)` method, matching
the relevant parts of a Cloudflare Email Workers message. Parse MIME separately
and supply the resulting text:

```ts
import { inbound } from '@yaks/mail'

let message = {
  from: 'bounces@relay.example',
  to: 'hello@books.example',
  headers: new Headers({
    From: 'Ana <ana@books.example>',
    Subject: 'Thursday',
    'Message-ID': '<message-1@books.example>',
  }),
}
await g.apply(inbound(message, { text: 'See you at seven.' }))
```

The author comes from the `From` header, falling back to the envelope sender.
The subject, Message-ID, and date come from headers. `Arrival` options can
supply an entity id, timestamp, target, reply entity, and verification result.
Defaults use a new UUID and, when no date is supplied, the current time.

### The two questions that need a graph

`arrived()` adds recipient routing, reply lookup, duplicate detection, and
author attribution:

```ts
import { arrived } from '@yaks/mail'

let receive = arrived({ graph: g, domain: 'books.example', triage: 'inbox' })
await g.apply(await receive(message, { text: 'See you at seven.' }))
```

`triage` is an existing fallback entity id. `wearer()` finds an entity by its
`email.address`. For the configured domain, `named()` also resolves an address's
local part through `graph.address`: for example, `S-31@books.example` can name
entity S-31 without a separate email record. `routed()` tries the address record
first, then the id. Unmatched recipients use `triage`, or have no target if it
is omitted.

`known()` finds a stored message by Message-ID. `arrived()` returns `[]` if that
id is already stored, and resolves `In-Reply-To` to `mail.reply_to` when
possible. This duplicate check is a read before the caller writes, not a
uniqueness constraint covering concurrent arrivals. Messages without a
Message-ID cannot be deduplicated this way.

Only a recognized author's address supplies `$actor.by`; unknown senders remain
unattributed. `arrived()` also reads the DKIM result from
`Authentication-Results` unless the caller supplies `verified`. A failed result
is recorded as `false`, not grounds for discarding the message.

## The arrival endpoint

`@yaks/mail/routes` exports `routes()`, which provides `POST /mail/inbound` by
default. It accepts the message headers and already parsed body:

```sh
curl -X POST http://localhost:8000/mail/inbound \
  -H 'content-type: application/json' -H 'authorization: Bearer TOKEN' -d '{
  "from": "bounces@relay.example",
  "to": "ana@books.example",
  "headers": { "From": "Ana <ana@books.example>", "Subject": "Thursday" },
  "text": "See you at seven."
}'
# {"eid":"..."}, or {"eid":null} if that Message-ID was already stored
```

`verified` is an optional top-level boolean when the receiving system supplies a
DKIM result separately. Configure `door.secret` to require a bearer token. If it
is absent, this route performs no token check itself; enclosing server
authentication, if any, still applies. `door.path` changes the path, and the
top-level `triage` sets the fallback recipient entity.

A plugin entry in a `yak serve` configuration can be:

```json
{
  "use": "@yaks/mail",
  "with": {
    "domain": "books.example",
    "local": true,
    "triage": "inbox",
    "sender": {
      "via": "cloudflare",
      "account": "a1b2",
      "token": { "env": "CF_EMAIL_TOKEN" }
    },
    "door": {
      "path": "/mail/inbound",
      "secret": { "env": "MAIL_DOOR_SECRET" }
    }
  }
}
```

The CLI configuration loader resolves `{ "env": "NAME" }`; direct TypeScript
calls receive strings. No sender configuration means no sending handler. Missing
Cloudflare credentials or an unsupported transport registers a handler that
sends nothing: it warns once, when it meets a message it cannot send, and leaves
that message for the first process with a sender. `mail check` reports the
configuration problem too.

## Pulling from an edge

A graph behind a perimeter cannot be posted to. Its edge keeps what arrived
instead, and `@yaks/mail/service` pulls it: a duty the host runs under the
`@yaks/mail` lease, so one process over the graph pulls at a time, and a
one-shot `yak` command pulls once when nobody else is. Name the edge under
`pull`:

```json
{
  "use": "@yaks/mail",
  "with": {
    "domain": "books.example",
    "pull": {
      "url": "https://inbox.books.example",
      "token": { "env": "INBOX_TOKEN" },
      "every": 10000
    }
  }
}
```

The edge holds two trays. `GET /messages?unnotified=1&.dir=in&limit=100` lists
the letters nobody has taken; each is recorded through `arrived()`, and
`POST /messages/notified {ids}` tells the edge they are taken.
`GET /requests?unprocessed=1&limit=100` lists the requests posted to its hook
paths (a 404 means there is no such tray); where the graph declares
[@yaks/hook](../hook/README.md), each becomes a `hook` about the mailbox its
first path segment names (`/hook/books/…` is whoever has `books@<domain>`), and
`POST /requests/processed {ids}` acknowledges them.

Taking is first come, first served at the edge: two graphs must never name the
same edge, and a copy of a config that pulls takes the mail from the graph it
was copied from. Every record is idempotent — a letter by its Message-ID, a
request by the id derived from it — so a crash between recording and
acknowledging only repeats the pull. An item that cannot be recorded stays at
the edge and is tried again.

## The tools

`@yaks/mail/tools` exports `runs()`. A server loading these implementations and
the vocabulary exposes the following CLI commands and corresponding MCP names
with underscores, such as `mail_send`:

| Tool                 | Behavior                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `inbox list`         | Messages addressed to a reader, excluding archived messages; default limit 50, newest inserted first. |
| `inbox archive <id>` | Add `archived` to the item without deleting it.                                                       |
| `mail show <id>`     | Show a message and its thread, and mark the message `opened`.                                         |
| `mail reply <id>`    | Create a threaded reply; archive the original if it was received.                                     |
| `mail send`          | Create a message with `deliver`, creating an email entity for an unknown recipient address.           |
| `mail check`         | Find received messages with no sender and report unusable sender configuration.                       |

```sh
yak inbox list
yak mail show E-12
yak mail reply E-12 --body @answer.md
yak inbox archive E-11
yak mail send ana@books.example 'Thursday' --body 'We meet at seven.'
```

The inbox selects messages by `mail.target`, `deliver.to`, or the reader's
address in `mail.to`. `who` defaults to the caller; `--all` includes archived
items. `●` means unread, `·` read, and `×` archived. Reading leaves a message in
the inbox. The `opened` and `archived` components belong to
[@yaks/kernel](../kernel/README.md) and are stored on the message, not
separately per reader. Load that vocabulary to retain these marks; undeclared
components are dropped by graph admission.

Replies use the original recipient address as sender for received messages, or
the original sender address when following up on an outgoing message. The reply
subject has one `Re:` prefix. Sending defaults `from` to the caller's
`email.address`. Both tools return changes for the tool runner to apply; the
configured sending effect performs delivery. With `sender: { "via": "stash" }`,
the same flow records outgoing messages in memory.

## Membership invitations

Register `invited()` as a `created('member')` handler to create a welcome
message when [@yaks/member](../member/README.md) adds a membership:

```ts
import { invited } from '@yaks/mail'

fx.created(
  'member',
  invited({
    apply: (bundles) => g.apply(bundles),
    welcome: ({ role }) => ({
      from: 'hello@books.example',
      subject: role == 'owner'
        ? 'You run the book club'
        : 'You are in the book club',
      body: 'Welcome. We meet Thursdays.',
    }),
  }),
)
```

Load the member vocabulary for this example. `welcome` can return `null` to skip
an invitation. The handler creates a message about the membership entity with
`deliver.to` set to the member's person id. The normal sending effect handles
it, including recording `bounced` if that entity has no email address.

## Addresses

`canon(domain)` lowercases addresses at the configured domain and removes
underscores from their local part. Other domains are unchanged:

```ts
import { canon } from '@yaks/mail'

let mine = canon('books.example')
mine('Book_Club@Books.Example') // 'bookclub@books.example'
mine('ana@elsewhere.com') // 'ana@elsewhere.com'
```

The underscore rule is this package's Cloudflare-routing compatibility policy.
`mailbox({ domain })` normalizes `email.address`, `mail.from`, and `mail.to`
before storage. Normalization does not impose uniqueness on email entities.

## Bodies

`message()` renders a Markdown body as plain text and HTML. The small renderer
supports paragraphs, headings, bullets, links, bold, italic, and inline code. It
escapes input HTML and emits links only for absolute `http`, `https`, `mailto`,
and `tel` URLs. Relative links remain text. To use another renderer, construct a
`Message` with your own `html` and pass it to a sender directly.

## Exports

The root import `@yaks/mail` provides:

| Exports                                                                    | Purpose                                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `mailDoc`, `MAIL`, `EMAIL`, `DELIVER`, `DELIVERED`, `BOUNCED`, `NOTIFIED`  | Vocabulary and component names.                                            |
| `mailbox`, `Mailbox`                                                       | Graph plugin and its options.                                              |
| `sending`, `message`, `addressOf`, `Post`, `Sender`, `Message`, `Receipt`  | Sending handler, message composition, address lookup, and transport types. |
| `cloudflare`, `payload`, `Account`, `Payload`, `Fetch`                     | Cloudflare transport and request construction.                             |
| `stash`, `Stash`, `Kept`                                                   | In-memory transport.                                                       |
| `inbound`, `author`, `messageId`, `verdict`, `Received`, `Arrival`, `Head` | Incoming-message conversion and header interpretation.                     |
| `arrived`, `wearer`, `named`, `routed`, `known`, `Arrivals`, `Book`        | Graph lookups used when receiving.                                         |
| `pull`, `edge`, `received`, `hookTo`, `messageIdOf`, `Edge`, `Pulled`      | Pulling arrivals from an edge.                                             |
| `invited`, `Invite`, `Welcome`, `Seat`                                     | Membership invitation handler and types.                                   |
| `canon`, `local`, `at`, `parts`, `address`                                 | Address parsing and normalization.                                         |
| `html`, `text`, `tokens`, `linkable`, `escape`, `Token`                    | Body rendering.                                                            |
| `Options`, `Transport`, `Door`, `Pull`                                     | Plugin configuration types.                                                |

Separate entry points provide `mailDoc` and `docs` from `@yaks/mail/vocab`,
`rules()` from `@yaks/mail/rules`, `effects()` and `post()` from
`@yaks/mail/effects`, `routes()`, `PATH`, and `Posted` from `@yaks/mail/routes`,
`service()` and `EVERY` from `@yaks/mail/service`, and `runs()` plus inbox and
thread helpers from `@yaks/mail/tools`. They are not root re-exports. Their
`host` argument is the process that opened the graph, represented by the
services each function needs; for example, `routes()` needs `{ graph }`.

## What is deliberately not here

The package does not parse MIME, speak IMAP or POP, schedule retries, or manage
credentials. Applications supply those services. A failed message remains
queryable, and a retry is a new message. `deliver.to` is an entity id; the
recipient's address is resolved when sending.

## Integration

Use [@yaks/doc](../doc/README.md) for message text,
[@yaks/effects](../effects/README.md) for sending and invitations, and
[@yaks/member](../member/README.md) when invitations should follow membership
creation. The graph's storage adapter and optional journal retain the data.

## Compatibility

The core uses standard JavaScript and Web APIs and runs on Deno, Node, browsers,
and Cloudflare Workers. The Cloudflare sender uses `fetch`; its message types
are checked against `@cloudflare/workers-types` in `conform.ts`.
