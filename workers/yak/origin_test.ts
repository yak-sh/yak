// Space isolation, held in workerd (T-33118). Every space is a subdomain of
// one registrable domain, so sibling spaces are SAME-SITE and the session
// cookie's `SameSite=Lax` does not separate them: without a check, a page on
// one space's hostname can open a socket onto another space's store and read
// it live, and can POST into it as a CORS-safelisted simple request that
// fires no preflight. What tells them apart is the browser's own `Origin`,
// and this file is the two attacks and the traffic that must keep working —
// a page at its own app's door, a page at a SIBLING app's door in the same
// space (app isolation is deliberately not here), a custom domain at its own
// door, and a client that sends no `Origin` at all.
//
// The second test is the one door that is deliberately open to every page
// (T-33408): an app's READ door, answered with the credentials taken off.
import { assert, assertEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { client, connector, kernel, meta, relay, seed } from './probe.ts'

// How a socket ended: open, or refused at the handshake. Whichever comes
// first — a handshake the kernel answers 403 arrives as an error, then a
// close, and either one is the same answer.
let opened = (url: string) =>
  new Promise<'open' | 'refused'>((done) => {
    let ws = new WebSocket(url)
    ws.onopen = () => {
      ws.close()
      done('open')
    }
    ws.onerror = () => done('refused')
    ws.onclose = () => done('refused')
  })

let titles = (rows: unknown[]) =>
  rows.map((r) => (r as { doc: { title: string } }).doc.title).sort()

slow('a page at another address reaches no door here', async () => {
  let k = await kernel()
  try {
    let { cookie, eids } = await seed(k, [{
      slug: 'jeff',
      apps: ['recipes', 'garden'],
    }])
    let owner = client(k, 'jeff.yaks.app', 'recipes', cookie)
    await owner.applied({ entities: [{ doc: { title: 'Lemon cake' } }] })

    // A door, asked from a page — the cookie a browser carries, and the
    // address that browser has in its bar.
    let page = (from: string, path: string, init: RequestInit = {}) =>
      k.at('jeff.yaks.app', path, {
        ...init,
        headers: {
          cookie,
          origin: from,
          ...(init.headers as Record<string, string> ?? {}),
        },
      })

    // THE WRITE. `text/plain` is CORS-safelisted, so this is a SIMPLE
    // request: the browser sends it with no preflight, the cookie rides
    // along, and the attacker never has to read the answer — the write has
    // already happened. The kernel reads the body with `req.text()` and never
    // looks at the content type, so the type costs the attack nothing.
    let forged = await page('https://evil.yaks.app', '/recipes/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ entities: [{ doc: { title: 'Forged' } }] }),
    })
    assertEquals(forged.status, 403)
    assertEquals((await forged.json()).error.code, 'foreign_origin')
    // And it wrote nothing: the refusal is the batch never running, not a
    // response the attacker could not read.
    assertEquals(titles(await owner.get('.doc!')), ['Lemon cake'])

    // Every other door in the same breath — the store's identity, the file
    // door a deploy writes through, and the bytes door a page's uploads go to.
    // The READ door is not among them any more: it answers a stranger's page
    // anonymously, which is the test below this one.
    for (
      let [path, init] of [
        ['/recipes/api/graph', {}],
        ['/recipes/api/blob', { method: 'POST', body: 'a photo' }],
        ['/recipes/api/files/index.html', { method: 'PUT', body: 'hi' }],
      ] as [string, RequestInit][]
    ) {
      let r = await page('https://evil.yaks.app', path, init)
      assertEquals(r.status, 403, `${path} let a stranger's page in`)
      assertEquals((await r.json()).error.code, 'foreign_origin')
    }

    // THE SOCKET. A websocket handshake is outside the same-origin policy
    // altogether — no preflight exists for it — so a page on any address can
    // open one, and the cookie goes with it. Deno's WebSocket sends no
    // `Origin` of its own, so the relay puts the attacker's on the wire.
    let evil = relay(k, 'jeff.yaks.app', cookie, 'https://evil.yaks.app')
    try {
      assertEquals(
        await opened(`${evil.origin.replace('http:', 'ws:')}/recipes/api/ws`),
        'refused',
      )
    } finally {
      await evil.stop()
    }

    // What must keep working, starting with the app's own page.
    let mine = await page('https://jeff.yaks.app', '/recipes/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ entities: [{ doc: { title: 'Plum tart' } }] }),
    })
    assertEquals(mine.status, 200)
    assertEquals(titles(await owner.get('.doc!')), ['Lemon cake', 'Plum tart'])

    // A SIBLING app in the same space, at this app's door: same hostname, so
    // same origin. App isolation is a different question and deliberately not
    // this one — borrowed words are written exactly this way.
    let sibling = await page(
      'https://jeff.yaks.app',
      '/recipes/api/query?.doc!',
    )
    assertEquals(sibling.status, 200)
    assertEquals(titles(await sibling.json()), ['Lemon cake', 'Plum tart'])

    // The app's own socket still opens.
    let ours = relay(k, 'jeff.yaks.app', cookie, 'https://jeff.yaks.app')
    try {
      assertEquals(
        await opened(`${ours.origin.replace('http:', 'ws:')}/recipes/api/ws`),
        'open',
      )
    } finally {
      await ours.stop()
    }

    // A client with no page behind it — curl, an agent, a server — sends no
    // `Origin`, has nothing to be tricked through, and keeps its door.
    assertEquals(
      (await owner.applied({ entities: [{ doc: { title: 'Fig tart' } }] })).ok,
      true,
    )

    // A CUSTOM DOMAIN is same-origin at its own root. The browser addressed
    // `herbusiness.com` and the page says `herbusiness.com`; the router
    // rewrites that to `jeff.yaks.app/recipes/…` on the way in, so a check
    // made after the rewrite would refuse the customer her own site.
    await meta(k, cookie).apply([{
      hostname: {
        name: 'herbusiness.com',
        app: eids['jeff/recipes'],
        stage: 'active',
      },
    }])
    let hers = await k.at('herbusiness.com', '/api/query?.doc!', {
      headers: { cookie, origin: 'https://herbusiness.com' },
    })
    assertEquals(hers.status, 200)
    assertEquals(titles(await hers.json()).length, 3)
    let wrote = await k.at('herbusiness.com', '/api/apply', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://herbusiness.com',
        'content-type': 'text/plain',
      },
      body: JSON.stringify({ entities: [{ doc: { title: 'A cake' } }] }),
    })
    assertEquals(wrote.status, 200)
    // And a stranger's page aimed at her domain is refused there too.
    let at = await k.at('herbusiness.com', '/api/apply', {
      method: 'POST',
      headers: { cookie, origin: 'https://evil.yaks.app' },
      body: JSON.stringify({ entities: [{ doc: { title: 'Forged' } }] }),
    })
    assertEquals(at.status, 403)

    // The connector is the same door at the apex, and the same rule: a page
    // anywhere else could otherwise call every tool this person owns.
    let rpc = {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      headers: { cookie, 'content-type': 'text/plain' },
    }
    let elsewhere = await k.at('yaks.app', '/mcp', {
      ...rpc,
      headers: { ...rpc.headers, origin: 'https://evil.example' },
    })
    assertEquals(elsewhere.status, 403)
    let home = await k.at('yaks.app', '/mcp', {
      ...rpc,
      headers: { ...rpc.headers, origin: 'https://yaks.app' },
    })
    assertEquals(home.status, 200)

    // A PAGE is not a door: an app's bytes are the web's, and nothing about
    // them is anyone's session.
    assert((await page('https://evil.yaks.app', '/recipes/')).status != 403)
  } finally {
    await k.stop()
  }
})

