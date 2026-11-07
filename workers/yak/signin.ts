// A sign-in code's whole life (D-32318 §Auth), over the meta store and
// nothing else: ask for one, spend it, and find or mint the person behind the
// address. An address is where a code goes: an email address, mailed, or a US
// mobile number in E.164 form (@yaks/phone/mobile `mobile`), texted (T-136826). A
// row and a person are keyed by whichever it is, `signin{email}` or
// `signin{phone}` and `email{address}` or `phone{number}`. Every write is a bundle through `/apply` — `{entity, ...comps}`,
// the read shape written back — under the kernel flag, because a `signin` is
// wholly server-stamped and no client may author one.
//
// What is stored is never the code. `mac` keys HMAC-SHA256 with the session
// secret over `<address>:<code>`, so a row read out of the store cannot be
// brute-forced back to the digits, and a row whose email was edited stops
// matching its own code: the address is inside the mac, not beside it.
// A code is looked up by its address and compared, so a wrong guess still
// finds the row it is guessing at and spends one of its `tries`; a lookup by
// digest would leave brute force uncounted.
//
// Asking is unauthenticated, so the ceiling is here rather than at the door
// (T-33020): `mint` is the only way a `signin` row is ever written — the
// component is wholly server-stamped and only the kernel flag opens the store
// to it — so a limit here holds for every way in, and it is this platform's
// auth policy, not something the shared graph kernel should carry. What the
// door does with a refusal is the door's: it answers exactly what an accepted
// ask answers and mails nothing, because a visible refusal would say whether
// an address had been asked for.
import type { Bundle } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { KERNEL, type Meta, minted } from './meta.ts'
import { secretKey } from '@yaks/secrets/signed'
import { mobile } from '@yaks/phone/mobile'
import { chose, nameOf } from './names.ts'
import { type Host, signupAddress } from './host.ts'
import type { Letter } from './mail.ts'

// Ten minutes, five guesses: long enough to switch to the mail app, short
// enough that a six-digit code is never worth grinding.
export let LIFE = 10 * 60_000
export let TRIES = 5

// Every guess guards one of these five counts, so prepare their wire tokens
// once rather than hashing the same small counts throughout a concurrent race.
let counts = Array.from({ length: TRIES }, (_, n) => token(n))
let counted = (tries: number | null | undefined) =>
  tries != null && Number.isInteger(tries) && tries >= 0 && tries < TRIES
    ? counts[tries]
    : token(tries)

// Three letters an hour to any one address. Signing in clears every row for
// the address, so the count only ever reaches three for someone who asked and
// never arrived — whose mail is broken, which a fourth code does not fix —
// while a loop pointed at a stranger gets three letters an hour instead of as
// many as it can ask for. The per-source ceiling is the door's, not this
// file's (identity.ts, rate.ts `SIGNIN_RATE`): the address is what an email
// bomb is aimed at, and where the asking comes from is a fact about the
// request, which `mint` never sees.
export let SENDS = 3
export let WINDOW = 60 * 60_000

// Five texted codes an hour from any one visitor. A text costs us and lands on
// a stranger's phone, and the form texts whatever number is typed into it, so
// a loop walking numbers (SMS pumping) is held per number by SENDS and per
// visitor here. The door's per-minute ceiling (rate.ts `SIGNIN_RATE`) would
// still let one visitor text thousands of numbers a day. Mail has no such
// count: a letter costs nothing that matters.
export let VISITS = 5

export type Signin = {
  entity: { eid: string }
  signin: {
    email?: string
    phone?: string
    from?: string
    code: string
    expires: string
    tries: number
    unsent?: string
  }
}

// One address, one spelling: a mail domain is case-insensitive and nobody
// means the spaces they paste, and a number is the same number however it is
// punctuated. What is neither comes back trimmed, for the door to refuse.
export let canon = (typed: string) => {
  let t = typed.trim()
  return t.includes('@') ? t.toLowerCase() : mobile(t) ?? t.toLowerCase()
}

