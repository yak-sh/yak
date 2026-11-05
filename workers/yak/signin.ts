// A sign-in code's whole life (D-32318 §Auth), over the meta store and
// nothing else: ask for one, spend it, and find or mint the person behind the
// address. An address is where a code goes: an email address, mailed, or a US
// mobile number in E.164 form (@yaks/phone `mobile`), texted (T-136826). A
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
import { mobile } from '@yaks/phone'

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

// The property an address is kept under, on a `signin` and on a person.
let key = (address: string) => texted(canon(address)) ? 'phone' : 'email'
let line = (address: string) =>
  `.signin.${key(address)}=${JSON.stringify(canon(address))}`

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

// The whole entity goes, not just the component: a sign-in leaves nothing
// behind. `tombstone` is the bundle's word for death (T-32429), so this
// is one more bundle like every other write here.
let forget = (store: Meta, eids: string[]) =>
  eids.length
    ? apply(store, eids.map((eid) => ({ entity: { eid }, tombstone: {} })))
    : Promise.resolve(null)

// Every row ever written for an address, newest first. A row outlives the code
// it carried: dead, it is the record that the letter went out, and that record
// is what the ceiling counts.
let signins = async (store: Meta, filter: string) =>
  ((await store.query(filter))
    .filter((r) => r.signin) as unknown as Signin[])
    .sort((a, b) => Date.parse(b.signin.expires) - Date.parse(a.signin.expires))

let sent = (store: Meta, address: string) => signins(store, line(address))

// When the letter went out. `expires` is the code's death and LIFE is fixed,
// so a row carries its own send time without a second property.
let when = (r: Signin) => Date.parse(r.signin.expires) - LIFE

// The rows that still count, the rest swept: nothing else sweeps them.
let recent = async (store: Meta, all: Signin[]) => {
  let floor = Date.now() - WINDOW
  await forget(
    store,
    all.filter((r) => when(r) <= floor).map((r) => r.entity.eid),
  )
  return all.filter((r) => when(r) > floor)
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
// needs. Rows that have fallen out of the window are swept here. `from` is
// the visitor (`visitor`), kept on a texted code so `welcome` can count it.
export let mint = async (
  store: Meta,
  secret: string,
  address: string,
  from = '',
) => {
  if ((await recent(store, await sent(store, address))).length >= SENDS) {
    return null
  }
  let code = digits()
  await apply(store, [{
    entity: { eid: '$code' },
    signin: {
      [key(address)]: canon(address),
      ...(from && texted(canon(address)) ? { from } : {}),
      code: await mac(address, code, secret),
      expires: new Date(Date.now() + LIFE).toISOString(),
      tries: 0,
    },
  }])
  return code
}

// Spend a code. True for any code still open on this address — several can
// stand at once — and signing in ends the address's whole story: the codes and
// the records that counted them go together, so a person who gets in starts
// over with a full three.
//
// A guess costs a try on every open code, so five guesses is five however
// many letters are in the inbox. A row out of tries opens nothing and stays
// only as the record; burning one is what an attacker would do to buy
// another letter, and it buys nothing.
//
// The try is taken before the guess is compared, and taken in the store's own
// transaction: each count is written on the precondition that it is still the
// count this guess read (`$was`, @yaks/graph guard.ts). Read, compare, then
// write was two steps, so forty guesses sent at once all read the same count,
// all ran, and the right code still opened (T-37875). Now concurrent guesses
// queue on the count: a guess whose read went stale reads again, and the
// sixth finds nothing open.
export let spend = async (
  store: Meta,
  secret: string,
  address: string,
  code: string,
) => {
  return guess(store, address, await mac(address, code, secret))
}

/** Spend a prepared code digest, keeping concurrent guesses on guarded counts. */
export let guess = async (
  store: Meta,
  address: string,
  want: string,
  now: () => number = Date.now,
) => {
  for (;;) {
    let rows = await sent(store, address)
    let live = rows.filter((r) => open(r, now()))
    if (!live.length) return false
    try {
      await apply(
        store,
        live.map((r) => ({
          entity: { eid: r.entity.eid },
          signin: { tries: (r.signin.tries ?? 0) + 1 },
          $was: { signin: { tries: counted(r.signin.tries) } },
        })),
      )
    } catch (e) {
      if (e instanceof Stale) continue
      throw e
    }
    if (!live.some((r) => r.signin.code == want)) return false
    await forget(store, rows.map((r) => r.entity.eid))
    return true
  }
}

type Person = { entity: { eid: string }; doc?: { title?: string } }

let personAt = async (store: Meta, typed: string) => {
  let address = canon(typed)
  return (await store.query(
    texted(address)
      ? `.person&.phone.number=${JSON.stringify(address)}&?doc`
      : `.person&.email.address=${address}&?doc`,
  ))[0] as Person | undefined
}

// An address is not a name. A person minted before anyone was asked wears
// their address as `doc.title` (T-32627), so that title reads as no name at
// all: the next sign-in writes the front of the address in its place, and an
// app's store never learns an address (T-32654). Nothing has to be rewritten on deploy.
export let chose = (title?: string | null) =>
  title && !title.includes('@') ? title : null

// What to call someone: the name they chose, else the front of their address
// — `dana` from `dana@example.com`. This is the only name that leaves the
// directory.
export let nameOf = (title: string | null | undefined, email: string) =>
  chose(title) ?? canon(email).split('@')[0]

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
//
// `addressee` reads who that is and says what a batch must write to have
// them: nothing, a name, or the person minted under `$who`, so a caller can
// write them beside rows that name them (member_add's invitation), in one
// batch. `personOf` writes it alone.
export let addressee = async (
  store: Meta,
  address: string,
  name?: string,
) => {
  let at = canon(address)
  let row = await personAt(store, at)
  if (row) {
    let eid = row.entity.eid
    return {
      eid,
      fresh: false,
      write: name && !chose(row.doc?.title)
        ? [{ entity: { eid }, doc: { title: name } }]
        : [],
    }
  }
  // An eid the batch mints is a `$alias`, and the reply says what it became:
  // a bundle names an existing entity by eid, so a client cannot hand the
  // store a uuid it invented (D-23827).
  return {
    eid: '$who',
    fresh: true,
    write: [{
      entity: { eid: '$who' },
      ...(name ? { doc: { title: name } } : {}),
      person: {},
      ...texted(at) ? { phone: { number: at } } : { email: { address: at } },
    }],
  }
}

export let personOf = async (
  store: Meta,
  address: string,
  name?: string,
) => {
  let who = await addressee(store, address, name)
  if (!who.write.length) return who.eid
  let applied = await apply(store, who.write)
  if (!who.fresh) return who.eid
  let eid = minted(applied).$who
  if (!eid) throw new Error('the meta store minted no person')
  return eid
}
