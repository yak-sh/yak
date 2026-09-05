/// <reference lib="deno.ns" />
// An app's mailbox, end to end (T-33686): the address derivation both ways,
// and a letter written into a real Store over the workerd stand-in, sent
// through a fake Email Sending binding.
//
// Nothing is stubbed between the batch and the send but the binding itself:
// the vocabulary is loaded, the tables are planted, @yaks/graph's apply()
// runs the guard and the effects, and what the transport was handed is what
// @yaks/mail composed out of the rows.
import { assert, assertEquals } from '@std/assert'
import type { Frame } from '@yaks/api'
import type { Bundle } from '@yaks/graph'
import type { Wire } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/harness.ts'
import { Store } from './graph.ts'
import { mailedTo, mailFrom, posting } from './post.ts'

Deno.test('an app writes from a local part at the apex', () => {
  assertEquals(mailFrom('ada', 'cookbook'), 'ada.cookbook@yaks.app')
  assertEquals(mailFrom('ada', null), 'ada@yaks.app')
})

Deno.test('the same derivation reads an arrival back', () => {
  assertEquals(mailedTo('ada.cookbook@yaks.app'), {
    space: 'ada',
    app: 'cookbook',
  })
  assertEquals(mailedTo('Ada@Yaks.App'), { space: 'ada', app: null })
  // Not ours, not a name, not one dot: three ways to be nobody here.
  assertEquals(mailedTo('ana@example.com'), null)
  // A space's own hostname is not a mail domain and cannot become one
  // (C-33769), so an address there is nobody's rather than that space's.
  assertEquals(mailedTo('cookbook@ada.yaks.app'), null)
  assertEquals(mailedTo('a.b.c@yaks.app'), null)
  assertEquals(mailedTo('ada.@yaks.app'), null)
  assertEquals(mailedTo('Ada_Lovelace@yaks.app'), null)
})

Deno.test('every address an app writes from is one it can be written to', () => {
  for (let [space, app] of [['ada', 'cookbook'], ['ada', null]] as const) {
    assertEquals(mailedTo(mailFrom(space, app)), { space, app })
  }
})

// The binding, faked: what it was handed, and a refusal on demand — the
// provider failure a letter has to come to rest on rather than disappear into.
let outbox = (refuse?: string) => {
  let sent: Record<string, unknown>[] = []
  return {
    sent,
    send: (l: Record<string, unknown>) => {
      if (refuse) return Promise.reject(new Error(refuse))
      sent.push(l)
      return Promise.resolve({ messageId: `<m${sent.length}@yaks.app>` })
    },
  }
}

