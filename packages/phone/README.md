# @yaks/phone

Phone numbers and texts in the graph. A person's mobile number is a component on
the person, beside the `email{address}` they wear; the words they agreed to
before anyone texts them are kept on an entity of their own; and a text, sent or
received, is an entity whose outcome is written back onto it. Sending goes
through a transport the caller supplies: Telnyx or voip.ms over HTTP, or a stash
that keeps texts in memory.

## Stored data

- `phone{number}` is a number in E.164 form (`+12695550142`) on the entity it
  reaches. On a person it is their mobile.
- `sms_consent{person, consent, at, space}` records that `person` agreed to be
  texted at their `phone{number}`, in the words `consent` exactly as they were
  shown, at `at`, by the Operator of `space` when one is named. Its eid is
  derived from `person` (`consentEid`), so a person has one consent; stopping
  texts removes it and leaves the number.
- `text{from, to, at, message_id, rcs, via}` is one text message, its words in
  @yaks/doc's `doc{body}`. A text that arrived carries the number it came from,
  the number or RCS agent it reached, and the provider's id. A text that also
  carries @yaks/mail's `deliver{to}` asks to be sent to the `phone{number}` of
  `deliver.to`; its outcome is `delivered{at}` or `bounced{at, reason}`, the
  words a letter's outcome uses, so a host loads @yaks/mail's vocabulary beside
  this one.

## Sending

```ts
type Text = { to: string; text: string; from?: string; agent?: string }
type Receipt = { id?: string; from?: string }
type Sender = {
  send: (text: Text) => Promise<Receipt>
  from?: () => Promise<string>
}
```

These are @yaks/host's portable `Texter`, so a host can lend one. `from`, where
the provider can say it, answers the number texts go from when a text names
none, which is the number people text to reach the sender. A sender resolves
with the provider's id for the message, and the number it left from when it
chose one, or rejects:

- `Blocked`: a carrier will not carry it, and that is expected: the number is
  not yet registered for business texting, or the person replied STOP. Its
  message is a sentence a person can read. A blocked text is bounced and reports
  nothing.
- `Unsent` (@yaks/host/senders): the text never left (no connection, a 429, a
  5xx), so it is tried again.
- `Denied`: the provider refused the credentials (a wrong key, or an address its
  allowlist does not name). Its message says how the account's owner mends it;
  it is bounced and reported like any other error, and a host that holds the
  credential as a connection marks the connection broken.
- any other error: the text is bounced and the error thrown to the host's
  reporter.

This package names no provider. Provider adapters live in
[@yaks/telnyx](../telnyx/README.md), [@yaks/voipms](../voipms/README.md) and
[@yaks/pinnacle](../pinnacle/README.md). Each exports `provider`, its `Provider`
given as data: `sender(options)` returns this package's `Sender`; verified
webhook providers also supply `scheme` for @yaks/hook and `heard(event)` for
normalized events. `sender(options, provider)` attaches the selected transport
to receipts. Provider HTTP fields never become graph components.

Each provider package is also a plugin a config names, built from
`@yaks/phone/plugin`: `texters(via, provider)` is its graph facet, lending the
host a phone under its name (`host.texters`), and `routes(via, provider)` its
routes facet, the webhook door. `lent(via, provider, options)` is that `Phone`:
a texter built from its options at every text, and `waiting()` until they carry
what the provider `needs`. Beside sending it offers what a host that is no graph
asks of the provider: `transport()`, its options now; `from()`, the number it
texts from; `over(more)`, the same phone with more settings laid on its options,
such as a number of its own; `hear(request)`, its webhook verified with its
door's key; for a provider that takes calls, `caller()` and `line`; and, for one
a person connects a number of their own through, `own`.

