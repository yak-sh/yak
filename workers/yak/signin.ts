// A sign-in code's whole life (D-32318 §Auth), over the meta store and
// nothing else: ask for one, spend it, and find or mint the person behind the
// address. Every write is a bundle through `/apply` — `{entity, ...comps}`,
// the read shape written back — under the kernel flag, because a `signin` is
// wholly server-stamped and no client may author one.
//
// What is stored is never the code. `mac` keys HMAC-SHA256 with the session
// secret over `<email>:<code>`, so a row read out of the store cannot be
// brute-forced back to the digits, and a row whose email was edited stops
// matching its own code — the address is inside the mac, not beside it.
// A code is looked up by its ADDRESS and compared, so a wrong guess still
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
import type { Door } from './store.ts'

// Ten minutes, five guesses: long enough to switch to the mail app, short
// enough that a six-digit code is never worth grinding.
export let LIFE = 10 * 60_000
export let TRIES = 5

// Three letters an hour to any one address. Signing in clears every row for
// the address, so the count only ever reaches three for someone who asked and
// never arrived — whose mail is broken, which a fourth code does not fix —
// while a loop pointed at a stranger gets three letters an hour instead of as
// many as it can ask for. A per-SOURCE ceiling is deliberately not here: the
// address is what an email bomb is aimed at, and an IP is both meaningless
// behind a shared egress and the zone's rate-limiting rules to bound, not this
// worker's.
export let SENDS = 3
export let WINDOW = 60 * 60_000

export type Signin = {
  entity: { eid: string }
  signin: { email: string; code: string; expires: string; tries: number }
}

// One address, one spelling: a mail domain is case-insensitive and nobody
// means the spaces they paste.
export let canon = (email: string) => email.trim().toLowerCase()

let hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((n) => n.toString(16).padStart(2, '0')).join('')

export let mac = async (email: string, code: string, secret: string) =>
  hex(
    await crypto.subtle.sign(
      'HMAC',
      await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      ),
      new TextEncoder().encode(`${canon(email)}:${code}`),
    ),
  )

let digits = () =>
  String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000)
    .padStart(6, '0')

let apply = async (store: Door, body: unknown) => {
  let r = await store('/apply', {
    method: 'POST',
    body: JSON.stringify(body),
  }, { 'x-yak-kernel': '1' })
  if (!r.ok) throw new Error(`meta store refused: ${await r.text()}`)
  return r.json()
}

let ask = async (store: Door, q: string) => {
  let r = await store(`/query?${q}`)
  if (!r.ok) throw new Error(`meta store: ${await r.text()}`)
  return r.json() as Promise<Record<string, unknown>[]>
}

// The whole entity goes, not just the component: a sign-in leaves nothing
// behind. `tombstone` is the bundle's spelling of death (T-32429), so this
// is one more bundle like every other write here.
let forget = (store: Door, eids: string[]) =>
  eids.length
    ? apply(store, {
      entities: eids.map((eid) => ({ entity: { eid }, tombstone: {} })),
    })
    : Promise.resolve(null)

// Every row ever written for an address, newest first. A row outlives the code
// it carried: dead, it is the record that the letter went out, and that record
// is what the ceiling counts.
let sent = async (store: Door, email: string) =>
  ((await ask(store, `.signin.email=${encodeURIComponent(canon(email))}`))
    .filter((r) => r.signin) as unknown as Signin[])
    .sort((a, b) => b.signin.expires.localeCompare(a.signin.expires))

// When the letter went out. `expires` is the code's death and LIFE is fixed,
// so a row carries its own send time without a second column.
let at = (r: Signin) => Date.parse(r.signin.expires) - LIFE

// A code still worth typing: not expired, and not already out of guesses.
let open = (r: Signin) =>
  Date.parse(r.signin.expires) > Date.now() && (r.signin.tries ?? 0) < TRIES