/** Whether an address (canon's) is a US mobile number, which a code reaches
 * by text. */
export let texted = (address: string) => /^\+1\d{10}$/.test(address)

/** What giving a number on the sign-in card agrees to, said beside the box
 * (pages.ts `askEmail`) word for word as the toll-free verification was filed
 * (T-138775), Terms and Privacy after it: the code alone. Texts from the
 * Operator wait for the consent its own page or a sign-up text gives. */
export let CODE_NOTE =
  "We'll text a sign-in code to this number. Msg & data rates may apply. Reply STOP to opt out, HELP for help."

/** The text a code goes out in, word for word the sample the toll-free
 * verification was filed with (T-138775). iOS offers a texted code on the
 * card's `one-time-code` box by itself. */
export let codeText = (code: string) =>
  `yaks.app: your sign-in code is ${code}. It expires in 10 minutes. Reply STOP to opt out, HELP for help.`

// What the Operator says to someone it has not met and to someone who already
// has a space (identity.ts `met`): the one letter's only difference.
export let GREETING = {
  new: {
    hi: "Hi, I'm your Operator, the AI assistant on yaks.app.",
    reply: "Or just reply to this email, and tell me what you'd like to " +
      "make. I'll set up your space and help you get going: installing " +
      'yak, adding yaks.app to Claude or ChatGPT, and putting your first ' +
      'app live.',
  },
  back: {
    hi: "Hi, it's your Operator at yaks.app. Welcome back.",
    reply: "Or just reply to this email, and tell me what you'd like to " +
      "make or change next. I'll pick it up in your space.",
  },
}

/**
 * The letter a code goes out in, the Operator's from wherever it was asked
 * for: the code in the subject and first, then the one click that spends it
 * (link.ts), then an invitation to reply. A reply goes to the sign-up
 * address, which signs its sender up, or finds them, and hands the reply to
 * their Operator (inbox.ts `signingUp`).
 */
export let codeLetter = (
  to: string,
  code: string,
  link: string,
  met: keyof typeof GREETING = 'new',
  env: Host = {},
): Letter => ({
  to,
  subject: `${code} is your yaks.app code`,
  name: 'yaks.app Operator',
  replyTo: signupAddress(env),
  body: `${GREETING[met].hi}\n\n` +
    `Your sign-in code is ${code}.\n\n` +
    `Or sign in with one click: ${link}\n\n` +
    `${GREETING[met].reply}\n\n` +
    'The code and the link last ten minutes. If you did not ask for this, ' +
    'nothing has happened and you can ignore it.\n\n' +
    'Your Operator at yaks.app',
})

// The property an address is kept under, on a `signin` and on a person.
let key = (address: string) => texted(canon(address)) ? 'phone' : 'email'
let hex = (b: ArrayBuffer) => new Uint8Array(b).toHex()

let enc = new TextEncoder()

export let mac = async (address: string, code: string, secret: string) =>
  hex(
    await crypto.subtle.sign(
      'HMAC',
      await secretKey(secret),
      enc.encode(`${canon(address)}:${code}`),
    ),
  )

let digits = () =>
  String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000)
    .padStart(6, '0')

let apply = (store: Meta, bundles: Bundle[]) => store.apply(bundles, KERNEL)

let bury = (eid: string): Bundle => ({ entity: { eid }, tombstone: {} })

// The whole entity goes, not just the component: a sign-in leaves nothing
// behind. `tombstone` is the bundle's word for death (T-32429), so this
// is one more bundle like every other write here.
let forget = (store: Meta, eids: string[]) =>
  eids.length ? apply(store, eids.map(bury)) : Promise.resolve(null)

// Every row ever written for an address, newest first. A row outlives the code
// it carried: dead, it is the record that the letter went out, and that record
// is what the ceiling counts.
let signins = async (store: Meta, filter: string) =>
  ((await store.query(filter))
    .filter((r) => r.signin) as unknown as Signin[])
    .sort((a, b) => Date.parse(b.signin.expires) - Date.parse(a.signin.expires))

