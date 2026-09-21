# @yaks/mail

Email components, inbound-message normalization, and outbound delivery for a
graph. Messages, recipients and delivery outcomes are stored as graph data; the
transport and any scheduling come from outside this package.

Throughout this README, "the server" means whichever process opened the graph
and loaded this package — usually a long-running `yak serve`, sometimes just the
CLI.

## Install

```sh
deno add jsr:@yaks/mail
# or: npx jsr add @yaks/mail
```

## Example: membership and messages

A book club keeps its people, its reading list and its potluck sign-up in one
graph. Sooner or later it has to write to somebody. A letter here is an entity
like everything else:

```ts
await club.apply([{
  entity: { eid: 'e1' },
  doc: {
    title: 'Potluck Friday',
    body: 'Bring a dish. [Sign up](https://books.example/potluck)',
  },
  mail: { from: 'hello@books.example', target: potluck },
  deliver: { to: ana },
}])
```

Three things are worth naming in that:

- **`mail` is the ENVELOPE** — from, to, when, what it is about, what it
  answers. The subject and the body are `doc{title, body}`, from
  [@yaks/doc](https://jsr.io/@yaks/doc), because the words a person reads belong
  in the one component every readable thing has — so a letter is searched,
  rendered and edited by whatever already handles a `doc`.
- **`target` is what the letter is about**, and it may be any entity at all. The
  potluck's page can therefore show the letters about the potluck, without
  anybody designing a mail feature into it.
- **`deliver.to` is a PERSON, not a string.** The address the letter goes to is
  whatever their `email` component holds at the moment it leaves, so somebody
  who changes address does not strand the mail nobody has sent yet.

## A letter is sent when it asks to be

`deliver` is the request. A `mail` with no `deliver` is a letter you are keeping
— a draft, or one that arrived — which is why an arrival can never echo itself
back out.

## Sending is an effect, not a write

Nothing in `apply()` talks to a mail server. `sending` is a `created(mail)`
handler on [@yaks/effects](https://jsr.io/@yaks/effects): it runs after the
transaction commits, hands the letter to a `Sender`, and writes back what
happened.

```ts
import { effects } from '@yaks/effects'
import { docDoc, docs } from '@yaks/doc'
import { mailbox, mailDoc, stash } from '@yaks/mail'

let vocab = loadVocab([docDoc, mailDoc, club])
// The write path the outcome is recorded through — trusted, because
// `delivered` and `bounced` are the sender's report and therefore server-owned.
let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
let post = stash()
let g = graph({
  storage,
  vocab,
  plugins: [
    fx,
    docs(),
    mailbox({ domain: 'books.example', sender: post, effects: fx }),
  ],
})
```

`docs()` is composed beside `mailbox()`, never inside it: a vocabulary rejects a
component declared twice, so `doc` keeps one home and an application that
already declares it is not fought over it.

The outcome is written back through the graph's own `apply()`, so it is
journaled and pushed to whoever is subscribed to the letter — a write straight
into storage would be a row they only find on their next read. This also means a
write cannot fail because a mail server is down, and _what became of that
letter_ is a query and a live update, not a log file:

```text
delivered { at, via }     it left; `via` is the id the transport returned
bounced   { at, reason }  it did not, and this is what the transport reported
```

Exactly one of the two lands on a letter, and a retry is a new letter — not a
queue this package hides from you.

### The transport is supplied by the caller

```ts
type Sender = { send: (message: Message) => Promise<Receipt> }
```

Two implementations ship. `cloudflare({ account, token })` calls Cloudflare
Email Sending, and holds no credentials and reads no environment variables — the
account and token are arguments, so the same code runs in a Worker, on a server,
and against a stub. `stash()` keeps the messages in an array, which is what a
test and a development environment want.

### Local delivery

`local` names a domain whose addresses are your GRAPH's own — an agent, a
project, anything reachable here and nowhere else:

```ts
mailbox({
  domain: 'books.example',
  local: 'books.example',
  sender,
  effects: fx,
})
```

A letter to one of those addresses is already where it is going, so it is
stamped `delivered { via: 'local' }` and never handed to the transport — sending
it out would bring it back as a second letter about the same words. Leave the
option out where somebody reads that domain's mail in a mail client: then the
mailbox is the destination and the graph is only the record.

## Receiving is a pure function

```ts
// in a Worker's email() handler
let text = await parse(message.raw) // your MIME parser
await g.apply(inbound(message, { text, target: club }))
```

`inbound` takes a message in the shape Cloudflare's Email Workers hand you and
returns bundles. It queries the graph for nothing, so it can be tested without
one.

It does not parse MIME. Turning RFC 5322 into text is a parser's job, and this
package would rather not carry one.

### The two questions that need a graph

Whom the letter is about (`target`) and which earlier letter it answers
(`reply_to`) are lookups, so they live one file over, where there is a graph to
query. `arrived` combines them with `inbound`:

```ts
let receive = arrived({ graph, domain: 'books.example', triage: pile })
await graph.apply(await receive(message, { text }))
```

- **The address book is read backwards**: `wearer` finds the entity that has a
  given address, and a sender nobody knows resolves to nobody — never to
  whatever a fallback would have picked, or a stranger's letter joins the
  journal attributed to whoever runs the mailbox. The transaction carries
  `$actor` only where the address book knew the author.
- **The id grammar is the address grammar**: at your own domain, an address
  whose local part is an id this graph knows names that entity —
  `S-31@books.example` is S-31, resolved through `graph.address`, the same call
  that resolves an id a person typed. Derived, never stored, so writing to
  something short-lived does not mean creating an address-book row for it.
- **A letter addressed to nobody here** lands on `triage`, if you name a triage
  entity.
- **The Message-ID makes an arrival idempotent.** The same message recorded
  twice returns no bundles at all, which is what a client that retried a POST
  and a sweep that pulled the same page both need.

## The arrival endpoint

Mail lands at the edge of the world, in front of a domain, and the graph is
usually somewhere that edge cannot reach back into. `@yaks/mail/routes` exports
the HTTP route a letter is posted on — the message as it arrived, and nothing
else:

```sh
curl -X POST http://box/mail/inbound -H 'authorization: Bearer …' -d '{
  "from": "bounces@relay.example",
  "to": "ana@books.example",
  "headers": { "From": "Ana <ana@books.example>", "Subject": "Is there soup?" },
  "text": "asking"
}'
# {"eid":"b7ee3386-…"}   — or {"eid":null}, meaning it was already here
```

The subject, the Message-ID, the date and the DKIM verdict are read out of those
headers rather than repeated in the request body; two copies of one fact is how
they come to disagree. Who may post is this plugin's option: name no
`door.secret` and the route is as open as the `/apply` beside it, which is right
for a server behind a perimeter and wrong for anything else.

```json
{
  "use": "@yaks/mail",
  "with": {
    "domain": "books.example",
    "local": true,
    "sender": {
      "via": "cloudflare",
      "account": "a1b2",
      "token": { "env": "CF_EMAIL_TOKEN" }
    },
    "door": {
      "path": "/mail/inbound",
      "secret": { "env": "MAIL_DOOR_SECRET" },
      "triage": "…"
    }
  }
}
```

## The tools

`@yaks/mail/tools` exports `runs()`, the implementations of the `tool: true`
declarations in `vocab.json`, so a server that composes this plugin lists them
on `/mcp` and accepts them on its `yak` command line.

| tool                 | does                                                         |
| -------------------- | ------------------------------------------------------------ |
| `inbox list`         | what is addressed to a reader and not archived, newest first |
| `inbox archive <id>` | hide one item until it needs them again                      |
| `mail show <id>`     | one letter whole, its thread beneath — and marks it read     |
| `mail reply <id>`    | answer it, threaded, from the address it came to             |
| `mail send`          | write a letter and request that it be sent                   |
| `mail check`         | verify that every letter that arrived carries a sender       |

```sh
yak inbox list                       # ● unread · read × archived
yak mail show E-12                   # reading IS the mark
yak mail reply E-12 --body @answer.md
yak inbox archive E-11
yak mail send ana@books.example 'Thursday' --body 'We meet at seven.'
```

**The inbox is a query, never a folder.** A letter is addressed to somebody
three ways — routed to them (`mail.target`), written to them (`deliver.to`), or
delivered to an address they have (`mail.to`) — so the inbox is those three
asked as one `or`, minus what has been archived. Nothing is moved or copied on
the way in, which is why the same letter reads the same through every interface.

**Archiving is the one act that hides.** Reading a letter marks it read and
leaves it in the list; only `inbox archive` takes it out, and `--all` shows the
hidden ones again. No sweep or second reader can drain somebody's inbox behind
them. The one thing that archives on its own is answering an arrival: a thread
you have replied to is not one waiting on you.

**Replying and sending never talk to a mail server.** They CREATE a letter that
asks to be sent (`deliver`), and `@yaks/mail/effects` — built from the `sender`
the config names — is what hands it over. A development server sets
`"sender": {"via": "stash"}` and the whole flow runs with the letters piling up
in memory.

`archived` and `opened` are another package's components (@yaks/kernel's). A
tool returns bundles, which are plain data, so naming a component costs no
import; a server that composes the kernel's vocabulary stores them, and one that
does not has those components dropped on write, leaving an inbox that never
shrinks.

## Invitations: @yaks/member's empty slot, filled

[@yaks/member](https://jsr.io/@yaks/member) ships a roster and documents a
`created(member)` handler slot it deliberately leaves empty. `invited` is that
handler:

```ts
fx.created(
  'member',
  invited({
    apply: (change) => g.apply(change),
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

It sends nothing. It WRITES a letter, through the graph's own `apply()`, and the
sending effect carries it like any other — so an invitation to somebody with no
address on file ends up as a `bounced` component saying so, rather than as
silence.

## Addresses

`canon(domain)` returns the canonical form of an address at **your** domain:
lowercased, underscores dropped. Everyone else's domain passes through
untouched, because only the server behind it knows what it considers the same
mailbox.

```ts
let mine = canon('books.example')
mine('Book_Club@Books.Example') // 'bookclub@books.example'
mine('ana@elsewhere.com') // 'ana@elsewhere.com'
```

The underscore is not fussiness: Cloudflare Email Routing rejects one in the
local part at RCPT, upstream of anything you deploy. `mailbox({ domain })`
applies this in the `normalize` phase, so an address is canonical before it is
stored and an address book cannot hold two rows for one person.

## Bodies

A body is markdown, and it goes out twice — as text and as HTML. Two rules hold
in the HTML: markup a letter wrote is escaped (a letter from a stranger cannot
ship a `<script>` to your reader), and an href is judged by its **shape**, not
by a list of bad schemes — a browser decodes entities inside an attribute, so
`javascript&colon;…` is a scheme by the time it parses one. Only absolute http,
https, mailto and tel links become anchors; a relative link would reach a mail
client with no base document to resolve it against.

The renderer is deliberately small (paragraphs, headings, bullets, links, bold,
italic, code). Pass `Message.html` in yourself if you have a renderer you
prefer.

## Exports

| export                                             | is                                             |
| -------------------------------------------------- | ---------------------------------------------- |
| `mailDoc`                                          | the six components, beside `@yaks/doc`'s `doc` |
| `MAIL`, `EMAIL`, `DELIVER`, …                      | their names                                    |
| `mailbox(opts)`                                    | the @yaks/graph plugin — vocab, canon, sending |
| `sending({ sender, now, local })`                  | the `created(mail)` handler                    |
| `message(letter, to, replyTo?)`                    | a letter composed, purely                      |
| `Sender`, `Message`, `Receipt`                     | the transport interface                        |
| `cloudflare({ account, token })`, `payload`        | Cloudflare Email Sending, and its payload      |
| `stash()`                                          | the sender that keeps them in an array         |
| `inbound(message, arrival)`, `author`, `messageId` | an arrival → bundles                           |
| `arrived({ graph, domain, triage })`               | the same, with the two lookups answered        |
| `wearer`, `named`, `routed`, `known`               | the address book, read backwards               |
| `routes(host, options)`, `PATH`                    | the arrival endpoint                           |
| `runs(host, options)`                              | the implementations of the tools it declares   |
| `Options`, `Transport`, `Door`                     | what a config passes to this plugin            |
| `invited({ welcome, apply })`                      | the `created(member)` handler                  |
| `canon`, `local`, `at`, `parts`, `address`         | addresses                                      |
| `html`, `text`, `tokens`, `linkable`, `escape`     | the two body renderings                        |

## What is deliberately not here

**Queues and retries.** A bounced letter is data; writing a fresh one is the
retry, and it leaves a record. A queue that hides failures is the thing this
replaces.

**MIME parsing**, and **any credential of any kind**.

**A clock.** Nothing here polls. Where mail has to be PULLED — an edge that
cannot reach in, so the graph fetches what arrived — `arrived` is the half that
turns each message into bundles, idempotent on the Message-ID, and whatever runs
on a timer belongs to the caller.

**A `to` on `deliver`.** Where a letter goes is one question with one answer:
the recipient entity's address, read when it leaves.

## Integration

A set of components over [@yaks/graph](https://jsr.io/@yaks/graph), the same
shape an application's own plugin has. It sends through
[@yaks/effects](https://jsr.io/@yaks/effects), and fills the handler slot
[@yaks/member](https://jsr.io/@yaks/member) leaves for it.

## Compatibility

The core — the components, `canon`, the body renderings, `inbound`, `sending` —
imports no platform API. Runs on **Deno**, **Node**, in a **Cloudflare Worker**,
and in the **browser**. The Cloudflare sender uses `fetch` and nothing else; its
structural types are checked against `@cloudflare/workers-types` in
`conform.ts`.
