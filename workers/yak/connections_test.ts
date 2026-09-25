// The connections page's verbs and the webhook door, over the in-process
// platform with the D1 stand-in as its vault: a pasted key ends up in the
// vault and nowhere else, a seal's state reaches the page, an app calls out
// with it only as its link allows, and a webhook lands in the app's store only
// when its signature holds.
import { assert, assertEquals } from '@std/assert'
import { envOf, integrationEid, need, registration } from '@yaks/connections'
import { link } from '@yaks/edge'
import type { Bundle } from '@yaks/graph'
import { isHandle } from '@yaks/secrets'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import {
  CALLBACK,
  connecting,
  connectionsOf,
  connectionsPlugin,
  ctxOf,
} from './connections.ts'
import { directory, over, storeName } from './directory.ts'
import { PLATFORM_STORE } from './door.ts'
import { db, named, platform } from './testing.ts'
import { scan } from '@yaks/sql'
import { KERNEL, meta } from './meta.ts'
import { outbound, outboundPlugin } from './outbound.ts'
import { answered, routed } from './plugin.ts'
import { opened } from './lib/token.ts'
import { minted, type Who } from './session.ts'
import { vaultOf } from './vault.ts'
import { slow } from '../../bin/testing.ts'

let KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
let SECRET = 'a probe secret'

let setup = async (vault = true) => {
  // The stand-in binds its own statement type; the env names D1's slice.
  let p = platform(
    SECRET,
    vault ? { VAULT: d1() as unknown as D1Like, VAULT_KEY: KEY } : {},
  )
  let at = meta(p.env)
  let dir = directory({ fetch: over(at) }, true)
  let person = crypto.randomUUID()
  let as = { 'x-yak-person': person, 'x-yak-role': 'owner' }
  await at.apply([
    { entity: { eid: person }, person: {} },
    {
      entity: { eid: '$space' },
      doc: { title: 'ada' },
      space: { slug: 'ada' },
    },
    {
      entity: { eid: '$seat' },
      member: { space: '$space', person, role: 'owner' },
    },
  ], as)
  let space = (await dir.space('ada'))!
  let who: Who = { person, role: 'owner' }
  let post = (fields: Record<string, string>, search = '?space=ada') => {
    let form = new FormData()
    for (let [k, v] of Object.entries(fields)) form.set(k, v)
    return connecting(
      new Request(`https://yaks.app/manage/connections${search}`),
      p.env,
      space,
      who,
      form,
    )
  }
  let shown = (enable?: string[]) =>
    connectionsOf(p.env, [space], person, [], enable)
  // Every row the directory's SQLite holds, as text.
  let dump = () => {
    let held = p.states.get(PLATFORM_STORE)!
    return named(held, { type: 'table' })
      .map((t) => JSON.stringify(scan(db(held), t))).join('\n')
  }
  return { p, at, dir, space, person, post, shown, dump }
}

slow(
  'a pasted key is sealed in the vault, and the directory holds its handle',
  async () => {
    let s = await setup()
    let said = await s.post({
      do: 'add',
      integration: 'Weather',
      hosts: 'api.weather.test',
      key: 'sk-live-0123456789',
    })
    assertEquals(said, {
      say: 'Saved. The key is kept safe and never shown again.',
      no: false,
    })
    let [one] = (await s.shown()).list
    assertEquals(
      [
        one.integration,
        one.status,
        one.keyed,
        one.hosts,
        one.saving,
        one.failed,
      ],
      ['Weather', 'connected', true, ['api.weather.test'], '', ''],
    )
    let [b] = await s.at.query(`.eid=${one.eid}&.secret`)
    let handle = (b.secret as { value: string }).value
    assert(isHandle(handle))
    assertEquals(
      (await vaultOf(s.p.env).read(one.eid))?.value,
      'sk-live-0123456789',
    )
    assert(!s.dump().includes('sk-live-0123456789'))
  },
)