// When the letter went out. `expires` is the code's death and LIFE is fixed,
// so a row carries its own send time without a second property.
let when = (r: Signin) => Date.parse(r.signin.expires) - LIFE

// Whether a row still counts toward its hour, at `now`.
let standing = (now: number) => (r: Signin) => when(r) > now - WINDOW

// The rows that still count, the rest swept: nothing else sweeps them.
let recent = async (store: Meta, all: Signin[]) => {
  let now = Date.now()
  await forget(
    store,
    all.filter((r) => !standing(now)(r)).map((r) => r.entity.eid),
  )
  return all.filter(standing(now))
}

/** The filter line that reads every row an address's codes left. */
export let line = (address: string) =>
  `.signin.${key(address)}=${JSON.stringify(canon(address))}`

/**
 * What asking for a code writes, decided over every row the address holds
 * where they are kept (facets/signin-graph.ts), in the transaction that
 * writes the new code: the rows fallen out of the hour buried, and the new
 * row unless the address has had its SENDS letters this hour.
 *
 * ```ts
 * import { asked, LIFE } from './signin.ts'
 * import { assertEquals } from '@std/assert'
 * let row = (eid: string, sent: number) => ({
 *   entity: { eid },
 *   signin: { email: 'a@b.c', code: 'x', tries: 0,
 *     expires: new Date(sent + LIFE).toISOString() },
 * })
 * let now = Date.parse('2026-11-07T12:00:00Z')
 * let ask = { entity: { eid: 'new' }, signin: { email: 'a@b.c' } }
 * assertEquals(asked(ask, [row('old', now - 2 * 3600_000)], now), [
 *   { entity: { eid: 'old' }, tombstone: {} },
 *   ask,
 * ])
 * let full = ['a', 'b', 'c'].map((eid) => row(eid, now - 60_000))
 * assertEquals(asked(ask, full, now), [])
 * ```
 */
export let asked = (ask: Bundle, rows: Signin[], now: number): Bundle[] => {
  let stale = rows.filter((r) => !standing(now)(r)).map((r) =>
    bury(r.entity.eid)
  )
  return rows.filter(standing(now)).length >= SENDS ? stale : [...stale, ask]
}

/**
 * What a guess at an address's codes writes, decided over every row the
 * address holds, in the transaction that writes it: a try off every open
 * code, or, when the guess is one of them, every row buried. A guess costs a
 * try on every open code, so five guesses is five however many letters are
 * in the inbox; a row out of tries opens nothing and stays as the record.
 * Each count is guarded on the reading it was taken from (`$was`).
 *
 * ```ts
 * import { guessed, TRIES } from './signin.ts'
 * import { assertEquals } from '@std/assert'
 * let now = Date.parse('2026-11-07T12:00:00Z')
 * let row = (eid: string, code: string, tries = 0) => ({
 *   entity: { eid },
 *   signin: { email: 'a@b.c', code, tries,
 *     expires: new Date(now + 60_000).toISOString() },
 * })
 * assertEquals(guessed([row('a', 'right')], 'right', now), [
 *   { entity: { eid: 'a' }, tombstone: {} },
 * ])
 * let [wrong] = guessed([row('a', 'right')], 'wrong', now)
 * assertEquals(wrong.signin, { tries: 1 })
 * assertEquals(guessed([row('a', 'right', TRIES)], 'right', now), [])
 * ```
 */
export let guessed = (rows: Signin[], want: string, now: number): Bundle[] => {
  let live = rows.filter((r) => open(r, now))
  if (live.some((r) => r.signin.code == want)) {
    return rows.map((r) => bury(r.entity.eid))
  }
  return live.map((r) => ({
    entity: { eid: r.entity.eid },
    signin: { tries: (r.signin.tries ?? 0) + 1 },
    $was: { signin: { tries: counted(r.signin.tries) } },
  }))
}