// One object's whole state, with the socket list the runtime holds for it —
// the stand-in cannot do the 101 upgrade, so a socket is driven the way the
// runtime drives a hibernated one, through `webSocketMessage`.
let state = () => {
  let live: Wire[] = []
  return {
    storage: durable(),
    live,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

// A hibernatable socket, faked: what it was sent, in order.
let wire = () => {
  let sent: Frame[] = []
  let held: unknown = null
  return {
    sent,
    send: (data: string) => void sent.push(JSON.parse(data)),
    serializeAttachment: (v: unknown) => {
      held = JSON.parse(JSON.stringify(v))
    },
    deserializeAttachment: () => held,
  }
}

let APP = 'a0000000-0000-4000-8000-000000000001'
let ADA = 'b0000000-0000-4000-8000-000000000002'
let ANA = 'c0000000-0000-4000-8000-000000000003'
let NOTE = 'd0000000-0000-4000-8000-000000000004'

type Vouch = { person?: string; role?: string; access?: string }

let headers = (v: Vouch = {}): Record<string, string> => ({
  'x-store': 'ada/cookbook',
  'x-yak-app': APP,
  'x-yak-mail': 'ada.cookbook@yaks.app',
  'x-yak-access': v.access ?? 'private',
  ...(v.person ? { 'x-yak-person': v.person } : {}),
  ...(v.role ? { 'x-yak-role': v.role } : {}),
})

let owner: Vouch = { person: ADA, role: 'owner' }

let post = (store: Store, path: string, body: unknown, v?: Vouch) =>
  store.fetch(
    new Request(`http://store${path}`, {
      method: 'POST',
      headers: headers(v),
      body: JSON.stringify(body),
    }),
  )

// A store holding the cookbook, with a post room bound to `mail`.
let cookbook = async (mail = outbox(), v = owner, ctx = state()) => {
  let store = new Store(ctx, { MAIL: mail })
  assertEquals((await post(store, '/vocab', {}, v)).status, 200)
  return { store, mail, ctx }
}

// The letter as an app writes one: the recipient as an entity wearing an
// address, and the letter itself — a `doc` for the words, `mail` for the
// envelope, `deliver` for the ask.
let letter = (body = 'Bring a dish.') => [
  { entity: { eid: ANA }, email: { address: 'ana@example.com' } },
  {
    entity: { eid: NOTE },
    doc: { title: 'Potluck Friday', body },
    mail: {},
    deliver: { to: ANA },
  },
]

// One row, whole: `*` is the listing's word for "every component", which is
// what a test asserting on an outcome stamped by an effect wants.
let read = async (store: Store, eid: string, v = owner): Promise<Bundle> => {
  let q = encodeURIComponent(`.entity.eid=${eid}&*`)
  let r = await store.fetch(
    new Request(`http://store/query?q=${q}`, { headers: headers(v) }),
  )
  return (await r.json() as Bundle[])[0]
}

Deno.test("a member's letter leaves from the app's own address", async () => {
  let { store, mail } = await cookbook()
  assertEquals((await post(store, '/apply', letter(), owner)).status, 200)
  assertEquals(mail.sent.length, 1)
  let [sent] = mail.sent
  assertEquals(sent.from, 'ada.cookbook@yaks.app')
  assertEquals(sent.to, 'ana@example.com')
  assertEquals(sent.subject, 'Potluck Friday')
  assertEquals(sent.text, 'Bring a dish.')
  assert(String(sent.html).includes('<p>Bring a dish.</p>'))
  // And what became of it is a row, not a log line.
  let row = await read(store, NOTE)
  assertEquals((row.delivered as { via?: string }).via, 'm1@yaks.app')
  assertEquals(
    (row.mail as { from?: string; to?: string }).to,
    'ana@example.com',
  )
  assertEquals(row.bounced, undefined)
})

// The whole point of writing the outcome through apply() rather than straight
// through storage (T-34044): a page watching the letter is TOLD it left, in the
// same second, instead of finding out on its next query.
Deno.test('a page watching the letter is told it left', async () => {
  let ctx = state()
  let { store, mail } = await cookbook(outbox(), owner, ctx)
  let ws = wire()
  ctx.live.push(ws)
  // The raw feed carries batches exactly as applied, so a `delivered` bundle in
  // one can only have come from the effect's own apply().
  store.webSocketMessage(ws, JSON.stringify({ subscribe: true, id: 'all' }))
  // And the page-shaped ask: the letters that have left.
  store.webSocketMessage(
    ws,
    JSON.stringify({ subscribe: '.delivered!', id: 'note' }),
  )
  assertEquals(ws.sent.length, 1) // the raw feed opens with no set at all
  assertEquals((ws.sent[0] as { id: string }).id, 'note')

  assertEquals((await post(store, '/apply', letter(), owner)).status, 200)
  assertEquals(mail.sent.length, 1)

  let bundles = (f: Frame) => (f.bundles ?? []) as Bundle[]
  let cast = ws.sent.filter((f) =>
    bundles(f).some((b) => b.entity.eid == NOTE && b.delivered)
  )
  // Both subscriptions heard it: the raw feed as the batch the effect wrote,
  // the query as a letter that now matches.
  assertEquals([...new Set(cast.map((f) => f.id))].sort(), ['all', 'note'])
  let raw = bundles(cast.find((f) => f.id == 'all')!)
  assertEquals(
    (raw.find((b) => b.delivered)!.delivered as { via?: string }).via,
    'm1@yaks.app',
  )
})

Deno.test("the from address is the platform's word, never the batch's", async () => {
  let { store, mail } = await cookbook()
  let forged = letter()
  forged[1].mail = { from: 'billing@stripe.com' }
  assertEquals((await post(store, '/apply', forged, owner)).status, 200)
  assertEquals(mail.sent[0].from, 'ada.cookbook@yaks.app')
})

Deno.test('an anonymous visitor to an open app may not send', async () => {
  let { store, mail } = await cookbook()
  // Open: @yaks/member admits the write, and the post room refuses the ask.
  let anyone: Vouch = { access: 'open' }
  let r = await post(store, '/apply', letter(), anyone)
  assertEquals(r.status, 403)
  assertEquals((await r.json() as { error?: string }).error, 'Denied')
  assertEquals(mail.sent.length, 0)
  // The batch was refused whole: the letter is not in the store either.
  assertEquals(await read(store, NOTE), undefined)
})

Deno.test('an open app still takes an anonymous write that is not a letter', async () => {
  let { store } = await cookbook()
  let r = await post(store, '/apply', [{
    entity: { eid: NOTE },
    doc: { title: 'Signed the guestbook' },
  }], { access: 'open' })
  assertEquals(r.status, 200)
})

Deno.test('a provider failure comes to rest on the letter', async () => {
  let { store } = await cookbook(outbox('550 mailbox unavailable'))
  assertEquals((await post(store, '/apply', letter(), owner)).status, 200)
  let row = await read(store, NOTE)
  assertEquals(
    (row.bounced as { reason?: string }).reason,
    '550 mailbox unavailable',
  )
  assertEquals(row.delivered, undefined)
})

Deno.test('a deploy with no binding bounces rather than swallows', async () => {
  let store = new Store(state(), {})
  assertEquals((await post(store, '/vocab', {}, owner)).status, 200)
  assertEquals((await post(store, '/apply', letter(), owner)).status, 200)
  let row = await read(store, NOTE)
  assertEquals(
    (row.bounced as { reason?: string }).reason,
    'this deploy has no mail binding',
  )
})

Deno.test('the same letter written twice is sent once', async () => {
  let { store, mail } = await cookbook()
  assertEquals((await post(store, '/apply', letter(), owner)).status, 200)
  // The replay: the same bundles, the same eids. `mail` and `deliver` are
  // already there, so nothing is CREATED and no handler wakes; a handler that
  // did wake would find the `delivered` and leave the letter alone.
  assertEquals((await post(store, '/apply', letter(), owner)).status, 200)
  assertEquals(mail.sent.length, 1)
})

Deno.test('a letter with no ask to send is kept, not sent', async () => {
  let { store, mail } = await cookbook()
  let draft = [{
    entity: { eid: NOTE },
    doc: { title: 'Potluck Friday', body: 'Bring a dish.' },
    mail: {},
  }]
  assertEquals((await post(store, '/apply', draft, owner)).status, 200)
  assertEquals(mail.sent.length, 0)
  // And it goes the moment it gains one.
  assertEquals(
    (await post(store, '/apply', [
      { entity: { eid: ANA }, email: { address: 'ana@example.com' } },
      { entity: { eid: NOTE }, deliver: { to: ANA } },
    ], owner)).status,
    200,
  )
  assertEquals(mail.sent.length, 1)
})

Deno.test('no binding, no letter: the sender that refuses says why', async () => {
  let refused = await posting().send({
    from: 'ada@yaks.app',
    to: 'ana@example.com',
    subject: 'x',
    text: 'x',
    html: '<p>x</p>',
  }).then(() => null, (e: Error) => e.message)
  assertEquals(refused, 'this deploy has no mail binding')
})
