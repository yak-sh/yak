import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Item, Request as Asked } from '@yaks/model'
import type { D1Like } from '@yaks/d1'
import { brokerKey, registration } from '@yaks/connections'
import { d1 } from '../../packages/d1/testing.ts'
import { platform } from './testing.ts'
import { directoryOf } from './directory.ts'
import { CALLBACK, callback, connecting } from './connections.ts'
import { KERNEL, meta } from './meta.ts'
import { minted } from './session.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { operatorContext } from './operator.ts'
import {
  eventBody,
  googleTools,
  letterOf,
  mailedFor,
  messageOf,
  READS,
} from './operator-google.ts'

// A person connects their Google Calendar and Gmail from their connections
// page, and their Operator reads their calendar, adds to it and sends mail
// from their address in a conversation (T-138751). Gmail is signed in through
// Nango (D-151626), and its token still goes straight to Google. Google and
// Nango are faked at the fetch they are called through.
let SECRET = 'operator-google'
let { env } = platform(SECRET, {
  VAULT: d1() as unknown as D1Like,
  VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
})
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), eid = crypto.randomUUID()
let owner = { 'x-yak-person': person, 'x-yak-role': 'owner' }
await dir.apply({
  entities: [
    {
      entity: { eid: person },
      person: {},
      doc: { title: 'Jeff Peterson' },
      email: { address: 'jeff@example.com' },
    },
    { entity: { eid }, space: { slug: 'jeff', store: 'jeff' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, owner)
await meta(env).apply(
  [
    registration('google', { id: 'yaks', secret: 's' }),
    brokerKey('nango', 'nk'),
  ],
  KERNEL,
)
let space = (await dir.at(eid))!
let held = { person, role: 'owner' as const, space: eid }

// Google: its token door, the calendar and Gmail.
let asked: Request[] = []
let real = globalThis.fetch
let id_token = `e30.${
  btoa(JSON.stringify({ email: 'jeff@example.com' })).replace(/=+$/, '')
}.sig`
// Nango: the sign-in it was asked for, which the person finished there.
let signing = ''
let nango = async (r: Request, url: URL) => {
  if (r.method == 'POST') {
    signing = (await r.json()).tags.end_user_id
    return Response.json({
      data: { connect_link: 'https://connect.nango.dev/?session_token=s' },
    })
  }
  if (url.pathname == '/connections') {
    return Response.json({
      connections: signing
        ? [{
          connection_id: 'n1',
          provider_config_key: 'google-mail',
          tags: { end_user_id: signing },
        }]
        : [],
    })
  }
  return Response.json({
    connection_config: { emailAddress: 'jeff@example.com' },
    credentials: {
      access_token: 'G1',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      raw: { scope: `${READS[0]} openid email` },
    },
  })
}
globalThis.fetch = (input, init) => {
  let r = new Request(input, init)
  let url = new URL(r.url)
  if (url.host == 'api.nango.dev') return nango(r, url)
  if (!url.host.endsWith('googleapis.com')) return real(r)
  asked.push(r.clone())
  if (url.host == 'oauth2.googleapis.com') {
    return Promise.resolve(
      Response.json({ access_token: 'A1', refresh_token: 'R1', id_token }),
    )
  }
  if (url.pathname.endsWith('/events') && r.method == 'GET') {
    return Promise.resolve(Response.json({
      timeZone: 'America/Detroit',
      items: [{
        id: 'e1',
        summary: 'Standup',
        start: { dateTime: '2026-11-10T09:00:00-05:00' },
        end: { dateTime: '2026-11-10T09:15:00-05:00' },
      }],
    }))
  }
  if (url.pathname.endsWith('/calendarList/primary')) {
    return Promise.resolve(Response.json({ timeZone: 'America/Detroit' }))
  }
  if (url.pathname.endsWith('/events')) {
    return r.json().then((e) => Response.json({ id: 'e2', ...e }))
  }
  return Promise.resolve(Response.json({ id: 'm1' }))
}
let to = (path: string) => asked.filter((r) => r.url.includes(path))

// Connected from the connections page: Connect, then back from Google, or
// sent to Nango, which keeps the person.
let connect = async (integration: string) => {
  let form = new FormData()
  form.set('do', 'add')
  form.set('integration', integration)
  let went = await connecting(
    new Request(
      `https://yaks.app/manage/jeff/connections?enable=${integration}`,
    ),
    env,
    space,
    { person, role: 'owner' },
    form,
  ) as Response
  if (!went.headers.get('set-cookie')) return went
  let state = new URL(went.headers.get('location')!).searchParams.get('state')
  let attempt = went.headers.get('set-cookie')!.split(';')[0]
  let session =
    (await minted(new Request('https://yaks.app/'), env, SECRET, person))
      .split(';')[0]
  return callback({
    env,
    req: new Request(`https://yaks.app${CALLBACK}?code=C&state=${state}`, {
      headers: { cookie: `${attempt}; ${session}` },
    }),
    path: CALLBACK,
    space: null,
  })
}

let reply = (text: string): Item[] => [{ kind: 'assistant', text }]
let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
// The fork reads the calendar, adds the dentist, and emails the office.
let steps = [
  call('calendar_events', {
    from: '2026-11-10T00:00:00-05:00',
    to: '2026-11-11T00:00:00-05:00',
  }),
  call('calendar_add', {
    title: 'Dentist',
    start: '2026-11-10T15:00',
    end: '2026-11-10T16:00',
  }),
  call('gmail_send', {
    to: ['front@dentist.example'],
    subject: 'Tuesday at 3',
    text: 'Jeff will see you Tuesday at 3.',
  }),
]
let requests: Asked[] = []
let service = operatorService(
  env,
  held,
  operatorModel((req) => {
    requests.push(req)
    let forked = JSON.stringify(req.items).includes('fork of the')
    let last = req.items.at(-1)
    let done = req.items.filter((i) => i.kind == 'result').length
    let items = !forked
      ? last?.kind == 'user' && /calendar/.test(last.text)
        ? last.text.includes('dentist')
          ? call('fork', { prompt: 'Book the dentist Tuesday at 3.' })
          : reply('Connect it and I will.')
        : reply('Booked, and told the office.')
      : steps[done] ?? reply('Booked the dentist and emailed the office.')
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items,
      cost: 0.001,
    })
  }),
)
env.BUILDER = service.binding
let { store } = service

await receive(
  store,
  { space: eid, person, channel: 'chat' },
  'Can you see my calendar?',
)
await service.drain()
let before = requests.splice(0)
let back = [await connect('google-calendar'), await connect('gmail')]
await receive(
  store,
  { space: eid, person, channel: 'chat' },
  'Put the dentist on my calendar Tuesday at 3 to 4, and email the front desk at front@dentist.example that I will be there.',
)
await service.drain()
let names = (r: Asked) => r.tools.map((t) => t.name)

test('before they connect, the Operator is told where to, and holds no Google tool', () => {
  let [first] = before
  assertStringIncludes(
    first.instructions!,
    '- Google Calendar: not connected. They connect it at https://yaks.app/manage/jeff/connections?add=google-calendar&enable=google-calendar',
  )
  assertStringIncludes(first.instructions!, '- Gmail: not connected.')
  assert(!names(first).some((n) => /^(calendar|gmail)_/.test(n)))
})

test('connected from the page, each names its account, and the Operator uses both in a conversation', async () => {
  assertEquals(back.map((r) => r!.headers.get('location')), [
    'https://yaks.app/manage/jeff/connections?enable=google-calendar&connected=1',
    'https://connect.nango.dev/?session_token=s',
  ])
  let fork = requests.find((r) =>
    JSON.stringify(r.items).includes('fork of the')
  )!
  assertStringIncludes(
    fork.instructions!,
    '- Gmail: connected as jeff@example.com',
  )
  assertEquals(
    ['calendar_events', 'calendar_add', 'gmail_send', 'gmail_read'].map((n) =>
      names(fork).includes(n)
    ),
    [true, true, true, true],
  )
  let [read] = to('/calendars/primary/events?')
  assertEquals(read.headers.get('authorization'), 'Bearer A1')
  assertEquals(
    new URL(read.url).searchParams.get('timeMin'),
    '2026-11-10T05:00:00.000Z',
  )
  let [added] = to('/calendars/primary/events').filter((r) =>
    r.method == 'POST'
  )
  assertEquals((await added.json()).start, {
    dateTime: '2026-11-10T15:00',
    timeZone: 'America/Detroit',
  })
  let [sent] = to('/gmail/v1/users/me/messages/send')
  assertEquals(sent.headers.get('authorization'), 'Bearer G1')
  let raw = (await sent.json()).raw as string
  let letter = atob(raw.replaceAll('-', '+').replaceAll('_', '/'))
  assertStringIncludes(
    letter,
    'To: front@dentist.example\r\nSubject: Tuesday at 3',
  )
  let body = atob(letter.split('\r\n\r\n')[1].replaceAll('\r\n', ''))
  assertStringIncludes(
    new TextDecoder().decode(Uint8Array.from(body, (c) => c.charCodeAt(0))),
    `Jeff will see you Tuesday at 3.\n\n${mailedFor(space, 'Jeff Peterson')}`,
  )
})

test('reading mail is offered by what the connection was granted', async () => {
  let ctx = await operatorContext(env, { person }, space)
  let offered = (await googleTools(env, ctx, space)).map((t) => t.name)
  assert(offered.includes('gmail_read'))
})

test('what Google is asked: an all-day event ends the next day, and a subject beyond ASCII is encoded', () => {
  assertEquals(eventBody({ title: 'Off', start: '2026-12-31' }).end, {
    date: '2027-01-01',
  })
  let letter = atob(
    letterOf({ to: ['a@b.c'], subject: 'Café', text: 'hi' })
      .replaceAll('-', '+').replaceAll('_', '/'),
  )
  assertStringIncludes(letter, 'Subject: =?UTF-8?B?Q2Fmw6k=?=')
  let data = btoa('Hello').replace(/=+$/, '')
  assertEquals(
    messageOf({
      id: 'm',
      payload: {
        headers: [{ name: 'Subject', value: 'Hi' }],
        parts: [{ mimeType: 'text/plain', body: { data } }],
      },
    }).text,
    'Hello',
  )
})