/**
 * Who is asking, as a row may keep it: the address a request came from (rate.ts
 * `source`), under the session secret so a row read out of the store names no
 * one. An IPv6 address counts by its /64, which one subscriber holds whole and
 * can walk. Empty for a request from inside, which is never counted.
 */
export let visitor = async (secret: string, source: string) =>
  source
    ? hex(
      await crypto.subtle.sign(
        'HMAC',
        await secretKey(secret),
        enc.encode(`visitor:${network(source)}`),
      ),
    )
    : ''

// An IPv6 address's first four groups, written out; an IPv4 address as it is.
let network = (ip: string) => {
  if (!ip.includes(':')) return ip
  let [head, tail = ''] = ip.toLowerCase().split('::')
  let front = head ? head.split(':') : []
  let back = ip.includes('::') && tail ? tail.split(':') : []
  let groups = [
    ...front,
    ...Array(8 - front.length - back.length).fill('0'),
    ...back,
  ]
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')
}

/** Whether this visitor may have another code texted this hour (VISITS). */
export let mayText = async (store: Meta, from: string) =>
  !from ||
  (await recent(
      store,
      await signins(store, `.signin.from=${JSON.stringify(from)}`),
    )).length < VISITS

// A code still worth typing: not expired, and not already out of guesses.
let open = (r: Signin, now: number) =>
  Date.parse(r.signin.expires) > now && (r.signin.tries ?? 0) < TRIES

// Mint a code for an address and return it for the mail or text seam to
// carry, or null when this address has had its letters for the hour: nothing
// minted, nothing to send. Codes already standing are left standing: the
// store keeps a mac and not the digits, so a second ask cannot re-send the
// first letter's code, and letting the first one live is what a slow letter
// needs. `from` is the visitor (`visitor`), kept on a texted code so
// `mayText` can count it.
//
// One trip: the store reads the address's rows and decides in the write's
// own transaction (`asked`), so asks sent at once cannot all pass the
// ceiling, and the answer says whether the row was written.
export let mint = async (
  store: Meta,
  secret: string,
  address: string,
  from = '',
) => {
  let ask = drawn()
  return await lodge(store, secret, address, ask, from) ? ask.code : null
}

/** A code about to be asked for: its digits and when it dies, drawn before
 * the write that keeps it, so the card saying it was sent can name it
 * (`sealed`). */
export type Ask = { code: string; expires: string }

export let drawn = (now = Date.now()): Ask => ({
  code: digits(),
  expires: new Date(now + LIFE).toISOString(),
})

/** Lodge an ask (`mint`): the row's eid, or null when the address has had its
 * letters for the hour and nothing was written. */
export let lodge = async (
  store: Meta,
  secret: string,
  address: string,
  ask: Ask,
  from = '',
): Promise<string | null> => {
  let applied = await apply(store, [{
    entity: { eid: '$code' },
    signin: {
      [key(address)]: canon(address),
      ...(from && texted(canon(address)) ? { from } : {}),
      code: await mac(address, ask.code, secret),
      expires: ask.expires,
      tries: 0,
    },
  }])
  return minted(applied).$code ?? null
}

/**
 * A code whose letter or text never left, said on its row (M-16612): why, as
 * its sender said it, for the person's next card to say (`unsentAt`). Only
 * on the row still standing as it was kept: one a sign-in buried meanwhile
 * stays buried (`$was`), and nothing is left to say.
 */
export let unsent = async (
  store: Meta,
  eid: string,
  ask: Ask,
  why: string,
) => {
  try {
    await apply(store, [{
      entity: { eid },
      signin: { unsent: why.slice(0, 300) },
      $was: { signin: { expires: token(ask.expires) } },
    }])
  } catch (e) {
    if (!(e instanceof Stale)) throw e
  }
}

// What a card's seal is a mac of: the code it names, by when it dies. A
// six-digit code is never this.
let named = (expires: string) => `sent ${expires}`

/** What a code's card carries to name the code it said was sent, so the next
 * card that browser asks for can say what became of its letter
 * (`unsentAt`), and nobody else can ask: a seal is the session secret's mac
 * of the address and the code's expiry. */
