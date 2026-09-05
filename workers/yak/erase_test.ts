// Closing a space (T-33166): the pure seams — what the ticket in the letter
// is worth, what the page and the letter say a delete would destroy, and the
// two spaces that may not be deleted at all — and then the whole act held in
// workerd: an agent that deletes nothing, a letter that does, and a slug back
// in circulation with none of the last space's bytes or rows behind it.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow, until } from '../../src/testing.ts'
import {
  type Doomed,
  door,
  letter,
  LIFE,
  naming,
  refused,
  ticket,
  ticketed,
} from './erase.ts'
import type { App, Host, Space } from './directory.ts'
import { client, connector, kernel, letters, meta, seed } from './probe.ts'

let space = (over: Partial<Space> = {}): Space => ({
  eid: 'space-eid',
  slug: 'shoplab',
  title: 'shoplab',
  tier: 'free',
  plan: null,
  meter: null,
  told: false,
  ...over,
})

let app = (over: Partial<App> = {}): App => ({
  eid: 'app-eid',
  slug: 'shop',
  space: 'space-eid',
  version: 1,
  title: 'The Shop',
  access: 'public',
  store: null,
  slugs: [],
  home: false,
  first: [],
  meter: null,
  published: null,
  installed: null,
  ...over,
})

let host = (name: string): Host => ({
  eid: `host-${name}`,
  name,
  app: 'app-eid',
  stage: 'active',
  at: '',
})

let doomed = (over: Partial<Doomed> = {}): Doomed => ({
  space: space(),
  apps: [app()],
  hosts: [],
  members: [{ person: 'p1', name: 'Dana' }],
  ...over,
})

Deno.test('a ticket opens one space for one person, for an hour', async () => {
  let secret = 'shhh'
  let t = await ticket(space(), 'p1', secret)
  let open = await ticketed(t, secret)
  assertEquals(open?.space, 'space-eid')
  assertEquals(open?.person, 'p1')
  // Dead an hour on, and dead under any other secret or any edit.
  assertEquals(await ticketed(t, secret, Date.now() + LIFE + 1000), null)
  assertEquals(await ticketed(t, 'another secret'), null)
  assertEquals(await ticketed(`${t}x`, secret), null)
  assertEquals(await ticketed('not a ticket', secret), null)
})

Deno.test('what a delete would destroy is named, not counted', () => {
  let lines = naming(doomed({
    apps: [app(), app({ eid: 'b', slug: 'notes', title: 'Notes' })],
    hosts: [host('herbusiness.com')],
    members: [{ person: 'p1', name: 'Dana' }, { person: 'p2', name: 'Sam' }],
  }))
  let said = lines.join('\n')
  assertStringIncludes(said, 'The Shop (https://shoplab.yaks.app/shop/)')
  assertStringIncludes(said, 'Notes (https://shoplab.yaks.app/notes/)')
  assertStringIncludes(said, 'herbusiness.com stops serving')
  assertStringIncludes(said, '2 people lose their way in: Dana, Sam')
  assertStringIncludes(said, 'shoplab.yaks.app goes back into circulation')
  // One member is the owner reading the letter; there is nobody to warn about.
  assert(!naming(doomed()).some((l) => l.includes('lose their way in')))
  // And the letter says the same words, with the link and the hour.
  let l = letter(doomed(), door('shoplab', 'tkt'))
  assertEquals(l.subject, 'Delete shoplab.yaks.app?')
  assertStringIncludes(l.body, 'https://yaks.app/space/shoplab/delete?t=tkt')
  assertStringIncludes(l.body, 'the next hour')
  assertStringIncludes(l.body, 'The Shop (https://shoplab.yaks.app/shop/)')
})

Deno.test('the platform and a paying space refuse to be deleted', () => {
  assertEquals(refused(space()), '')
  assertStringIncludes(refused(space({ slug: 'yak' })), 'the platform itself')
  let paying = space({
    plan: {
      tier: 'plus',
      customer: 'cus_1',
      subscription: 'sub_1',
      status: 'active',
      until: null,
      ending: null,
      at: '',
    },
  })
  assertStringIncludes(refused(paying), 'Cancel the subscription first')
  // Cancelled at Stripe, the row stays and the space may go.
  assertEquals(
    refused(space({ plan: { ...paying.plan!, status: 'canceled' } })),
    '',
  )
})

