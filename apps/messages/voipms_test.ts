// Messages on the church's own voip.ms line, through the kernel's own doors:
// the account is connected as the church's owners connect it, the app holds
// its number, and voip.ms is faked at the fetch it is called through. A text
// goes out from that number, a reply comes back by voip.ms's callback to the
// inbox, the keywords are answered, and every way a send goes wrong says so
// per person. No text leaves this process.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import { client, connector, fresh, seed } from '../../workers/yak/probe.ts'
import type { Env } from '../../workers/yak/env.ts'
import { directoryOf } from '../../workers/yak/directory.ts'
import { connecting } from '../../workers/yak/connections.ts'
import { seal } from '../../workers/yak/lib/token.ts'
import { answers } from '../../workers/yak/app-texts.ts'
import {
  broadcastBundles,
  conversations,
  FILTERS,
  gather,
  helpBundles,
  joinBundles,
  reach,
  recipients,
  replyBundles,
  resendBundles,
} from './model.js'

let FILES = [
  'index.html',
  'app.js',
  'model.js',
  'views.js',
  'html.js',
  'theme.js',
  'style.css',
  'icon.svg',
  'seed.json',
  'vocab.json',
]
let read = (path: string) =>
  Deno.readTextFileSync(new URL(`./${path}`, import.meta.url))
let DIRECTORY = {
  $defs: {
    individual: {
      properties: Object.fromEntries(
        ['slug', 'first', 'middle', 'last', 'nickname', 'suffix', 'phone']
          .concat(['status'])
          .map((k) => [k, { type: 'string' }])
          .concat([['deceased', { type: 'boolean' }]]),
      ),
    },
    congregation: {
      properties: Object.fromEntries(
        ['name', 'phone', 'accent', 'paper', 'heading_font', 'body_font'].map((
          k,
        ) => [k, { type: 'string' }]),
      ),
    },
  },
}

// Invented numbers: the church's line, its office, and five people. Dee's is
// one voip.ms will not text; Eve's is one it is down for.
let LINE = '+12695550199', OFFICE = '(269) 555-0100'
let [ANA, BO, CY, DEE, EVE] = [42, 43, 44, 45, 46].map((n) =>
  `+1269555${String(n).padStart(4, '0')}`
)
let ten = (n: string) => n.slice(2)

// voip.ms as the account answers it: the numbers it holds, every text asked
// of sendSMS and sendMMS, and a day's limit that runs out after `allowed`.
let asked: { method: string; did: string; dst: string; message: string }[] = []
let faults: Record<string, string> = {}
let allowed = Infinity
let voipms = (url: URL) => {
  let q = url.searchParams
  let method = q.get('method')!
  if (q.get('api_password') != 'pw') {
    return Response.json({ status: 'invalid_credentials' })
  }
  if (method == 'getDIDsInfo') {
    return Response.json({
      status: 'success',
      dids: [{ did: ten(LINE), description: 'Texting', sms_enabled: '1' }],
    })
  }
  asked.push({
    method,
    did: q.get('did')!,
    dst: q.get('dst')!,
    message: q.get('message')!,
  })
  let fault = faults[q.get('dst')!]
  if (fault == 'down') return new Response('', { status: 503 })
  if (fault) return Response.json({ status: fault })
  if (asked.length > allowed) return Response.json({ status: 'limit_reached' })
  return Response.json({ status: 'success', sms: 9000 + asked.length })
}

