// Voice through an app's own door (rtc.ts, D-40615), with Cloudflare Realtime
// stood in for (probe.ts `cloudflare`): whom the door lets call, that a
// renewal counts what a call hears on the space's meter, that a spent
// allowance refuses a new call, and that a lease nobody renewed closes its
// call at Realtime.
import { assert, assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import { monthlyBudget, STARTER } from '@yaks/platform/plans'
import { monthOf } from '@yaks/platform/meter'
import { cloudflare, type Track } from './probe.ts'
import { fetch as appFetch } from './apps.ts'
import { appStore } from './directory.ts'
import { KERNEL } from './meta.ts'
import { ADA, as, SECRET, seeded, visit } from './serving-data-probe.ts'
import { platform as directory } from './directory-rows-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import { platform } from './testing.ts'
import { meta as platformMeta } from './meta.ts'

test("an app's voice door calls for its members, and for visitors where it opens voice", async () => {
  let cf = cloudflare()
  try {
    await using p = directory(SECRET, {
      REALTIME_APP: 'app',
      REALTIME_TOKEN: 'a-token',
      REALTIME_API: cf.url,
    })
    let { env } = p
    lifecycleStores(env)
    let { space, app, dir } = await seeded(env, 'open', p.dir)
    let owner = { cookie: await as(ADA) }
    let stranger = { 'cf-connecting-ip': '198.18.7.7' }
    let ask = async (
      who: Record<string, string>,
      path: string,
      body?: unknown,
      key = '',
    ) => {
      let r = await appFetch(
        visit(`/cookbook/api/rtc/${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { ...who, ...(key ? { 'x-yak-rtc-key': key } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
      )
      return { status: r.status, said: await r.json() }
    }
    let code = async (...a: Parameters<typeof ask>) => {
      let { status, said } = await ask(...a)
      return [status, said.error?.code]
    }

    let a = (await ask(owner, 'sessions/new', {})).said
    assert(a.sessionId && a.key)
    assertEquals(await code(stranger, 'sessions/new', {}), [
      401,
      'not_a_writer',
    ])

    let opened = await appStore(env.STORE, space, app, env)('/vocab', {
      method: 'POST',
      body: JSON.stringify({ rtc: 'open', $defs: {} }),
    }, KERNEL)
    assertEquals(opened.status, 200, await opened.text())
    let b = (await ask(stranger, 'sessions/new', {})).said
    assert(b.sessionId && b.key)

    // The stranger speaks, the owner hears them, and neither can change the
    // other's call.
    let voice = { location: 'local', mid: '0', trackName: 'voice' }
    let published = await ask(stranger, `sessions/${b.sessionId}/tracks/new`, {
      tracks: [voice],
      sessionDescription: { type: 'offer', sdp: '' },
    }, b.key)
    assertEquals(published.status, 200)
    let hearing = {
      tracks: [{
        location: 'remote',
        sessionId: b.sessionId,
        trackName: 'voice',
      }],
    }
    assertEquals(
      await code(
        stranger,
        `sessions/${a.sessionId}/tracks/new`,
        hearing,
        b.key,
      ),
      [403, 'not_yours'],
    )
    assertEquals(
      (await ask(owner, `sessions/${a.sessionId}/tracks/new`, hearing, a.key))
        .status,
      200,
    )

    // A renewal weighs what the owner's call hears, on the space's meter.
    assertEquals(
      (await ask(owner, `sessions/${a.sessionId}/renew`, {}, a.key)).status,
      200,
    )
    assert(((await dir.at(space.eid))?.meter?.realtime ?? 0) > 0)

    // Models and voice spend one account budget: spent on models, no new call.
    let month = monthOf(new Date())
    await dir.stamp({
      entities: [{
        entity: { eid: space.eid },
        meter: { month, models: monthlyBudget('free', month) + STARTER },
      }],
    })
    assertEquals(await code(owner, 'sessions/new', {}), [429, 'limit'])
  } finally {
    await cf.stop()
  }
})

test('a lease nobody renewed closes its call at Realtime and drops its row', async () => {
  let cf = cloudflare()
  let p = platform('a probe secret', {
    REALTIME_APP: 'app',
    REALTIME_TOKEN: 'a-token',
    REALTIME_API: cf.url,
  })
  try {
    let at = (path: string, body?: unknown) =>
      fetch(`${cf.url}/apps/app/sessions/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
      }).then((r) => r.json())
    let { sessionId } = await at('new', {})
    await at(`${sessionId}/tracks/new`, {
      tracks: [{ location: 'local', trackName: 'voice' }],
    })
    let app = crypto.randomUUID(), space = crypto.randomUUID()
    await platformMeta(p.env).apply([
      { entity: { eid: space }, space: { slug: 'ada', store: 'ada' } },
      {
        entity: { eid: app },
        app: { slug: 'room', space, access: 'public' },
      },
    ])
    let store = p.env.STORE.get(p.env.STORE.idFromName('ada/room'))
    let headers = {
      'x-store': 'ada/room',
      'x-yak-app': app,
      'x-yak-access': 'public',
      'x-yak-kernel': '1',
    }
    let read = async () =>
      await (await store.fetch(
        new Request('http://store/query?q=.sfu', { headers }),
      )).json()
    let row = {
      entity: { eid: crypto.randomUUID() },
      sfu: { session: sessionId, key: 'a hash' },
      wake: { at: new Date(Date.now() - 1000).toISOString() },
    }
    let wrote = await store.fetch(
      new Request('http://store/apply', {
        method: 'POST',
        headers,
        body: JSON.stringify([row]),
      }),
    )
    assertEquals(wrote.status, 200, await wrote.text())
    await p.ring()
    await until(async () => (await read()).length == 0, { label: 'the row' })
    let { tracks } = await at(sessionId) as { tracks: Track[] }
    assertEquals(tracks.map((t) => t.status), ['inactive'])
  } finally {
    await p[Symbol.asyncDispose]()
    await cf.stop()
  }
})
