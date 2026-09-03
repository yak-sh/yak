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
import type { Door } from './store.ts'

// Ten minutes, five guesses: long enough to switch to the mail app, short
// enough that a six-digit code is never worth grinding.
export let LIFE = 10 * 60_000
export let TRIES = 5

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

// The whole entity goes, not just the component: a spent code leaves nothing
// behind. `tombstone` is the bundle's spelling of death (T-32429), so this
// is one more bundle like every other write here.
let forget = (store: Door, eids: string[]) =>
  eids.length
    ? apply(store, {
      entities: eids.map((eid) => ({ entity: { eid }, tombstone: {} })),
    })
    : Promise.resolve(null)

// Every code standing for an address, newest first: `mint` clears the old
// ones, so this is normally one row, and two racing asks still put the code
// that was mailed last at the front.
let pending = async (store: Door, email: string) =>
  ((await ask(store, `.signin.email=${encodeURIComponent(canon(email))}`))
    .filter((r) => r.signin) as unknown as Signin[])
    .sort((a, b) => b.signin.expires.localeCompare(a.signin.expires))

// Mint a code for an address and return it for the mail seam to carry. Any
// code already standing for that address dies here, so a person always has
// exactly one live code and the newest mail is the one that works.
export let mint = async (store: Door, secret: string, email: string) => {
  let code = digits()
  await forget(store, (await pending(store, email)).map((r) => r.entity.eid))
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

// Spend a code. True only for the live code that belongs to this address,
// and it is gone either way it ends: spent on success, spent on the last
// guess. A wrong guess costs a try and leaves the rest.
export let spend = async (
  store: Door,
  secret: string,
  email: string,
  code: string,
) => {
  let [row] = await pending(store, email)
  if (!row) return false
  let dead = Date.parse(row.signin.expires) <= Date.now()
  let right = row.signin.code == await mac(email, code, secret)
  if (dead || right || (row.signin.tries ?? 0) + 1 >= TRIES) {
    await forget(store, [row.entity.eid])
    return right && !dead
  }
  await apply(store, {
    entities: [{
      entity: { eid: row.entity.eid },
      signin: { tries: (row.signin.tries ?? 0) + 1 },
    }],
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
