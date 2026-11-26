import { assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { registration } from '@yaks/connections'
import type { Comp } from '@yaks/graph'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import { ai, modelPage, platform } from './testing.ts'
import { directoryOf } from './directory.ts'
import { KERNEL, meta } from './meta.ts'
import { CALLBACK, connecting, connectionsOf, ctxOf } from './connections.ts'
import { atApex } from './kernel.ts'
import { apiCall } from './operator-integrations.ts'

let signing = 'fixture signing secret'
let encoder = new TextEncoder()
let key = await crypto.subtle.importKey(
  'raw',
  encoder.encode(signing),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
)
let event = async (
  value: unknown,
  options: { age?: number; forged?: boolean } = {},
) => {
  let raw = JSON.stringify(value)
  let at = Math.floor(Date.now() / 1000) - (options.age ?? 0)
  let hmac = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`v0:${at}:${raw}`),
  )
  let hex = Array.from(
    new Uint8Array(hmac),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  return new Request('https://yaks.app/slack/events', {
    method: 'POST',
    headers: {
      'x-slack-request-timestamp': String(at),
      'x-slack-signature': 'v0=' + hex,
    },
    body: options.forged ? raw + ' ' : raw,
  })
}
let mention = (
  ts: string,
  changes: Record<string, unknown> = {},
  team = 'TCHECKS',
) => ({
  type: 'event_callback',
  team_id: team,
  authorizations: [{ team_id: team, user_id: 'UBOT', is_bot: true }],
  event: {
    type: 'app_mention',
    user: 'UASKER',
    channel: 'CGENERAL',
    text: '<@UBOT> Hello Operator',
    ts,
    ...changes,
  },
})

