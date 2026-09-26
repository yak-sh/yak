// Closing a space through the whole kernel (T-33166): the whole act — an agent that
// deletes nothing, a letter that does, a slug back in circulation with none
// of the last space's bytes or rows behind it — and the custom domain the
// erase gives back. The pure seams are erase_test.ts's.

import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { until } from '../../bin/testing.ts'
import { ticket } from './erase.ts'
import type { Space } from './directory.ts'
import {
  attach,
  attached,
  client,
  connector,
  kernel,
  letters,
  meta,
  seed,
} from './probe.ts'

let space = (over: Partial<Space> = {}): Space => ({
  eid: 'space-eid',
  slug: 'shoplab',
  title: 'shoplab',
  tier: 'free',
  plan: null,
  stripe: null,
  fee: 0,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: null,
  ...over,
})

// `forever` end to end (T-34431): the one path that still erases a space on
// the spot, and therefore the one that still gives the name back. The default
// path — the trash — is mcp_test.ts's, through the same letter.
Deno.test('a space erased: the letter, the act, and the name back', async () => {
  let k = await kernel()
  try {
    // A person with a space, an app with files and data in it, and a second
    // app so the delete has more than one of everything to take.
    let them = await seed(k, [{ slug: 'shoplab19', apps: ['shop', 'notes'] }])
    let agent = connector(k, them.cookie)
    let shop = client(k, 'shoplab19.yaks.app', 'shop', them.cookie)
    assertEquals((await shop.put('/index.html', '<h1>hi</h1>')).status, 200)
    await shop.applied({
      entities: [{ doc: { title: 'a note only this space has' } }],
    })
    assertEquals((await shop.get('.doc')).length, 1)
    assertEquals((await k.at('shoplab19.yaks.app', '/shop/')).status, 200)

    // The agent asks. It deletes nothing: it mails the owner, and says so.
    let said = await agent.tool('space_delete', {
      space: 'shoplab19',
      forever: true,
    })
    assertStringIncludes(said, 'nothing is deleted')
    assertStringIncludes(said, 'check their email')
    assertStringIncludes(said, 'https://shoplab19.yaks.app/shop/')
    assertEquals((await k.at('shoplab19.yaks.app', '/shop/')).status, 200)

    // The letter names what would go, and carries the link.
    let mail = await until(
      () =>
        letters(k, them.email).findLast((l) => l.subject.includes('Delete')),
      { timeout: 20_000, poll: 100, label: 'the delete letter' },
    )
    assertStringIncludes(mail!.body, 'https://shoplab19.yaks.app/notes/')
    let link = /https:\/\/yaks\.app(\/space\/shoplab19\/delete\?t=[^\s]+)/
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
    assertEquals((await k.at('shoplab19.yaks.app', '/shop/')).status, 200)

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
    assertStringIncludes(page, 'https://shoplab19.yaks.app/shop/')
    assertEquals((await k.at('shoplab19.yaks.app', '/shop/')).status, 200)

    // And confirms.
    let form = (fields: Record<string, string>) =>
      k.at('yaks.app', '/space/shoplab19/delete', {
        method: 'POST',
        headers: {
          cookie: them.cookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields).toString(),
      })
    let gone = await form({ t: at.split('t=')[1] })
    assertEquals(gone.status, 200)
    assertStringIncludes(await gone.text(), 'shoplab19.yaks.app is gone')

    // What is gone. The directory first: the space, its apps, and every
    // membership of it — one tombstone, the store's own cascade.
    let dir = meta(k)
    assertEquals(await dir.query(`id=${them.eids.shoplab19}`), [])
    assertEquals(await dir.query(`.app.space=${them.eids.shoplab19}`), [])
    assertEquals(await dir.query(`.member.space=${them.eids.shoplab19}`), [])

    // Then the name, which is back in circulation: somebody else takes it,
    // and what they get is empty — no files under the address, and a store
    // with none of the last space's rows in it. The store is named for the
    // address an app was born at (directory.ts storeName), so this is the
    // proof that matters for releasing a slug at all.
    let next = await seed(k, [{ slug: 'shoplab19', apps: ['shop'] }])
    let theirs = client(k, 'shoplab19.yaks.app', 'shop', next.cookie)
    assertEquals(await theirs.get('.doc'), [])
    assertEquals((await k.at('shoplab19.yaks.app', '/shop/')).status, 404)
  } finally {
    await k.stop()
  }
})

Deno.test('an erased space gives its domain back', async () => {
  let k = await kernel()
  try {
    let them = await seed(k, [{ slug: 'domainlab20', apps: ['shop'] }])
    let dir = meta(k)
    // A custom hostname, as domain_attach would have written it: held at
    // Cloudflare, and a row naming it. A delete that buried the row and kept
    // the hostname would leave a billable one nobody remembers (T-33038).
    let host = 'herbusiness105.com'
    await attach(k, host)
    await dir.apply([{
      hostname: {
        name: host,
        serves: them.eids['domainlab20/shop'],
        stage: 'active',
      },
    }])
    // The erase, which is the only act that gives a hostname back — the trash
    // leaves every one of them exactly where it is. Its ticket is the one the
    // letter would have carried (erase.ts `ticket`), minted here rather than
    // waited for, since what is under test is the act and not the letter.
    let out = await k.at('yaks.app', '/space/domainlab20/delete', {
      method: 'POST',
      headers: {
        cookie: them.cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        t: await ticket(
          space({ eid: them.eids.domainlab20 }),
          them.person,
          k.secret,
          true,
        ),
      }).toString(),
    })
    assertEquals(out.status, 200)
    await out.body?.cancel()
    assertEquals(await attached(k, host), false)
    assertEquals(
      (await dir.query('.hostname')).filter((r) =>
        (r.hostname as { name: string }).name == host
      ),
      [],
    )
    assertEquals(await dir.query(`id=${them.eids.domainlab20}`), [])
  } finally {
    await k.stop()
  }
})