export let sealed = async (secret: string, address: string, ask: Ask) =>
  `${ask.expires} ${await mac(address, named(ask.expires), secret)}`

/** Why the letter a card's seal names never left, or null: when it went,
 * when it is still going, when the address had had its letters and nothing
 * was kept, and for a seal that is not ours. */
export let unsentAt = async (
  store: Meta,
  secret: string,
  address: string,
  seal: string,
) => {
  let [expires, sum] = seal.split(' ')
  if (!expires || sum != await mac(address, named(expires), secret)) {
    return null
  }
  let rows = await signins(store, line(address))
  return rows.find((r) => r.signin.expires == expires)?.signin.unsent ?? null
}

// Spend a code: the person it signs in for any code still open on this
// address — several can stand at once — else null. Signing in ends the
// address's whole story: the codes and the records that counted them go
// together, in the write that took the guess, so a person who gets in starts
// over with a full three.
//
// The try is taken before the guess is compared, in the store's own
// transaction, and each count on the precondition that it is still the count
// it was read at (`$was`, @yaks/graph guard.ts). Read, compare, then write
// was two steps, so forty guesses sent at once all read the same count, all
// ran, and the right code still opened (T-37875). Now the read and the write
// are one transaction, and a guess whose count moved is asked again.
export let spend = async (
  store: Meta,
  secret: string,
  address: string,
  code: string,
  opts: Arrival = {},
) => guess(store, address, await mac(address, code, secret), opts)

/** How a guess arrives: `newcomer` is who this browser is signed in as, taken
 * when they are a newcomer and nobody holds the address yet, and `via` is how
 * the code came, a code typed or a letter's link followed (link.ts). */
export type Arrival = { newcomer?: string; via?: Via }

export type Via = 'code' | 'link'

/** Who a code signed in, and whether it is the first time they ever got in,
 * which is the funnel's sign-up (funnel.ts). */
export type Arrived = { person: string; first: boolean }

/** Spend a prepared code digest: one trip, which the store answers with the
 * address's rows buried when it opened (`guessed`), and the person signing
 * in, found or minted (`arriving`) and stamped as signed in (`stamped`), at
 * `$who`; or null when the code did not open. */
export let guess = async (
  store: Meta,
  address: string,
  want: string,
  { newcomer, via = 'code' }: Arrival = {},
): Promise<Arrived | null> => {
  for (;;) {
    try {
      let applied = await apply(store, [{
        entity: { eid: '$who' },
        $guess: {
          [key(address)]: canon(address),
          code: want,
          via,
          ...(newcomer ? { newcomer } : {}),
        },
      }])
      let who = applied.find((b) => b.$alias == '$who')
      if (!who) return null
      let signed = who.signed_in as Person['signed_in']
      return { person: who.entity.eid, first: !!signed?.first }
    } catch (e) {
      if (e instanceof Stale) continue
      throw e
    }
  }
}

export type Person = {
  entity: { eid: string }
  doc?: { title?: string }
  signed_in?: { at?: string; via?: Via; first?: string }
}

/**
 * A person's sign-in stamp at `at`, given the one they wore: when and how
 * they got in, and, the first time, `first` beside it. A stamp merges onto
 * the one it follows, so `first` stays the first sign-in's, and a stamp that
 * writes it is how the write that signs somebody in says it was their first.
 *
 * ```ts
 * import { stamped } from './signin.ts'
 * import { assertEquals } from '@std/assert'
 * let at = '2026-11-07T12:00:00.000Z'
 * assertEquals(stamped(undefined, at, 'code'), { at, via: 'code', first: at })
 * assertEquals(stamped({ at: '2026-01-01' }, at, 'link'), { at, via: 'link' })
 * ```
 */
export let stamped = (
  before: Person['signed_in'],
  at: string,
  via: Via,
): NonNullable<Person['signed_in']> =>
  before ? { at, via } : { at, via, first: at }

/** The filter line that reads the person wearing an address, what they are
 * called, and when they last got in. */
