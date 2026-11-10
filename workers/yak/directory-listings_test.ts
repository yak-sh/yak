// Site.fetch listing requests over the seeded directory and its public
// copy. Run the integration while loading; the timed cases inspect results.
import { clock, equal, ok, test } from '@yaks/testing'
import { anonymousPage, type ServingCopyDoor, STALL } from './directory-copy.ts'
import { directory, url } from './directory.ts'
import * as dirPart from './directory.ts'
import { keyed, prefixOf } from './files.ts'
import { CARD, DEMOS, IMAGE, LIST } from './gallery.ts'
import { blobPrefix } from './blob-key.ts'
import { cardTag, SITE_TAG } from './purge.ts'
import { seal, verify } from './lib/token.ts'
import { browserOf } from './session.ts'
import { KEPT } from './page-cache.ts'
import { ServingCopy } from './serving-copy.ts'
import * as site from './site.ts'
import { ADA, ADA_OWNS, as, platform, seeded } from './serving-probe.ts'

let continuations = async () => {
  // A turn apart: gathered reads leave on the next one (directory-copy.ts).
  for (let turns = 0; turns < 3; turns++) {
    await new Promise((turned) => setTimeout(turned, 0))
    for (let n = 0; n < 128; n++) await Promise.resolve()
  }
}
let watching = (work: Promise<Response>) => {
  let answer: Response | undefined
  let failure: unknown
  void work.then((r) => answer = r, (e) => failure = e)
  return {
    pending: () => answer === undefined && failure === undefined,
    answer: () => {
      if (failure) throw failure
      ok(answer, 'Site did not answer by the directory deadline')
      return answer!
    },
  }
}

let fixture = async () => {
  let copy = new ServingCopy({
    persistence: { read: () => undefined, write: () => {} },
  })
  let fills: Promise<boolean>[] = []
  let coreDoor: ServingCopyDoor = {
    begin: () => Promise.resolve(copy.begin()),
    finish: (revision) => Promise.resolve(copy.finish(revision)),
    get: (key) => Promise.resolve().then(() => copy.get(key)),
    read: (key) => Promise.resolve().then(() => copy.read(key)),
    valid: (revision) => Promise.resolve(copy.valid(revision)),
    put: (revision, key, body) => {
      let filled = Promise.resolve(copy.put(revision, key, body))
      fills.push(filled)
      return filled
    },
  }
  let p = platform({
    SERVING_COPY: { idFromName: (name) => name, get: () => coreDoor },
  })
  let warm = await seeded(p.env)
  let dir = directory({ fetch: (req) => dirPart.fetch(req, p.env) })
  await dir.stamp({
    entities: [
      {
        entity: { eid: warm.app.eid },
        published: {
          name: 'cookbook',
          version: 1,
          at: '2026-09-01T00:00:00.000Z',
          about: 'Recipes from the listing fixture',
        },
        gallery: { listed_at: '2026-09-06T12:00:00.000Z' },
        screenshot: { blob: 'cookbook-shot' },
      },
      {
        entity: { eid: '$demos' },
        space: { slug: 'yourname', store: 'yourname' },
      },
      ...DEMOS.map((slug) => ({
        entity: { eid: `$${slug}` },
        doc: { title: `Demo ${slug}` },
        app: { slug, space: '$demos', access: 'public', version: 1 },
        published: {
          name: slug,
          version: 1,
          at: '2026-09-01T00:00:00.000Z',
        },
        screenshot: { blob: `${slug}-shot` },
      })),
    ],
  }, ADA_OWNS)
  // What the stamp owes runs after it answers (an app owes reward_referral),
  // and each of its writes clears the copy: finish it before the copy warms.
  await p.settled()

  let time = clock()
  let stalled = false
  let reads = 0
  let assets = 0
  let via = {
    fetch: (req: Request): Promise<Response> => {
      reads++
      return stalled ? new Promise(() => {}) : dirPart.fetch(req, p.env)
    },
  }
  let env = {
    ...p.env,
    CLOCK: time,
    DIRECTORY: via,
    ASSETS: {
      fetch: (_req: Request) => {
        assets++
        return Promise.resolve(
          new Response(
            `<html><body>${LIST}${
              DEMOS.map((slug) => `<li data-demo="${slug}">asset fallback</li>`)
                .join('')
            }</ul></body></html>`,
            { headers: { 'content-type': 'text/html' } },
          ),
        )
      },
    },
  }
  return {
    env,
    fills,
    reads: () => reads,
    assets: () => assets,
    time,
    stall: () => {
      stalled = true
    },
    request: (path: string, etag = '') =>
      site.fetch(
        new Request(site.at(env, path), {
          headers: { 'if-none-match': etag },
        }),
        env,
      ),
    close: () => p[Symbol.asyncDispose](),
  }
}

