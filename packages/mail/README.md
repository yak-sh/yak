# @yaks/mail

Letters, in the graph: the **mail** component domain for a
[@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/mail
# or: npx jsr add @yaks/mail
```

## The book club

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
  [@yaks/doc](https://jsr.io/@yaks/doc), because the words a person reads live
  in the one component every readable thing wears — so a letter is searched,
  rendered and edited by whatever already handles a `doc`.
- **`target` is what it is about**, and it is any entity at all. The potluck's
  page can therefore show the letters about the potluck, without anybody
  designing a mail feature into it.
- **`deliver.to` is a PERSON, not a string.** The address it goes to is whatever
  their `email` says at the moment it leaves, so somebody who changes address
  does not strand the mail nobody has sent yet.

## A letter goes when it asks to

`deliver` is the ask. A `mail` with no `deliver` is a letter you are keeping — a
draft, or one that arrived — which is why an arrival can never echo itself back
out.

## Sending is an effect, not a write

Nothing in `apply()` talks to a mail server. `sending` is a `created(mail)`
handler on [@yaks/effects](https://jsr.io/@yaks/effects): it runs after the
batch commits, hands the letter to a `Sender`, and writes back what happened.

```ts
import { effects } from '@yaks/effects'
import { docDoc, docs } from '@yaks/doc'
import { mailbox, mailDoc, stash } from '@yaks/mail'

let vocab = loadVocab([docDoc, mailDoc, club])
let fx = effects(vocab)
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

`docs()` is composed beside `mailbox()`, never inside it: a vocabulary refuses a
component declared twice, so `doc` keeps one home and an application that
already has it is not fought over it.

So a write cannot fail because a mail server is down, and _what became of that
letter_ is a query, not a log file:

```text
delivered { at, via }     it left; `via` is the id the transport gave it
bounced   { at, reason }  it did not, and this is what the transport said
```

Exactly one of the two lands on a letter, and a retry is a new letter — not a
queue this package hides from you.

### The transport is injected

```ts
type Sender = { send: (message: Message) => Promise<Receipt> }
```

Two ship. `cloudflare({ account, token })` speaks Cloudflare Email Sending, and
holds no credentials and reads no environment — the account and token are
arguments, so the same code runs in a Worker, on a server, and against a stub.
`stash()` keeps the messages in a list, which is what a test and a development
environment want.

## Receiving is a pure function

```ts
// in a Worker's email() handler
let text = await parse(message.raw) // your MIME parser
await g.apply(inbound(message, { text, target: club }))
```

`inbound` takes a message in the shape Cloudflare's Email Workers hand you and
answers with bundles. It asks the graph nothing, so it tests without one — and
the two questions that DO need the graph are left to you: which entity the
letter is about (`target`), and which earlier letter it answers (find the one
whose `message_id` matches the `in-reply-to` header, patch `reply_to`).

It does not parse MIME. Turning RFC 5322 into text is a parser's job, and this
package would rather not carry one.

## Invitations: @yaks/member's empty slot, filled

[@yaks/member](https://jsr.io/@yaks/member) ships a roster and documents a
`created(member)` slot it deliberately leaves empty. `invited` is that handler:

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
address on file comes to rest as a `bounced` entity saying so, rather than as
silence.

## Addresses

`canon(domain)` is the canonical form of an address at **your** domain:
lowercased, underscores dropped. Everyone else's domain passes through
untouched, because only the server behind it knows what it considers the same
mailbox.

```ts
let mine = canon('books.example')
mine('Book_Club@Books.Example') // 'bookclub@books.example'
mine('ana@elsewhere.com') // 'ana@elsewhere.com'
```

The underscore is not fussiness: Cloudflare Email Routing refuses one in the
local part at RCPT, upstream of anything you deploy. `mailbox({ domain })`
applies this on the `normalize` phase, so an address is canonical before it is
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
italic, code). Hand `Message.html` in yourself if you have a renderer you
prefer.

## The surface

| export                                             | is                                             |
| -------------------------------------------------- | ---------------------------------------------- |
| `mailDoc`                                          | the six components, beside `@yaks/doc`'s `doc` |
| `MAIL`, `EMAIL`, `DELIVER`, …                      | their names                                    |
| `mailbox(opts)`                                    | the @yaks/graph plugin — vocab, canon, sending |
| `sending({ sender, now })`                         | the `created(mail)` handler                    |
| `message(letter, to, replyTo?)`                    | a letter composed, purely                      |
| `Sender`, `Message`, `Receipt`                     | the transport seam                             |
| `cloudflare({ account, token })`, `payload`        | Cloudflare Email Sending, and its payload      |
| `stash()`                                          | the sender that keeps them in a list           |
| `inbound(message, arrival)`, `author`, `messageId` | an arrival → bundles                           |
| `invited({ welcome, apply })`                      | the `created(member)` handler                  |
| `canon`, `local`, `at`, `parts`, `address`         | addresses                                      |
| `html`, `text`, `tokens`, `linkable`, `escape`     | the two body renderings                        |

## What is deliberately not here

**Queues and retries.** A bounced letter is data; minting a fresh one is the
retry, and it leaves a record. A queue that hides failures is the thing this
replaces.

**MIME parsing**, and **any credential of any kind**.

**A `to` on `deliver`.** Where a letter goes is one question with one answer:
the recipient entity's address, read when it leaves.

## Where it sits

A component domain over [@yaks/graph](https://jsr.io/@yaks/graph), the same
shape an application's own plugin has. It sends through
[@yaks/effects](https://jsr.io/@yaks/effects), and fills the slot
[@yaks/member](https://jsr.io/@yaks/member) leaves for it.

## Compatibility

The core — the vocabulary, `canon`, the body renderings, `inbound`, `sending` —
imports no platform API. Runs on **Deno**, **Node**, in a **Cloudflare Worker**,
and in the **browser**. The Cloudflare sender uses `fetch` and nothing else; its
structural types are checked against `@cloudflare/workers-types` in
`conform.ts`.