A provider's `own` (`Own`) says how: the field of the person's connection each
setting is read from (`fields`), their `Account` opened with those settings
alone (a `Sender` with `lines()`, the numbers it holds as `Held`, and
`point(number, url)`, which sends a number's texts to a URL), the query its
callback fills in (`callback`), what a callback said (`called(query)`), and the
words a person is told when their settings open nothing or none of the numbers
texts (`said`).

`stash()` keeps texts in `sent` with `last()`, and answers receipts `stash-1`,
`stash-2`, …; `stash({ block })` and `stash({ refuse })` reject every text.

`sending({ sender })` is the `text_post` effect's handler: after the write
commits, it claims `deliver.tried`, hands the text over once, and writes the
outcome back. Nobody is texted before they agree: a text to someone with no
`sms_consent` is bounced, never handed over, and reports nothing. The
`./effects` facet sends through the texter lent under the config's `sender.via`
(`host.texters`), by the host or a provider plugin, or keeps texts in memory for
`stash`. A text waits, with the reason on `deliver.waiting`, while nothing lends
that name or the texter is `waiting()`.

`@yaks/phone/tools` is the tool `text_send`: it texts a person here who wears a
`phone{number}` and an `sms_consent`, named by id or by that number, by writing
a text that asks to go, and refuses anyone else. The texter the config names
sends it, from its own number. A reply arrives as a `text` from their number,
and @yaks/session's `session_texted` knocks the session that texted them.

## Receiving

`keyword(text)` recognizes STOP, HELP and START. `kept(arrival, people)` records
the message and updates consent using the same shapes for every provider.
`settled(outcome, sent)` records a failed delivery. An opaque `text.message_id`
is scoped by `text.via`, so different providers cannot settle each other's
texts. `arrivalEid(id, via)` derives a text's identity from both.

A provider plugin's door verifies its webhook before decoding it. Compose the
provider plugin beside @yaks/phone and pass it its credentials and door:

```json
[
  {
    "use": "@yaks/pinnacle",
    "with": {
      "key": { "secret": "PINNACLE_API_KEY" },
      "number": "+12695550100",
      "door": { "key": { "secret": "PINNACLE_SIGNING_SECRET" } }
    }
  },
  { "use": "@yaks/phone", "with": { "sender": { "via": "pinnacle" } } }
]
```

The webhook path defaults to `/<via>/webhook`; `door.path` chooses another. A
provider that signs nothing and calls a URL instead (its `own.called`, as
voip.ms does) is answered at `GET /<via>/<door.key>?<own.callback>`: the key in
the path is what says the call is the provider's, and the host points the
number's callback there. Telnyx uses a base64 public key and Ed25519. Pinnacle
authenticates its `PINNACLE-SIGNING-SECRET` header against the configured
webhook secret; it does not sign the body. voip.ms callbacks use a
host-authenticated URL.

On yaks.app, the kernel's config names each provider plugin with its credentials
(workers/yak/config.ts `phoneConfig`), and `PHONE_SENDER` selects the platform's
phone by name. A directory space's `sender{via}` beside `phone{number}`
overrides it. The provider's credentials stay with the host, and apps keep
`phone{number}` for their own registered line. Text rows, conversation links,
delivery outcomes and opt-outs have the same shape for every provider.

## Numbers

A provider that sells numbers adds `numbers(options)` beside its sender, and the
`Phone` its plugin lends offers it as `numbers()`, on the account and profile
the phone texts through. `Numbers` is:

- `find(search)`: what is on offer (`tollFree`, `area`, `contains`, an exact
  `number` to quote it, `limit`), each
  `Offer{number, upfront, monthly,
  currency, sms, voice}`.
- `buy(number)`: a number on offer onto the account, its texts on the phone's
  profile; `Bought{number, order, status}`, `pending` until it is held.
- `release(number)`: a held number given back.
- `verify(form)`: files a `TollFree` verification, the carriers' own fields (the
  business, its kind and registration, a contact, the use case, a sample, the
  volume and how people opt in), and `verification(id)` reads one:
  `Verification{id, number, status, said, reason}`, where `status` is `pending`,
  `needed` (waiting on the sender), `verified` or `rejected` and `said` is the
  provider's word.

`shelf(offers)` keeps numbers in memory: bought ones in `held`, and filed
verifications in `filed`, pending until a test changes one.

## Calls

A provider that takes calls adds `caller(options)` and `line` beside its sender,
and its `heard(event)` also answers `ring{id, from, to, at}` when a call comes
in and `ended{id}` when one hangs up, so the webhook that brings texts brings
calls too.

- `Caller` is `answer(id, stream)`, which picks up and streams the call's audio
  both ways over the WebSocket at `stream`, `reject(id)` and `hangup(id)`.
- `Line` is the stream's wire format: its `format` (μ-law at 8 kHz), `perMinute`
  for an answered minute, `frame(data)` reading a frame as `start{call}`,
  `audio`, `stop` or `played`, and the frames `play(audio)`, `clear()` and
  `mark(name)` that a host sends back.

What a call says and hears is the host's: yaks.app's Operator hears it and
speaks through @yaks/speech (workers/yak/operator-calls.ts).

## Example

```ts
import { consentEid, mobile, phoneDoc } from '@yaks/phone'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail'
import { equal } from '@yaks/testing'

const vocab = loadVocab([docDoc, mailDoc, phoneDoc])
const g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  { entity: { eid: 'ana' }, phone: { number: mobile('269-555-0142')! } },
  {
    entity: { eid: consentEid('ana') },
    sms_consent: {
      person: 'ana',
      consent: 'Text me.',
      at: '2026-11-04T00:00:00Z',
    },
  },
])
equal((await g.get(['ana']))[0]?.phone, { number: '+12695550142' })
equal((await g.read('.sms_consent.person=ana')).length, 1)
```