for (let path of ['/', '/gallery']) {
  let observed = await (async () => {
    let f = await fixture()
    try {
      let first = await f.request(path)
      let body = await first.text()
      let etag = first.headers.get('etag') ?? ''
      await continuations()
      await Promise.all(f.fills)
      let fills = f.fills.length
      let reads = f.reads()
      let assets = f.assets()
      f.stall()
      // Revalidation must not turn a stale rendering into a cacheable 304.
      let read = watching(f.request(path, etag))
      await continuations()
      await f.time.advance(STALL - 1)
      await continuations()
      let beforeDeadline = read.pending()
      await f.time.advance(1)
      await continuations()
      // Later listing reads inherit the same request deadline. Drain them at
      // this instant, not another stall per space/app query.
      for (let n = 0; n < 8; n++) {
        await f.time.advance(0)
        await continuations()
      }
      let answer = read.answer()
      return {
        first: first.status,
        fresh: first.headers.get('cache-control'),
        etag,
        body,
        beforeDeadline,
        elapsed: f.time.now(),
        status: answer.status,
        got: await answer.text(),
        cache: answer.headers.get('cache-control'),
        staleEtag: answer.headers.get('etag'),
        reads: f.reads() - reads,
        assets: f.assets() - assets,
        fills,
        refills: f.fills.length - fills,
      }
    } finally {
      await f.close()
    }
  })()
  test(`directory listings: signed-out ${path} survives a stalled directory within the stall deadline without recaching`, () => {
    equal(observed.first, 200)
    equal(
      observed.fresh,
      KEPT,
    )
    ok(observed.etag.startsWith('W/"'))
    ok(observed.beforeDeadline)
    equal(observed.elapsed, STALL)
    equal([observed.status, observed.got], [200, observed.body])
    equal(observed.cache, 'private, no-store')
    equal(observed.staleEtag, null)
    ok(observed.fills > 0, 'the prior read must warm the real directory rows')
    equal(observed.refills, 0)
    if (path == '/gallery') equal(observed.reads, 1)
    else ok(observed.reads > 1, 'the home page survives later directory reads')
    equal(observed.assets, path == '/' ? 1 : 0)
    if (path == '/') {
      for (let slug of DEMOS) ok(observed.got.includes(`Demo ${slug}`))
      ok(!observed.got.includes('asset fallback'))
    } else {
      ok(observed.got.includes('Cookbook'))
      ok(observed.got.includes('Recipes from the listing fixture'))
    }
  })
}

test('directory listings: an offered app picture is kept like the gallery and revalidates by its sha', async () => {
  let f = await fixture()
  try {
    let dir = directory({ fetch: (req) => dirPart.fetch(req, f.env) })
    let at = (await dir.offers()).find(({ app }) => app.slug == 'cookbook')!
    let png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await f.env.BLOBS.put(blobPrefix(at.space, at.app) + 'cookbook-shot', png)
    let path = `${IMAGE}${at.app.eid}/cookbook-shot`
    let first = await f.request(path)
    equal(
      ['cache-control', 'cache-tag', 'etag', 'content-type']
        .map((name) => first.headers.get(name)),
      [KEPT, SITE_TAG, '"cookbook-shot"', 'image/png'],
    )
    equal(new Uint8Array(await first.arrayBuffer()), png)
    equal((await f.request(path, '"cookbook-shot"')).status, 304)
    let other = await f.request(`${IMAGE}${at.app.eid}/other`)
    equal(
      [other.status, other.headers.get('cache-control')],
      [404, 'private, no-store'],
    )
  } finally {
    await f.close()
  }
})

// What Site's Server-Timing says it did: `site_r2` is the bucket reads.
let r2 = (res: Response) =>
  Number(/site_r2;dur=(\d+)/.exec(res.headers.get('server-timing') ?? '')?.[1])

test('directory listings: the gallery reads no app file, and a card with no screenshot redirects to its og:image', async () => {
  let f = await fixture()
  try {
    let dir = directory({ fetch: (req) => dirPart.fetch(req, f.env) })
    let at = (await dir.offers()).find(({ app }) => app.slug == 'cookbook')!
    await dir.stamp({
      entities: [{ entity: { eid: at.app.eid }, screenshot: { blob: null } }],
    }, ADA_OWNS)
    await f.env.BLOBS.put(
      keyed(prefixOf(at.space, at.app), '/'),
      '<meta property="og:image" content="card.png">',
    )
    let card = `${IMAGE}${at.app.eid}/${CARD}`
    let listing = await f.request('/gallery')
    ok((await listing.text()).includes(`${card}"`))
    equal(r2(listing), 0)
    let shot = await f.request(card)
    equal(
      ['location', 'cache-control', 'cache-tag']
        .map((name) => shot.headers.get(name)),
      [
        `${url(at.space, at.app, f.env)}card.png`,
        KEPT,
        `${SITE_TAG},${cardTag(at.app.eid)}`,
      ],
    )
    equal(shot.status, 302)
    ok(r2(shot) > 0, 'the card reads the app files the listing did not')
  } finally {
    await f.close()
  }
})

// These are genuine, valid seals, not malformed cookie stand-ins. The browser
// cookie carries an instrument but no person; a session must take authority.
let secret = 'a probe secret'
let signedIn = await as(ADA)
let token = signedIn.slice('yak_session='.length)
let anonymous = await seal('browser', {
  via: 'listing-browser',
  exp: Math.floor(Date.now() / 1000) + 60,
}, secret)
let requestWith = (cookie: string) =>
  new Request('https://yaks.app/gallery', { headers: { cookie } })
let signedInRequest = requestWith(signedIn)
let anonymousRequest = requestWith(`yak_session=${anonymous}`)
let claims = await verify(token, secret)
let browser = await browserOf(anonymousRequest, secret)
let anonymousSession = await verify(anonymous, secret)
test('directory listings: valid signed-in cookies bypass the copy, signed-out browser cookies permit it', () => {
  equal(claims?.person, ADA)
  ok(browser)
  equal(anonymousSession, null)
  equal(anonymousPage(signedInRequest), false)
  equal(anonymousPage(anonymousRequest), true)
  equal(anonymousPage(new Request('https://yaks.app/gallery')), true)
})