slow('without a vault no key is taken, and the page says so', async () => {
  let s = await setup(false)
  assertEquals(
    await s.post({
      do: 'add',
      integration: 'Weather',
      hosts: 'api.weather.test',
      key: 'k',
    }),
    { say: "Keys can't be saved here yet.", no: true },
  )
  assertEquals((await s.shown()).on, false)
})

slow(
  'a built integration reached by OAuth is offered once this deploy holds its client',
  async () => {
    let s = await setup()
    let offered = async (enable?: string[]) =>
      (await s.shown(enable)).built.map((b) => b.name)
    let google = ['google-calendar']
    assertEquals(await offered(google), ['openrouter'])
    await s.at.apply(
      [registration('google', { id: 'yaks', secret: 's' })],
      KERNEL,
    )
    // Still in Google's testing mode: offered only on `?enable=`.
    assertEquals(await offered(), ['openrouter'])
    assertEquals(await offered(google), ['google-calendar', 'openrouter'])
    let [calendar] = (await s.shown(google)).built
    assertEquals(
      [calendar.face.title, calendar.face.site],
      ['Google Calendar', 'https://calendar.google.com'],
    )
  },
)

slow(
  'a sign-in begun on a page opened with ?enable= comes back to that page',
  async () => {
    let s = await setup()
    await s.at.apply(
      [registration('google', { id: 'yaks', secret: 's' })],
      KERNEL,
    )
    let went = await s.post(
      { do: 'add', integration: 'google-calendar' },
      '?space=ada&enable=google-calendar',
    )
    assert(went instanceof Response)
    let pair = went.headers.get('set-cookie')!.split(';')[0]
    let held = await opened<{ back: string }>(
      'connect',
      pair.slice(pair.indexOf('=') + 1),
      SECRET,
    )
    assertEquals(
      new URL(held!.back).searchParams.get('enable'),
      'google-calendar',
    )
  },
)

slow(
  'the directory holds the built integrations, and a space cannot change where their tokens go',
  async () => {
    let s = await setup()
    let hosts = async () => {
      let [b] = await s.at.query(
        `.eid=${integrationEid('openrouter')}&.integration`,
      )
      let i = b.integration as { hosts: string[]; built: boolean }
      return [i.hosts, i.built]
    }
    assertEquals(await hosts(), [['openrouter.ai'], true])
    let said = await s.post({
      do: 'add',
      integration: 'openrouter',
      hosts: 'evil.test',
      key: 'sk-live',
    })
    assertEquals((said as { no: boolean }).no, true)
    assertEquals(await hosts(), [['openrouter.ai'], true])
  },
)

slow(
  'the page tells a key being saved from one that could not be',
  async () => {
    let s = await setup()
    let conn = (eid: string, extra: object) => ({
      entity: { eid },
      connection: {
        integration: 'Weather',
        owner: s.space.eid,
        status: 'needed',
      },
      ...extra,
    })
    await s.at.apply([
      conn(crypto.randomUUID(), { provisional: { note: 'saving the key' } }),
      conn(crypto.randomUUID(), {
        exception: {},
        content: { body: 'the key could not be saved: boom' },
      }),
    ] as Bundle[], KERNEL)
    let seen = (await s.shown()).list.map((c) => [c.saving, c.failed]).sort()
    assertEquals(seen, [
      ['', 'the key could not be saved: boom'],
      ['saving the key', ''],
    ])
  },
)

slow('a connection elsewhere is not this page to change', async () => {
  let s = await setup()
  let eid = crypto.randomUUID()
  await s.at.apply([{
    entity: { eid },
    connection: {
      integration: 'Weather',
      owner: crypto.randomUUID(),
      status: 'needed',
    },
  }], KERNEL)
  assertEquals(
    await s.post({ do: 'disconnect', connection: eid }),
    { say: 'That connection is not here any more.', no: true },
  )
})