test('Messages texts a list from the church’s voip.ms line, hears the replies, and says what went wrong', async () => {
  let real = globalThis.fetch
  globalThis.fetch = (input, init) => {
    let url = new URL(input instanceof Request ? input.url : String(input))
    return url.host == 'voip.ms'
      ? Promise.resolve(voipms(url))
      : real(input, init)
  }
  let env!: Env
  let k = await fresh({
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  }, (e) => void (env = e))
  try {
    let space = `church${crypto.randomUUID().slice(0, 8)}`
    let them = await seed(k, [{ slug: space, apps: ['directory', 'messages'] }])
    let agent = connector(k, them.cookie)
    let at = (app: string) => ({ space, app })
    await agent.tool('app_files', {
      ...at('directory'),
      files: [{ path: 'vocab.json', content: JSON.stringify(DIRECTORY) }],
    })
    await agent.tool('app_deploy', at('directory'))
    await agent.tool('app_files', {
      ...at('messages'),
      files: FILES.map((path) => ({ path, content: read(path) })),
    })
    await agent.tool('app_deploy', at('messages'))

    // The owners connect the church's voip.ms account; the app is given the
    // line it lists.
    let form = new FormData()
    for (
      let [name, value] of Object.entries({
        do: 'add',
        integration: 'voipms',
        'key.username': 'office@example.org',
        'key.password': 'pw',
      })
    ) form.set(name, value)
    let dir = directoryOf(env.STORE)
    let held = (await dir.at(them.eids[space]))!
    await connecting(
      new Request(`https://yaks.app/manage/connections?space=${space}`),
      env,
      held,
      { person: them.person, role: 'owner' },
      form,
    )
    await k.dir.stamp({
      entities: [{
        entity: { eid: them.eids[`${space}/messages`] },
        phone: { number: LINE },
        app: { access: 'private' },
      }],
    })

    let host = `${space}.yaks.app`
    let [ana, bo, cy, dee, eve] = [0, 1, 2, 3, 4].map(() => crypto.randomUUID())
    let person = (eid: string, first: string, phone: string) => ({
      entity: { eid },
      individual: { first, last: 'Yoder', phone },
    })
    await client(k, host, 'directory', them.cookie).applied({
      entities: [
        {
          entity: { eid: '$church' },
          congregation: { name: 'Locust Grove', phone: OFFICE },
        },
        person(ana, 'Ana', ANA),
        person(bo, 'Bo', BO),
        person(cy, 'Cy', CY),
        person(dee, 'Dee', DEE),
        person(eve, 'Eve', EVE),
      ],
    })
    let office = client(k, host, 'messages', them.cookie)
    let picture = async () =>
      gather(
        (await Promise.all(Object.values(FILTERS).map((f) => office.get(f))))
          .flat(),
      )
    let m = await picture()
    let general = [...m.groups.values()].find((g) => g.name == 'General')!.eid

    // Adding people to a list and taking one off.
    await office.applied({
      entities: joinBundles(m, general, [ana, bo, cy, dee, eve]),
    })
    m = await picture()
    assertEquals(m.groups.get(general)!.members.length, 5)
    let [cyship] = m.groups.get(general)!.members.filter((
      x: { person: { eid: string } },
    ) => x.person.eid == cy)
    await office.applied({
      entities: [{ entity: { eid: cyship.eid }, tombstone: {} }],
    })
    m = await picture()
    assertEquals(m.groups.get(general)!.members.length, 4)
    assertEquals(
      recipients(m, general).to.map((p) => p.eid).sort(),
      [ana, bo, dee, eve].sort(),
    )

    let send = async (body: string) => {
      let eid = crypto.randomUUID()
      asked.length = 0
      await office.applied({
        entities: broadcastBundles(m, general, body, eid),
      })
      await k.settled()
      m = await picture()
      return reach(m, eid)
    }
    let outcome = (r: ReturnType<typeof reach>) =>
      Object.fromEntries(
        Object.entries(r).map(([state, xs]) => [
          state,
          xs.map((x: { person?: { eid: string } }) => x.person?.eid).sort(),
        ]),
      )

    // A group text goes out of the church's line, one text each, to the
    // listed people only; Dee's number and Eve's line fail, each told apart.
    faults[ten(DEE)] = 'invalid_dst'
    faults[ten(EVE)] = 'down'
    let first = await send('Prayer meeting moved to 7.')
    assertEquals(
      [...new Set(asked.map((a) => [a.method, a.did, a.dst, a.message] + ''))]
        .sort(),
      [ANA, BO, DEE, EVE].map((n) =>
        ['sendSMS', ten(LINE), ten(n), 'Prayer meeting moved to 7.'] + ''
      ).sort(),
    )
    assertEquals(outcome(first), {
      delivered: [ana, bo].sort(),
      bounced: [dee],
      sending: [eve],
    })
    assertStringIncludes(first.bounced[0].text.reason, 'landline')
    assertStringIncludes(first.sending[0].text.reason, 'not answering')

    // Over 160 characters it is one picture message; past 2,048 it is not sent.
    delete faults[ten(DEE)]
    delete faults[ten(EVE)]
    await send('x'.repeat(161))
    assert(asked.length > 0 && asked.every((a) => a.method == 'sendMMS'))

    // The day's limit runs out part way: those it took are sent, the rest say
    // why, and sending again reaches only them.
    allowed = 2
    let limited = await send('Potluck Sunday.')
    assertEquals(limited.delivered.length, 2)
    assertEquals(limited.bounced.length, 2)
    assertStringIncludes(limited.bounced[0].text.reason, '100 texts a day')
    let broadcast = [...m.broadcasts.values()].find((b) =>
      b.body == 'Potluck Sunday.'
    )!
    allowed = Infinity
    asked.length = 0
    await office.applied({ entities: resendBundles(m, broadcast.eid) })
    await k.settled()
    m = await picture()
    assertEquals(asked.length, 2)
    assertEquals(reach(m, broadcast.eid).bounced, [])
    assertEquals(reach(m, broadcast.eid).delivered.length, 4)

    // A failure nobody expected is said in words (the pool reports it).
    faults[ten(ANA)] = 'sms_failed'
    let odd = await send('Choir is at 6.')
    assertEquals(odd.bounced.map((x) => x.person?.eid), [ana])
    assertStringIncludes(odd.bounced[0].text.reason, 'reported')
    delete faults[ten(ANA)]

    // A reply comes in by voip.ms's callback, to the person and the thread.
    let ticket = await seal('line', {
      connection: await connectionOf(env),
    }, env.SESSION_SECRET!)
    let textIn = async (id: string, from: string, text: string) => {
      let r = await k.at(
        'yaks.app',
        `/voipms/${ticket}?id=${id}&from=${ten(from)}&to=${ten(LINE)}&message=${
          encodeURIComponent(text)
        }`,
      )
      assertEquals([r.status, r.status == 200 ? '' : await r.text()], [200, ''])
      await k.settled()
      m = await picture()
    }
    await textIn('in-1', ANA, 'Amen, see you there')
    let [thread] = conversations(m)
    assertEquals([thread.name, thread.waiting], ['Ana Yoder', 1])

    // Staff answer that one person, from the line.
    asked.length = 0
    await office.applied({ entities: replyBundles(m, thread, 'Thank you!') })
    await k.settled()
    m = await picture()
    assertEquals(asked.map((a) => [a.did, a.dst, a.message]), [
      [ten(LINE), ten(ANA), 'Thank you!'],
    ])
    assertEquals(conversations(m)[0].waiting, 0)

    // HELP names the church and its office; every STOP word opts Bo out, once
    // and out of every later send; START puts Bo back.
    // The page keeps the directory's office number where the platform reads it.
    await office.applied({ entities: helpBundles(m) })
    assertEquals(helpBundles(await picture()), [])
    let said = answers(held.title || held.slug, OFFICE)
    asked.length = 0
    await textIn('in-2', BO, 'help')
    assertEquals(asked.length, 1)
    assertStringIncludes(asked[0].message, OFFICE)
    assertStringIncludes(asked[0].message, 'STOP')
    for (
      let word of ['STOP', 'stopall', 'Unsubscribe', 'cancel', 'END', 'quit']
    ) {
      asked.length = 0
      await textIn(`stop-${word}`, BO, word)
      assertEquals(asked.length, 1, word)
      assertEquals(asked[0].message, said.stop)
      assertEquals(
        recipients(m, general).to.map((p) => p.eid).includes(bo),
        false,
      )
      assertEquals(
        recipients(m, general).left.map((l) => l.why),
        ['opted out (texted STOP)'],
      )
      if (word == 'STOP') {
        // Every later send skips Bo.
        let after = await send('Choir is cancelled.')
        assertEquals(asked.map((a) => a.dst).includes(ten(BO)), false)
        assertEquals(
          after.delivered.length + after.bounced.length + after.sending.length,
          3,
        )
      }
      await textIn(`start-${word}`, BO, 'START')
      assertEquals(
        recipients(m, general).to.map((p) => p.eid).includes(bo),
        true,
      )
    }
    // The same text posted twice is answered once.
    asked.length = 0
    await textIn('dup', BO, 'HELP')
    await textIn('dup', BO, 'HELP')
    assertEquals(asked.length, 1)

    // A YES answers a text and is no reply for the office to read as START;
    // from someone who said STOP it opts them in again.
    asked.length = 0
    await textIn('yes-ana', ANA, 'Yes')
    assertEquals(asked.length, 0)
    await textIn('stop-yes', BO, 'STOP')
    asked.length = 0
    await textIn('yes-bo', BO, 'Yes')
    assertEquals(asked.map((a) => a.message), [said.start])
    assertEquals(recipients(m, general).to.map((p) => p.eid).includes(bo), true)

    // A number nobody here has, and anyone who texts JOIN, reaches sign-up.
    // The Operator is the Builder behind the space; here it only records.
    let signups: string[] = []
    let builder = env.BUILDER
    env.BUILDER = {
      ...builder,
      idFromName: (name: string) => builder.idFromName(name),
      get: () => ({
        fetch: async (req: Request) => {
          if (new URL(req.url).pathname != '/operator/signup') {
            return new Response('no', { status: 404 })
          }
          signups.push((await req.json()).request.address)
          return new Response('{}', { status: 202 })
        },
      }),
    } as unknown as typeof env.BUILDER
    await textIn('new-1', '+12695550177', 'I want to sign up')
    await textIn('join-1', ANA, 'join')
    await textIn('known-1', CY, 'See you at 6')
    assertEquals(signups, ['+12695550177', ANA])
    env.BUILDER = builder

    // No text from here went to anyone but the people listed.
    assert(!k.reported.length, JSON.stringify(k.reported))
  } finally {
    globalThis.fetch = real
    await k.stop()
  }
})

// The connection the church's voip.ms account was saved as.
let connectionOf = async (env: Env) => {
  let { ctxOf } = await import('../../workers/yak/connections.ts')
  let [line] = await ctxOf(env).graph.read(
    `.connection.integration=voipms&.connection.status=connected&*`,
  )
  return line.entity.eid
}
