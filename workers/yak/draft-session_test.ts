import { assert, assertEquals as equal } from '@std/assert'
import { test } from '@yaks/testing'
import { fresh, seed, signIn } from './probe.ts'
import { appStore } from './directory.ts'
import { KERNEL, meta } from './meta.ts'
import { appDoc } from './vocab.ts'
import * as apps from './apps.ts'
import { GRANT, SELF } from './dispatch.ts'
import worker from '../../apps/printbound/worker.ts'
import vocab from '../../apps/printbound/vocab.json' with { type: 'json' }
import { browserOf } from './session.ts'
import type { Env } from './env.ts'
let idOf = (value: unknown) =>
  typeof value === 'string' ? value : (value as { eid?: string } | null)?.eid

test('failed first guest handoff keeps drafts, saved source and artifacts with their person across logout', async () => {
  let env!: Env
  let k = await fresh({}, (value) => env = value)
  let reply = async (response: Response) => {
    let text = await response.text()
    if (!response.ok) throw Error(`${response.status}: ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }
  let kept = (response: Response) =>
    (response.headers.get('set-cookie') ?? '').split(';')[0]
  try {
    let slug = 'draft' + crypto.randomUUID().slice(0, 8),
      owner = await seed(k, [{ slug, apps: ['books'] }]),
      eid = owner.eids[`${slug}/books`]
    let at = await k.dir.appAt(eid)
    assert(at)
    let { space, app } = at
    await meta(env).apply(
      [{ entity: { eid }, app: { worker: 'worker.js', access: 'private' } }],
      KERNEL,
    )
    app = (await k.dir.appAt(eid))!.app
    let graph = appStore(env.STORE, space, app, env)
    await reply(
      await graph('/vocab', {
        method: 'POST',
        body: JSON.stringify(appDoc(vocab)),
      }, KERNEL),
    )
    env.DISPATCH = {
      get: () => ({
        fetch: async (request: Request) => {
          let own = request.headers.get(SELF),
            visitor = request.headers.get(GRANT),
            headers = new Headers(request.headers)
          let api = (grant: string) => ({
            fetch: (path: string, init: RequestInit = {}) =>
              apps.fetch(
                new Request(
                  new URL(
                    'api/' + path.replace(/^\//, ''),
                    `https://${slug}.${k.host}/books/`,
                  ),
                  { ...init, headers: { ...init.headers, [GRANT]: grant } },
                ),
                env,
              ),
          })
          headers.delete(SELF)
          headers.delete(GRANT)
          let response = await worker.fetch(new Request(request, { headers }), {
            APP: api(own!),
            STORE: api(visitor!),
            FILES: { fetch: () => Promise.resolve(new Response('fixture')) },
          })
          assert(response)
          return response
        },
      }),
    }
    let host = `${slug}.${k.host}`
    let ask = (path: string, cookie?: string, init: RequestInit = {}) =>
      k.at(host, `/books/${path}`, {
        ...init,
        headers: { ...init.headers, ...cookie ? { cookie } : {} },
      })
    let post = (path: string, value: unknown, cookie?: string) =>
      ask(path, cookie, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      }).then(reply)
    let first = await ask('api/drafts'),
      guest = kept(first),
      snapshot = await reply(first)
    await post('api/drafts', {
      principal: snapshot.principal,
      place: 'fixture:idea',
      text: 'Alice guest words',
      over: '',
    }, guest)
    let artifact = await ask(
      `api/pay/artifacts?via=${snapshot.principal}`,
      owner.cookie,
      {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'Guest source bytes',
      },
    ).then(reply)
    let source = await post('studio/save', {
      title: 'ABC',
      author: 'DEF',
      markdown: 'Alice saved source',
    }, guest)
    let signin = (cookie: string, email: string) =>
      signIn({
        ...k,
        at: (h: string, p: string, init: RequestInit = {}) =>
          k.at(h, p, { ...init, headers: { ...init.headers, cookie } }),
      }, email)
    let alice = await signin(guest, `${slug}-alice@${k.host}`)
    await k.settled()
    let namespace = env.STORE,
      original = namespace.get.bind(namespace),
      injected = false
    namespace.get = (id, options) => {
      let held = original(id, options)
      return {
        ...held,
        fetch: async (request: Request) => {
          if (
            !injected && request.method === 'POST' &&
            new URL(request.url).pathname === '/apply'
          ) {
            let body = await request.clone().json().catch(() => null),
              rows = Array.isArray(body) ? body : body?.entities
            if (
              rows?.some((row: { draft?: { by?: string } }) =>
                row.draft?.by === alice.person
              )
            ) {
              injected = true
              return Response.json({
                error: 'StoreUnavailable',
                message: 'Fixture interrupted draft migration',
              }, { status: 503 })
            }
          }
          return held.fetch(request)
        },
      }
    }
    let originalBrowser = await browserOf(
      new Request(`https://${k.host}/`, { headers: { cookie: guest } }),
      k.secret,
    )
    assert(originalBrowser)
    let [claim] = await meta(env).query(
      `.entity.eid=${originalBrowser.via}&?browser`,
    )
    equal(idOf((claim.browser as { by?: unknown }).by), alice.person)
    let before = await reply(
      await graph(
        '/query?q=' +
          encodeURIComponent(
            `.draft.via=${originalBrowser.via}&?draft&?created`,
          ),
        {},
        {
          ...KERNEL,
          'x-yak-person': owner.person,
          'x-yak-role': 'owner',
          'x-yak-administrative': '1',
        },
      ),
    )
    equal(idOf(before[0].created.by), alice.person)
    let failed = await ask('api/drafts', alice.cookie)
    assert(injected, 'the first draft adoption write was interrupted')
    assert(!failed.ok)
    equal(failed.status, 500)
    await failed.body?.cancel()
    let loggedout = await k.at(k.host, '/logout', {
        method: 'POST',
        headers: { cookie: alice.cookie },
      }),
      freshGuest = kept(loggedout)
    let oldBrowser = await browserOf(
      new Request(`https://${k.host}/`, { headers: { cookie: guest } }),
      k.secret,
    )
    let newBrowser = await browserOf(
      new Request(`https://${k.host}/`, { headers: { cookie: freshGuest } }),
      k.secret,
    )
    equal(loggedout.status, 303)
    assert(oldBrowser && newBrowser)
    assert(oldBrowser.via !== newBrowser.via)
    let next = await ask('api/drafts', freshGuest).then(reply)
    await post('api/drafts', {
      principal: next.principal,
      place: 'fixture:idea',
      text: 'Bob fresh guest words',
      over: '',
    }, freshGuest)
    let bob = await signin(freshGuest, `${slug}-bob@${k.host}`)
    await k.settled()
    let bs = await ask('api/drafts', bob.cookie).then(reply)
    let forged = {
      headers: { 'x-yak-browsers': JSON.stringify([snapshot.principal]) },
    }
    equal(
      (await ask(`studio/book?id=${source.entity.eid}`, bob.cookie, forged))
        .status,
      403,
    )
    equal(
      (await ask(`api/pay/artifacts/${artifact.eid}`, bob.cookie, forged))
        .status,
      404,
    )
    equal(await ask('studio/shelf', bob.cookie).then(reply), [])
    let ar = await signin(freshGuest, `${slug}-alice@${k.host}`)
    await k.settled()
    let aas = await ask('api/drafts', ar.cookie).then(reply)
    let books = await ask('studio/shelf', ar.cookie).then(reply)
    let found = await ask(`studio/book?id=${source.entity.eid}`, ar.cookie)
    equal(bs.drafts.map((r: { draft: { text: string } }) => r.draft.text), [
      'Bob fresh guest words',
    ])
    equal(aas.drafts.map((r: { draft: { text: string } }) => r.draft.text), [
      'Alice guest words',
    ])
    equal(found.status, 200)
    equal(ar.person, alice.person)
    equal(books.map((book: { entity: { eid: string } }) => book.entity.eid), [
      source.entity.eid,
    ])
    let recovered = await ask(`api/pay/artifacts/${artifact.eid}`, ar.cookie)
    equal(recovered.status, 200)
    equal(await recovered.text(), 'Guest source bytes')
    equal((await ask('api/query?q=.doc', ar.cookie)).status, 403)
  } finally {
    await k.stop()
  }
})