// A space whose Notes app asks each person to connect their own account
// through an integration; bob, who is nobody there; the door he connects at;
// and the connections his own page lists as his.
let asks = async (
  s: Awaited<ReturnType<typeof setup>>,
  integration: string,
  hosts?: string[],
) => {
  await s.at.apply([{
    entity: { eid: '$app' },
    doc: { title: 'Notes' },
    app: {
      slug: 'notes',
      space: s.space.eid,
      version: 0,
      access: 'public',
      store: 'ada/notes.a1',
    },
  }], KERNEL)
  let app = (await s.dir.app(s.space, 'notes'))!
  let c = ctxOf(s.p.env, { person: s.person, role: 'owner' })
  await c.graph.apply(
    await need(c.graph.read, {
      owner: s.space.eid,
      app: app.eid,
      integration,
      hosts,
      each: true,
      binding: 'SKY',
    }),
  )
  let bob = crypto.randomUUID()
  await s.at.apply([{ entity: { eid: bob }, person: {} }], KERNEL)
  let door = async (
    who: Who,
    init?: RequestInit,
    path = `/connections/${integration}`,
    host = 'ada.yaks.app',
  ) =>
    (await answered([connectionsPlugin, outboundPlugin], {
      env: s.p.env,
      req: new Request(`https://${host}/notes/api${path}`, init),
      path: path.split('?')[0],
      space: s.space,
      app,
      who,
      refuse: () => new Response(null, { status: 403 }),
      json: (status) => new Response(null, { status }),
    }))!
  let his = async () =>
    (await connectionsOf(s.p.env, [s.space], bob)).list.filter((c) => c.own)
  return { bob, door, his }
}

let posted = (fields: Record<string, string> = {}) => {
  let body = new FormData()
  for (let [k, v] of Object.entries(fields)) body.set(k, v)
  return { method: 'POST', body }
}

let to = (r: Response) => [r.status, r.headers.get('location')]

slow(
  'a person connects their own account for an app that asks each person, and the space holds only the ask',
  async () => {
    let s = await setup()
    let { bob, door, his } = await asks(s, 'Weather', ['api.weather.test'])
    let him: Who = { person: bob, role: null }
    let here = 'https://ada.yaks.app/notes/api/connections/Weather'
    assertEquals(
      to(await door({ person: null, role: null })),
      [303, `https://yaks.app/login?return=${encodeURIComponent(here)}`],
    )
    assertEquals(to(await door(him, undefined, undefined, 'n.io')), [303, here])
    assertEquals((await door(him, undefined, '/connections/Mail')).status, 404)
    assert((await (await door(him)).text()).includes('Notes asks each person'))
    assertEquals(
      to(await door(him, posted({ key: 'bob-key' }))),
      [303, 'https://ada.yaks.app/notes/?connected=1'],
    )
    let [mine] = await his()
    assertEquals(
      [mine.integration, mine.status, mine.each, mine.apps.map((a) => a.title)],
      ['Weather', 'connected', true, ['Notes']],
    )
    assertEquals((await vaultOf(s.p.env).read(mine.eid))?.value, 'bob-key')
    // His own is read by the name the app asks by, and handed to him alone.
    let env = async (who: Who) =>
      Object.keys(await (await door(who, undefined, '/env')).json())
    assertEquals(
      [await env(him), await env({ person: null, role: 'owner' })],
      [['SKY'], []],
    )
    let [asked] = (await s.shown()).list
    assertEquals([asked.each, asked.own, asked.status], [true, false, 'needed'])
    assertEquals(
      await s.post({ do: 'key', connection: asked.eid, key: 'k' }),
      { say: 'Each person connects their own, from the app.', no: true },
    )
  },
)

slow(
  'a testing integration is asked for only on a page opened with ?enable=',
  async () => {
    let s = await setup()
    let { bob, door } = await asks(s, 'google-calendar')
    let him: Who = { person: bob, role: null }
    let path = '/connections/google-calendar?enable=google-calendar'
    assertEquals((await door(him)).status, 404)
    assertEquals((await door(him, undefined, path)).status, 200)
    assertEquals(to(await door(him, undefined, path, 'n.io')), [
      303,
      `https://ada.yaks.app/notes/api${path}`,
    ])
  },
)