slow('a space deleted: the letter, the act, and the name back', async () => {
  let k = await kernel()
  try {
    // A person with a space, an app with files and data in it, and a second
    // app so the delete has more than one of everything to take.
    let them = await seed(k, [{ slug: 'shoplab', apps: ['shop', 'notes'] }])
    let agent = connector(k, them.cookie)
    let shop = client(k, 'shoplab.yaks.app', 'shop', them.cookie)
    assertEquals((await shop.put('/index.html', '<h1>hi</h1>')).status, 200)
    await shop.applied({
      entities: [{ doc: { title: 'a note only this space has' } }],
    })
    assertEquals((await shop.get('.doc!')).length, 1)
    assertEquals((await k.at('shoplab.yaks.app', '/shop/')).status, 200)

    // The AGENT asks. It deletes nothing: it mails the owner, and says so.
    let said = await agent.tool('space_delete', { space: 'shoplab' })
    assertStringIncludes(said, 'nothing is deleted')
    assertStringIncludes(said, 'check their email')
    assertStringIncludes(said, 'https://shoplab.yaks.app/shop/')
    assertEquals((await k.at('shoplab.yaks.app', '/shop/')).status, 200)

    // The letter names what would go, and carries the link.
    let mail = await until(
      () =>
        letters(k, them.email).findLast((l) => l.subject.includes('Delete')),
      { timeout: 20_000, poll: 100, label: 'the delete letter' },
    )
    assertStringIncludes(mail!.body, 'https://shoplab.yaks.app/notes/')
    let link = /https:\/\/yaks\.app(\/space\/shoplab\/delete\?t=[^\s]+)/
      .exec(mail!.body)
    assert(link, `no confirmation link in: ${mail!.body}`)
    let at = link[1]

    // An agent cannot follow it. The door reads the session cookie and
    // nothing else, so a bearer token — the only thing an agent has — is sent
    // to sign in, and the POST that would destroy the space does nothing.
    for (let method of ['GET', 'POST']) {
      let shut = await k.at('yaks.app', at, {
        method,
        redirect: 'manual',
        headers: { authorization: 'Bearer whatever-an-agent-holds' },
      })
      assertEquals(shut.status, 302)
      assertStringIncludes(shut.headers.get('location') ?? '', '/login')
      await shut.body?.cancel()
    }
    assertEquals((await k.at('shoplab.yaks.app', '/shop/')).status, 200)

    // Somebody else signed in is told what a stranger is told about a space
    // that does not exist.
    let stranger = await seed(k, [])
    let no = await k.at('yaks.app', at, {
      headers: { cookie: stranger.cookie },
    })
    assertEquals(no.status, 404)
    await no.body?.cancel()

    // The owner opens it: the page names everything that would go, and the
    // GET alone changes nothing — a mail client that follows every link in a
    // letter must not be able to delete a space.
    let page = await (await k.at('yaks.app', at, {
      headers: { cookie: them.cookie },
    })).text()
    assertStringIncludes(page, 'What goes, for good')
    assertStringIncludes(page, 'https://shoplab.yaks.app/shop/')
    assertEquals((await k.at('shoplab.yaks.app', '/shop/')).status, 200)

    // And confirms.
    let form = (fields: Record<string, string>) =>
      k.at('yaks.app', '/space/shoplab/delete', {
        method: 'POST',
        headers: {
          cookie: them.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields).toString(),
      })
    let gone = await form({ t: at.split('t=')[1] })
    assertEquals(gone.status, 200)
    assertStringIncludes(await gone.text(), 'shoplab.yaks.app is gone')

    // What is gone. The directory first: the space, its apps, and every
    // membership of it — one tombstone, the store's own cascade.
    let dir = meta(k, them.cookie)
    assertEquals(await dir.query(`id=${them.eids.shoplab}`), [])
    assertEquals(await dir.query(`.app.space=${them.eids.shoplab}`), [])
    assertEquals(await dir.query(`.member.space=${them.eids.shoplab}`), [])

    // Then the name, which is back in circulation: somebody else takes it,
    // and what they get is EMPTY — no files under the address, and a store
    // with none of the last space's rows in it. The store is named for the
    // address an app was born at (directory.ts storeName), so this is the
    // proof that matters for releasing a slug at all.
    let next = await seed(k, [{ slug: 'shoplab', apps: ['shop'] }])
    let theirs = client(k, 'shoplab.yaks.app', 'shop', next.cookie)
    assertEquals(await theirs.get('.doc!'), [])
    assertEquals((await k.at('shoplab.yaks.app', '/shop/')).status, 404)
  } finally {
    await k.stop()
  }
})

slow('a space with a domain attached refuses to die quietly', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'domainlab', apps: ['shop'] }])
    let dir = meta(k, them.cookie)
    // A custom hostname, as domain_attach would have written it. This kernel
    // has no Cloudflare token, so nothing here can give the hostname back —
    // and a delete that buried the row anyway would leave a billable custom
    // hostname nobody remembers (T-33038).
    await dir.apply([{
      hostname: {
        name: 'herbusiness.com',
        app: them.eids['domainlab/shop'],
        stage: 'active',
      },
    }])
    let out = await k.at('yaks.app', '/space/domainlab/delete', {
      method: 'POST',
      headers: {
        cookie: them.cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ confirm: 'domainlab' }).toString(),
    })
    assertEquals(out.status, 502)
    let said = await out.text()
    assertStringIncludes(said, 'did not finish')
    assertStringIncludes(said, 'CF_HOSTNAMES_TOKEN')
    // Nothing went: the space, its app and its hostname all still stand.
    assertEquals((await dir.query(`id=${them.eids.domainlab}`)).length, 1)
    assertEquals((await dir.query('.hostname!')).length, 1)
    assertEquals(
      (await dir.query(`.app.space=${them.eids.domainlab}`)).length,
      1,
    )
  } finally {
    await k.stop()
  }
})