// Mint a code for an address and return it for the mail seam to carry, or null
// when this address has had its letters for the hour — nothing minted, nothing
// to mail. Codes already standing are left standing: the store keeps a mac and
// not the digits, so a second ask cannot re-send the first letter's code, and
// letting the first one live is what a slow letter needs. Rows that have
// fallen out of the window are swept here; nothing else sweeps them.
export let mint = async (store: Door, secret: string, email: string) => {
  let rows = await sent(store, email)
  let floor = Date.now() - WINDOW
  await forget(
    store,
    rows.filter((r) => at(r) <= floor).map((r) => r.entity.eid),
  )
  if (rows.filter((r) => at(r) > floor).length >= SENDS) return null
  let code = digits()
  await apply(store, {
    entities: [{
      signin: {
        email: canon(email),
        code: await mac(email, code, secret),
        expires: new Date(Date.now() + LIFE).toISOString(),
        tries: 0,
      },
    }],
  })
  return code
}

// Spend a code. True for any code still open on this address — several can
// stand at once — and signing in ends the address's whole story: the codes and
// the records that counted them go together, so a person who gets in starts
// over with a full three.
//
// A wrong guess costs a try on EVERY open code, so five guesses is five
// however many letters are in the inbox. A row out of tries opens nothing and
// stays only as the record; burning one is what an attacker would do to buy
// another letter, and it buys nothing.
export let spend = async (
  store: Door,
  secret: string,
  email: string,
  code: string,
) => {
  let rows = await sent(store, email)
  let live = rows.filter(open)
  if (!live.length) return false
  let want = await mac(email, code, secret)
  if (live.some((r) => r.signin.code == want)) {
    await forget(store, rows.map((r) => r.entity.eid))
    return true
  }
  await apply(store, {
    entities: live.map((r) => ({
      entity: { eid: r.entity.eid },
      signin: { tries: (r.signin.tries ?? 0) + 1 },
    })),
  })
  return false
}

type Person = { entity: { eid: string }; doc?: { title?: string } }

let personAt = async (store: Door, email: string) =>
  (await ask(
    store,
    `.person!&.email.address=${encodeURIComponent(canon(email))}&.doc?`,
  ))[0] as Person | undefined

// An address is not a name. A person minted before anyone was asked wears
// their address as `doc.title` (T-32627), so that title reads as no name at
// all: the next sign-in asks for one, and an app's store never learns an
// address (T-32654). Nothing has to be rewritten on deploy.
export let chose = (title?: string | null) =>
  title && !title.includes('@') ? title : null

// What to call someone: the name they chose, else the front of their address
// — `dana` from `dana@example.com`. This is the ONLY name that leaves the
// directory.
export let nameOf = (title: string | null | undefined, email: string) =>
  chose(title) ?? canon(email).split('@')[0]

// Whether anyone has ever named this address, which is what the code card
// asks about when it asks (identity.ts).
export let nameAt = async (store: Door, email: string) =>
  chose((await personAt(store, email))?.doc?.title)

// The person behind an address, minted on first sight. `email` is a facet any
// entity may wear (the mail plugin's address book), so a person is `person` +
// `email` + a `doc` titled with what to call them, once someone says.
//
// `name` is that: what they typed at the sign-in card, or what an invitation
// called them (tools.ts member_add). It is written only where there is no
// name yet — an invitation never renames someone who has named themselves —
// and a person nobody has named keeps no title at all, so the next sign-in
// knows to ask.
export let personOf = async (store: Door, email: string, name?: string) => {
  let at = canon(email)
  let row = await personAt(store, at)
  if (row) {
    if (name && !chose(row.doc?.title)) {
      await apply(store, {
        entities: [{ entity: { eid: row.entity.eid }, doc: { title: name } }],
      })
    }
    return row.entity.eid
  }
  // An eid the batch mints is a `$alias`, and the reply says what it became:
  // a bundle names an EXISTING entity by eid, so a client cannot hand the
  // store a uuid it invented (D-23827).
  let out = await apply(store, {
    entities: [{
      entity: { eid: '$who' },
      ...(name ? { doc: { title: name } } : {}),
      person: {},
      email: { address: at },
    }],
  }) as { aliases?: Record<string, string> }
  let eid = out.aliases?.$who
  if (!eid) throw new Error('the meta store minted no person')
  return eid
}