slow(
  'a person signs in for their own connection and comes back to the app',
  async () => {
    let s = await setup()
    await s.at.apply([registration('cal', { id: 'yaks' }), {
      entity: { eid: integrationEid('Cal') },
      integration: {
        name: 'Cal',
        authorize: 'https://auth.test/authorize',
        token: 'https://auth.test/token',
        client: 'cal',
        hosts: ['api.cal.test'],
      },
    }], KERNEL)
    let { bob, door, his } = await asks(s, 'Cal')
    let went = await door({ person: bob, role: null }, posted())
    let state = new URL(went.headers.get('location')!).searchParams.get('state')
    let attempt = went.headers.get('set-cookie')!.split(';')[0]
    let session = (await minted(
      new Request('https://yaks.app/'),
      s.p.env,
      SECRET,
      bob,
    )).split(';')[0]
    let real = globalThis.fetch
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ access_token: 'A', refresh_token: 'R' }))
    try {
      let back = await routed([connectionsPlugin], {
        env: s.p.env,
        req: new Request(`https://yaks.app${CALLBACK}?code=C&state=${state}`, {
          headers: { cookie: `${attempt}; ${session}` },
        }),
        path: CALLBACK,
        space: null,
      })
      assertEquals(to(back!), [303, 'https://ada.yaks.app/notes/?connected=1'])
    } finally {
      globalThis.fetch = real
    }
    let [mine] = await his()
    assertEquals([mine.integration, mine.status], ['Cal', 'connected'])
  },
)

// Every request the kernel sends out while `fn` runs, answered by `answer`.
let wired = async (
  answer: (r: Request) => Response,
  fn: (sent: Request[]) => Promise<void>,
) => {
  let sent: Request[] = []
  let was = globalThis.fetch
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let r = new Request(input, init)
    sent.push(r)
    return Promise.resolve(answer(r))
  }
  try {
    await fn(sent)
  } finally {
    globalThis.fetch = was
  }
}

slow(
  'an app calls out with the key in its sentinel’s place, for whom its link allows, and its worker is bound to it',
  async () => {
    let s = await setup()
    s.p.env.CF_WORKERS_TOKEN = 'cf'
    s.p.env.CF_ACCOUNT = 'acct'
    await s.at.apply([{
      entity: { eid: '$app' },
      doc: { title: 'Notes' },
      app: {
        slug: 'notes',
        space: s.space.eid,
        version: 0,
        access: 'public',
        store: 'ada/notes.a1',
      },
    }], KERNEL)
    let app = (await s.dir.app(s.space, 'notes'))!
    let c = ctxOf(s.p.env)
    let made = await c.graph.apply(
      await need(c.graph.read, {
        owner: s.space.eid,
        app: app.eid,
        integration: 'Hub',
        hosts: ['api.hub.test'],
      }),
    )
    let eid = made.find((b) => b.connection)!.entity.eid
    let bound: Request[] = []
    await wired(
      (r) =>
        Response.json({ success: true, result: r.method == 'GET' ? [] : {} }),
      async (sent) => {
        await s.post({ do: 'key', connection: eid, key: 'sk-hub' })
        bound = sent
      },
    )
    let { HUB } = await envOf(ctxOf(s.p.env), app.eid)
    assert(HUB.startsWith('yak_sentinel_'))
    // Kept, the key's sentinel is bound as the name the app's code reads.
    let put = bound.find((r) => r.method == 'PUT')!
    assertEquals(put.url.split('/scripts/')[1], 'ada_notes_a1/secrets')
    assertEquals(await put.json(), {
      name: 'HUB',
      text: HUB,
      type: 'secret_text',
    })
    let call = (to = 'https://api.hub.test/v1') =>
      new Request(`${to}?key=${HUB}`, { headers: { 'x-api-key': HUB } })
    let page = async (path: string, req: Request, role: 'viewer' | null) =>
      (await answered([outboundPlugin], {
        env: s.p.env,
        req,
        path,
        space: s.space,
        app,
        who: { person: null, role },
        refuse: () => new Response(null, { status: 403 }),
        json: (status) => new Response(null, { status }),
      }))!
    await wired((r) => new Response(r.url), async (sent) => {
      let out = (level: 'viewer' | null, to?: string) =>
        outbound(call(to), s.p.env, { app: app.eid, level, person: null })
      assertEquals(await (await out('viewer')).text(), sent[0].url)
      assertEquals(
        [sent[0].url, sent[0].headers.get('x-api-key')],
        ['https://api.hub.test/v1?key=sk-hub', 'sk-hub'],
      )
      // A stranger, or another host, is refused before anything is sent.
      assertEquals((await out(null)).status, 403)
      assertEquals((await out('viewer', 'https://evil.test/')).status, 403)
      assertEquals(sent.length, 1)
      // A page asks for its sentinels, and sends the call through the door.
      assertEquals(
        await (await page('/env', new Request('https://x/'), null)).json(),
        {},
      )
      assertEquals(
        await (await page('/env', new Request('https://x/'), 'viewer')).json(),
        { HUB },
      )
      let door = (to: string) =>
        new Request(
          `https://ada.yaks.app/notes/api/fetch?url=${encodeURIComponent(to)}`,
          { headers: { cookie: 'yak_session=mine' } },
        )
      assertEquals(
        (await page('/fetch', door('https://api.hub.test/'), 'viewer')).status,
        400,
      )
      let res = await page(
        '/fetch',
        door(`https://api.hub.test/v2?key=${HUB}`),
        'viewer',
      )
      assertEquals(await res.text(), 'https://api.hub.test/v2?key=sk-hub')
      assertEquals(sent[1].headers.get('cookie'), null)
      // Opened to anyone, a stranger calls out through it too.
      await s.post({ do: 'open', connection: eid, app: app.eid })
      assertEquals((await out(null)).status, 200)
    })
  },
)

