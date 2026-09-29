// Voice through an app's own door (rtc.ts, D-40615), with Cloudflare Realtime
// stood in for (probe.ts `cloudflare`): whom the door lets call, that a
// renewal counts what a call hears on the space's meter, that a spent
// allowance refuses a new call, and that a lease nobody renewed closes its
// call at Realtime.
import { assert, assertEquals } from '@std/assert'
import { test, until } from '@yaks/testing'
import { BUDGET, monthOf } from './meter.ts'
import {
  cloudflare,
  connector,
  kernel,
  meta,
  seed,
  type Track,
} from './probe.ts'
import { platform } from './testing.ts'

test("an app's voice door calls for its members, and for visitors where it opens voice", async () => {
  let k = await kernel()
  try {
    let slug = `v${crypto.randomUUID().slice(0, 6)}`
    let { cookie, eids } = await seed(k, [{ slug, apps: ['room'] }])
    let agent = connector(k, cookie)
    await agent.tool('app_set', { space: slug, app: 'room', access: 'open' })
    let owner = { cookie }
    let stranger = { 'cf-connecting-ip': '198.18.7.7' }
    let ask = async (
      who: Record<string, string>,
      path: string,
      body?: unknown,
      key = '',
    ) => {
      let r = await k.at(`${slug}.yaks.app`, `/room/api/rtc/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...who, ...(key ? { 'x-yak-rtc-key': key } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
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

    await agent.tool('app_files', {
      space: slug,
      app: 'room',
      op: 'write',
      path: 'vocab.json',
      content: JSON.stringify({ rtc: 'open', $defs: {} }),
    })
    await agent.tool('app_deploy', { space: slug, app: 'room' })
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
    let [row] = await meta(k).query(`.space.slug=${slug}&?meter`) as {
      meter?: { realtime?: number }
    }[]
    assert((row.meter?.realtime ?? 0) > 0)

    // Models and voice spend one account budget: spent on models, no new call.
    await meta(k).apply([{
      entity: { eid: eids[slug] },
      meter: { month: monthOf(new Date()), models: BUDGET.free },
    }])
    assertEquals(await code(owner, 'sessions/new', {}), [429, 'limit'])
  } finally {
    await k.stop()
  }
})

test('a lease nobody renewed closes its call at Realtime and drops its row', async () => {
  let log = Deno.makeTempFileSync({ prefix: 'yak-mail-' })
  let cf = cloudflare(log)
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
    let store = p.env.STORE.get(p.env.STORE.idFromName('ada/room'))
    let headers = {
      'x-store': 'ada/room',
      'x-yak-app': crypto.randomUUID(),
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
    p[Symbol.dispose]()
    await cf.stop()
    Deno.removeSync(log)
  }
})