export let personLine = (typed: string) => {
  let address = canon(typed)
  return texted(address)
    ? `.person&.phone.number=${JSON.stringify(address)}&?doc&?signed_in`
    : `.person&.email.address=${address}&?doc&?signed_in`
}

let personAt = async (store: Meta, typed: string) =>
  (await store.query(personLine(typed)))[0] as Person | undefined

// What a person signing in is first called: the front of their address, and
// nothing for a number, which is no name; their space page asks.
export let called = (address: string) =>
  texted(address) ? undefined : nameOf(null, address)

// Whether anyone has ever named this address, which is what the code card
// asks about when it asks (identity.ts).
export let nameAt = async (store: Meta, email: string) =>
  chose((await personAt(store, email))?.doc?.title)

// The person behind an address, minted on first sight. `email` is a facet any
// entity may wear (the mail plugin's address book), so a person is `person` +
// `email` (or `phone`, for a number) + a `doc` titled with what to call them,
// once someone says.
//
// `name` is that: what an invitation called them (tools.ts member_add), or
// the front of their address when they sign in (identity.ts, T-34236). It is
// written only where there is no name yet — an invitation never renames
// someone who has one — and a person nobody has named keeps no title until
// their first sign-in. They change it under Settings (apps.ts `saved`).

/**
 * Who arrives at an address, as the one bundle that has them: the person
 * `found` wearing it, named `name` if nobody has; else the person at `eid`
 * minted wearing it. A bundle naming nothing but its eid writes nothing.
 * A sign-in decides it inside the guess that opens (facets/signin-graph.ts),
 * with `eid` the newcomer whose browser asked (newcomer.ts), so they stay who
 * they were, and their space, its chat and everything else said to be theirs
 * stays so.
 *
 * ```ts
 * import { arriving } from './signin.ts'
 * import { assertEquals } from '@std/assert'
 * let dana = { entity: { eid: 'p1' }, doc: { title: 'Dana' } }
 * assertEquals(arriving('dana@b.c', 'dana', dana), { entity: { eid: 'p1' } })
 * assertEquals(arriving('Dana@b.c', 'dana', undefined, 'p2'), {
 *   entity: { eid: 'p2' },
 *   doc: { title: 'dana' },
 *   person: {},
 *   email: { address: 'dana@b.c' },
 * })
 * ```
 */
export let arriving = (
  address: string,
  name?: string,
  found?: Person,
  eid = '$who',
): Bundle => {
  if (found) {
    return {
      entity: { eid: found.entity.eid },
      ...name && !chose(found.doc?.title) ? { doc: { title: name } } : {},
    }
  }
  let at = canon(address)
  return {
    entity: { eid },
    ...name ? { doc: { title: name } } : {},
    person: {},
    ...texted(at) ? { phone: { number: at } } : { email: { address: at } },
  }
}

// Whether a bundle writes anything beside naming its entity.
let writes = (b: Bundle) => Object.keys(b).some((k) => k != 'entity')

// `addressee` reads who that is and says what a batch must write to have
// them: nothing, a name, or the person minted under `$who`, so a caller can
// write them beside rows that name them (member_add's invitation), in one
// batch. `personOf` writes it alone. An eid the batch mints is a `$alias`, and
// the reply says what it became: a bundle names an existing entity by eid, so
// a client cannot hand the store a uuid it invented (D-23827).
export let addressee = async (
  store: Meta,
  address: string,
  name?: string,
) => {
  let found = await personAt(store, address)
  let who = arriving(address, name, found)
  return {
    eid: who.entity.eid,
    fresh: !found,
    write: writes(who) ? [who] : [],
  }
}

export let personOf = async (store: Meta, address: string, name?: string) => {
  let who = await addressee(store, address, name)
  if (!who.write.length) return who.eid
  let applied = await apply(store, who.write)
  if (!who.fresh) return who.eid
  let eid = minted(applied).$who
  if (!eid) throw new Error('the meta store minted no person')
  return eid
}