let signed = async (secret: string, body: string) => {
  let key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  let mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
  )
  return 'sha256=' +
    [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
}

slow(
  'a webhook lands in the app that uses the connection, when it is signed',
  async () => {
    let s = await setup()
    await s.post({
      do: 'add',
      integration: 'Hub',
      hosts: 'api.hub.test',
      key: 'whsec',
    })
    let [one] = (await s.shown()).list
    await s.at.apply([
      {
        entity: { eid: '$app' },
        doc: { title: 'Notes' },
        app: {
          slug: 'notes',
          space: s.space.eid,
          version: 0,
          access: 'public',
          store: 'ada/notes.a1',
        },
      },
    ], KERNEL)
    let app = (await s.dir.app(s.space, 'notes'))!
    await s.at.apply([
      link(app.eid, 'uses', one.eid),
      {
        entity: { eid: integrationEid('Hub') },
        integration: { signature: 'github' },
      },
    ] as Bundle[], KERNEL)
    let path = `/_yaks/hooks/notes/${one.eid}`
    let hook = async (headers: Record<string, string>) =>
      (await routed([connectionsPlugin], {
        env: s.p.env,
        req: new Request(`https://ada.yaks.app${path}`, {
          method: 'POST',
          body: '{"action":"opened"}',
          headers,
        }),
        path,
        space: 'ada',
      }))!.status
    assertEquals(await hook({ 'x-hub-signature-256': 'sha256=00' }), 401)
    assertEquals(
      await hook({
        'x-hub-signature-256': await signed('whsec', '{"action":"opened"}'),
        'x-github-delivery': 'd1',
      }),
      204,
    )
    let stored = s.p.object(storeName(s.space, app))
    let [kept] = await (await stored.fetch(
      new Request('http://store/query?q=' + encodeURIComponent('.hook'), {
        headers: { 'x-store': storeName(s.space, app), ...KERNEL },
      }),
    )).json() as Bundle[]
    let { source, event, verified } = kept.hook as Record<string, unknown>
    assertEquals([source, event, verified], ['Hub', 'opened', true])
  },
)
