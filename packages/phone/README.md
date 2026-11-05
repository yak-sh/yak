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
- `text{from, to, at, message_id, rcs}` is one text message, its words in
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
type Sender = { send: (text: Text) => Promise<Receipt> }
```

These are @yaks/host's portable `Texter`, so a host can lend one. A sender
resolves with the provider's id for the message, and the number it left from
when it chose one, or rejects:

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

`telnyx({ key, profile, tollFree?, api?, fetch? })` sends through Telnyx's
messaging API. A text with no `from` goes from the number on the messaging
profile named `profile`, its toll-free number when `tollFree` is set (a
toll-free verification lets that number text before a 10DLC campaign is
approved). A text with an `agent` goes as RCS from that agent, falling back to
SMS from `from` on a phone without RCS. `TELNYX` holds Telnyx as data: its API
and the error codes that mean a carrier blocked a text (40010, not 10DLC
registered; 40300, the person replied STOP).

`voipms({ user, key, number?, api?, fetch? })` sends from a voip.ms account,
signed in with its email and API password: from `number`, or the account's first
number with SMS on. A text of up to 160 characters goes by `sendSMS`, a longer
one up to 2048 by `sendMMS`. It also answers `lines()`, the account's numbers,
and `point(number, url)`, which turns on the number's SMS URL callback to `url`
and says every other way its texts reach the owner (email, forwarding, a SIP
account) again as the account has it, since `setSMS` sets them all at once.
`VOIPMS` holds voip.ms as data: its API, its lengths, the statuses that mean
`Blocked` (`limit_reached`: 100 API texts a day unless support raises it) and
`Denied`, and the query its callback fills in. voip.ms answers only the
addresses its API page allowlists; a caller whose address changes, a Worker,
needs `0.0.0.0` there, which lets any address call with the API password.

`stash()` keeps texts in `sent` with `last()`, and answers receipts `stash-1`,
`stash-2`, …; `stash({ block })` and `stash({ refuse })` reject every text.

`sending({ sender })` is the `text_post` effect's handler: after the write
commits, it claims `deliver.tried`, hands the text over once, and writes the
outcome back. Nobody is texted before they agree: a text to someone with no
`sms_consent` is bounced, never handed over, and reports nothing. The
`./effects` facet builds it from the config's `sender`: the texter the host
lends under that name (`host.texters`), else one built from the config.

## Receiving

Telnyx signs every webhook with Ed25519; @yaks/hook's `'telnyx'` scheme checks
it, and nothing here reads a request it has not checked. `heard(event)` reads a
Telnyx event: `{ arrival }` for a text that arrived (SMS, MMS or RCS; a tapped
RCS suggestion reads as its label), `{ outcome }` for what became of a text that
left, or nothing. `keyword(text)` says whether a text is STOP, HELP or START in
any of the words carriers require. `kept(arrival, people)` answers the bundles
that keep a text that arrived from everyone with its number: the text, kept as
the record of what they said, with the end of their consent when it says STOP
and their consent again, in the words they sent, when it says START.

voip.ms's SMS URL callback is a GET nobody signs, so the URL a host gives it
carries the host's own secret, and nothing here reads one. `called(query)` reads
the query `VOIPMS.callback` asks for as an arrival, from the moment the callback
came: its `{TIMESTAMP}` names no time zone.

The `./routes` facet is the door on a box: `POST /telnyx/webhook`, reached from
outside through the box's Cloudflare tunnel. A missing or stale signature is
refused with a 400 and reported to nobody; a complete one that does not match,
which is what a wrong key looks like, is refused and reported.

```json
{
  "use": "@yaks/phone",
  "with": {
    "sender": {
      "via": "telnyx",
      "key": { "secret": "TELNYX_API_KEY" },
      "profile": "yaks.app"
    },
    "door": { "key": "RA8+wmOD4ivICcJNznDMWuA8DoM+StbPtYr0srTKaKI=" }
  }
}
```

A box texts from a voip.ms number with
`"sender": { "via": "voipms", "user":
"you@example.com", "key": { "secret": "VOIPMS_API_PASSWORD" } }`,
and `number` to choose one; it has no door for voip.ms's callback.

yaks.app uses the same parts without the facets: its Worker routes
`/telnyx/webhook`, holds the key as a Worker secret, and hands a text from a
person who agreed to their space's Operator as a request (workers/yak,
operator-texts.ts). A person's own voip.ms number is their connection, and their
Operator texts from it for them (operator-line.ts).

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