// The one door that answers a stranger's page (index.ts, route.ts `shared`,
// T-33408). The line above is about AMBIENT CREDENTIALS, not secrecy: a public
// app's rows already answer anyone with curl, so a read with the cookie taken
// off is curl with a referrer. This holds the two halves that make that safe —
// the answer is marked readable by any origin, and it is the answer NOBODY
// gets, whatever cookie was on the request — and the two that must not move:
// a write is still refused, on an `open` app most of all, and a private app
// refuses a stranger's page even carrying its owner's own session.
slow(
  'a public app reads to any page, and only ever as a stranger',
  async () => {
    let k = await kernel()
    try {
      let { cookie } = await seed(k, [{
        slug: 'jeff',
        apps: ['recipes', 'garden'],
      }])
      let owner = client(k, 'jeff.yaks.app', 'recipes', cookie)
      await owner.applied({ entities: [{ doc: { title: 'Lemon cake' } }] })
      let gardener = client(k, 'jeff.yaks.app', 'garden', cookie)
      await gardener.applied({ entities: [{ doc: { title: 'Tomatoes' } }] })
      let agent = connector(k, cookie)
      await agent.tool('app_set', {
        space: 'jeff',
        app: 'garden',
        access: 'private',
      })

      let page = (from: string, path: string, init: RequestInit = {}) =>
        k.at('jeff.yaks.app', path, {
          ...init,
          headers: {
            origin: from,
            ...(init.headers as Record<string, string> ?? {}),
          },
        })
      let AWAY = 'https://elsewhere.example'

      // A page anywhere, reading the public app — carrying the owner's own
      // cookie, which is the case that has to be got right.
      let read = await page(AWAY, '/recipes/api/query?.doc!', {
        headers: { cookie },
      })
      assertEquals(read.status, 200)
      assertEquals(read.headers.get('access-control-allow-origin'), '*')
      // The wildcard WITHOUT this is the browser's own guarantee that no cookie
      // was used: it refuses to send a credentialed request to `*` at all.
      assertEquals(read.headers.get('access-control-allow-credentials'), null)
      assertEquals(titles(await read.json()), ['Lemon cake'])

      // The same request with no cookie on it answers the same thing, which is
      // what "the door ignores the cookie" means.
      let cold = await page(AWAY, '/recipes/api/query?.doc!')
      assertEquals(cold.status, 200)
      assertEquals(titles(await cold.json()), ['Lemon cake'])

      // IGNORED, not merely absent: the owner's own cookie opens the private
      // app from the owner's own page and opens nothing from anyone else's.
      let shut = await page(AWAY, '/garden/api/query?.doc!', {
        headers: { cookie },
      })
      assertEquals(shut.status, 401)
      assertEquals((await shut.json()).error.code, 'not_a_reader')
      let hers = await page(
        'https://jeff.yaks.app',
        '/garden/api/query?.doc!',
        {
          headers: { cookie },
        },
      )
      assertEquals(hers.status, 200)
      assertEquals(titles(await hers.json()), ['Tomatoes'])

      // An OPEN app is the sharpest write case: a stranger MAY write in it,
      // from its own page, with no session at all. Not from another page.
      await agent.tool('app_set', {
        space: 'jeff',
        app: 'recipes',
        access: 'open',
      })
      let forged = await page(AWAY, '/recipes/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ entities: [{ doc: { title: 'Forged' } }] }),
      })
      assertEquals(forged.status, 403)
      assertEquals((await forged.json()).error.code, 'foreign_origin')
      assertEquals(titles(await owner.get('.doc!')), ['Lemon cake'])

      // And it still reads to that page, the way a public one does: what a
      // stranger may read is the app's own `access`, unchanged by any of this.
      let open = await page(AWAY, '/recipes/api/query?.doc!')
      assertEquals(open.status, 200)
      assertEquals(open.headers.get('access-control-allow-origin'), '*')
    } finally {
      await k.stop()
    }
  },
)