test('Slack OAuth lets a workspace mention and DM its Operator, receive threaded replies, and disconnect', async () => {
  let model = ai([{ text: 'Channel reply.' }, { text: 'Same thread.' }, {
    text: 'DM reply.',
  }])
  let p = platform('slack test', {
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(5))),
    AI: model as never,
    MODEL_FETCH: () => Promise.resolve(modelPage(0.15, 0.5)),
  })
  let dir = directoryOf(p.env.STORE)
  let person = crypto.randomUUID(), checks = crypto.randomUUID()
  await meta(p.env).apply([
    { entity: { eid: person }, person: {} },
    { entity: { eid: checks }, space: { slug: 'checks', store: 'checks' } },
    {
      entity: { eid: '$seat' },
      member: { person, space: checks, role: 'owner', own: true },
    },
    registration('slack', { id: 'SLACK-APP', secret: 'SLACK-CLIENT', signing }),
  ], KERNEL)
  let space = (await dir.at(checks))!
  let who = { person, role: 'owner' as const }
  let page = 'https://yaks.app/manage/checks/connections'
  let form = (data: Record<string, string>) => {
    let form = new FormData()
    for (let [field, value] of Object.entries(data)) form.set(field, value)
    return connecting(new Request(page), p.env, space, who, form)
  }
  let calls: {
    method: string
    auth: string | null
    body: Record<string, unknown>
  }[] = []
  let fetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    let r = new Request(input, init)
    let url = new URL(r.url)
    if (url.host != 'slack.com') return fetch(input, init)
    let auth = r.headers.get('authorization')
    if (url.pathname == '/api/oauth.v2.access') {
      let fields = new URLSearchParams(await r.text())
      assertEquals(auth, 'Basic ' + btoa('SLACK-APP:SLACK-CLIENT'))
      assertEquals(fields.get('redirect_uri'), 'https://yaks.app' + CALLBACK)
      assertEquals(fields.get('code_verifier'), null)
      return Response.json({
        ok: true,
        access_token: 'xoxb-checks',
        token_type: 'bot',
        scope: 'app_mentions:read,chat:write,im:history',
        team: { id: 'TCHECKS', name: 'Checks Slack' },
      })
    }
    let body = r.body ? JSON.parse(await r.text()) : {}
    calls.push({ method: r.method + ' ' + url.pathname, auth, body })
    if (url.pathname == '/api/auth.test') {
      return Response.json({ ok: true, team_id: 'TCHECKS' })
    }
    return Response.json({ ok: true, ts: `180000000${calls.length}.000000` })
  }
  try {
    let { built } = await connectionsOf(p.env, space, person)
    assertEquals(built.some((i) => i.name == 'slack'), true)
    let went = await form({ do: 'add', integration: 'slack' }) as Response
    let authorize = new URL(went.headers.get('location')!)
    assertEquals(authorize.pathname, '/oauth/v2/authorize')
    assertEquals(authorize.searchParams.get('client_id'), 'SLACK-APP')
    assertStringIncludes(
      authorize.searchParams.get('scope')!,
      'app_mentions:read,',
    )
    assertEquals(authorize.searchParams.get('code_challenge'), null)
    let callback = new Request(
      'https://yaks.app' + CALLBACK + '?code=ok&state=' +
        authorize.searchParams.get('state'),
    )
    assertEquals((await atApex(callback, p.env))?.status, 303)
    let [row] = await ctxOf(p.env).graph.read(
      '.connection.integration=slack&.connection.status=connected&*',
    )
    let connection = row.connection as Comp
    assertEquals(connection.account, 'TCHECKS')
    assertEquals(connection.title, 'Checks Slack')
    assertEquals(connection.scopes, [
      'app_mentions:read',
      'chat:write',
      'im:history',
    ])

    let api = apiCall(p.env, space, { ctx: { person, dir } })
    let result = await api.run({ integration: 'slack', path: '/auth.test' })
    assertStringIncludes(String(result), 'TCHECKS')
    assertEquals(calls.shift()?.method, 'POST /api/auth.test')

    let intake = async (body: unknown, options?: Parameters<typeof event>[1]) =>
      (await atApex(await event(body, options), p.env))!
    let first = mention('1785000000.000001')
    assertEquals((await intake(first, { forged: true })).status, 401)
    assertEquals((await intake(first, { age: 301 })).status, 401)
    let hello = await intake({
      type: 'url_verification',
      challenge: 'slack challenge',
    })
    assertEquals(await hello.text(), 'slack challenge')
    assertEquals(
      (await intake(mention('1785000000.000002', {}, 'TOTHER'))).status,
      200,
    )
    assertEquals(
      (await intake(mention('1785000000.000003', { bot_id: 'BOTHER' }))).status,
      200,
    )
    assertEquals((await intake(first)).status, 200)
    assertEquals((await intake(first)).status, 200)
    await p.settled()
    assertEquals(
      (await intake(mention('1785000000.000004', {
        thread_ts: first.event.ts,
      }))).status,
      200,
    )
    await p.settled()
    let dm = mention('1785000000.000005', {
      type: 'message',
      channel: 'DDIRECT',
      channel_type: 'im',
      text: 'Hello in DM',
    })
    assertEquals((await intake(dm)).status, 200)
    await p.settled()
    assertEquals(model.asked.length, 3)
    assertEquals(
      calls.map(({ method, auth, body }) => [
        method,
        auth,
        body.channel,
        body.thread_ts,
        body.text,
      ]),
      [
        [
          'POST /api/chat.postMessage',
          'Bearer xoxb-checks',
          'CGENERAL',
          first.event.ts,
          'Channel reply.',
        ],
        [
          'POST /api/chat.postMessage',
          'Bearer xoxb-checks',
          'CGENERAL',
          first.event.ts,
          'Same thread.',
        ],
        [
          'POST /api/chat.postMessage',
          'Bearer xoxb-checks',
          'DDIRECT',
          dm.event.ts,
          'DM reply.',
        ],
      ],
    )

    assertEquals(await form({ do: 'disconnect', connection: row.entity.eid }), {
      say: 'Disconnected.',
      no: false,
    })
    assertEquals((await intake(mention('1785000000.000006'))).status, 200)
    await p.settled()
    assertEquals(model.asked.length, 3)
  } finally {
    globalThis.fetch = fetch
  }
})
