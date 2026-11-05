// The app beside a church directory in one space, through the kernel's own
// doors: Messages reads the directory's people as its own, keeps its lists,
// and texts them through Telnyx at its HTTP boundary — in its pilot from the
// platform's number, then from the church's own, where replies come back to
// its inbox and STOP and HELP are answered.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { client, connector, fresh, seed } from '../../workers/yak/probe.ts'
import { endpoints } from '../../workers/yak/endpoints.ts'
import { texts } from '../../workers/yak/operator-texts.ts'
import { answers, PILOT } from '../../workers/yak/app-texts.ts'
import {
  broadcastBundles,
  conversations,
  FILTERS,
  gather,
  joinBundles,
  reach,
  recipients,
  replyBundles,
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

// The directory's own words for its people and its church, as it declares them.
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

// Telnyx at its HTTP boundary: the "yaks.app" profile's toll-free number, and
// every text posted to it.
let ANA = '+12695550142', BO = '+12695550143', CHURCH = '+12695550199'
let FREE = '+18885550100'
let texted: { from: string; to: string; text: string }[] = []
let telnyx = endpoints(globalThis).open(async (req) => {
  let path = new URL(req.url).pathname
  if (path == '/messaging_profiles') {
    return Response.json({ data: [{ id: 'profile-1' }] })
  }
  if (path.endsWith('/phone_numbers')) {
    return Response.json({ data: [{ phone_number: FREE }] })
  }
  let sent = await req.json()
  texted.push({ from: sent.from, to: sent.to, text: sent.text })
  return Response.json({ data: { id: `msg-${texted.length}` } })
})
let signer = await crypto.subtle.generateKey('Ed25519', true, [
  'sign',
  'verify',
]) as CryptoKeyPair
let b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))

test('Messages texts a list from the church, keeps the replies, and answers STOP and HELP', async () => {
  let k = await fresh({
    TELNYX_API: telnyx.url,
    TELNYX_API_KEY: 'a-key',
    TELNYX_PUBLIC_KEY: b64(
      await crypto.subtle.exportKey('raw', signer.publicKey),
    ),
  })
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

    let host = `${space}.yaks.app`
    let [ana, bo, cy] = [0, 1, 2].map(() => crypto.randomUUID())
    await client(k, host, 'directory', them.cookie).applied({
      entities: [
        { entity: { eid: '$church' }, congregation: { name: 'Locust Grove' } },
        {
          entity: { eid: ana },
          individual: { first: 'Ana', last: 'Yoder', phone: '(269) 555-0142' },
        },
        {
          entity: { eid: bo },
          individual: { first: 'Bo', last: 'Miller', phone: '269-555-0143' },
        },
        { entity: { eid: cy }, individual: { first: 'Cy', last: 'Hart' } },
      ],
    })

    let office = client(k, host, 'messages', them.cookie)
    let picture = async () =>
      gather(
        (await Promise.all(Object.values(FILTERS).map((f) => office.get(f))))
          .flat(),
      )
    let m = await picture()
    assertEquals(m.church?.name, 'Locust Grove')
    assertEquals([...m.groups.values()].map((g) => g.name).sort(), [
      'General',
      'Prayer',
    ])
    let general = [...m.groups.values()].find((g) => g.name == 'General')!.eid
    await office.applied({ entities: joinBundles(m, general, [ana, bo, cy]) })
    m = await picture()
    assertEquals(
      recipients(m, general).to.map((p) => p.eid).sort(),
      [ana, bo].sort(),
    )
    assertEquals(recipients(m, general).left.map((l) => l.why), [])

    let send = async (body: string) => {
      let eid = crypto.randomUUID()
      await office.applied({
        entities: broadcastBundles(m, general, body, eid),
      })
      await k.settled()
      m = await picture()
      return reach(m, eid)
    }

    // The pilot: no number of the church's own, so only someone who agreed to
    // the platform's texts is texted, from its number. Ana did, as the owner.
    await k.dir.stamp({ entities: texts(them.person, ANA, true) })
    let pilot = await send('Prayer meeting moved to 7.')
    assertEquals(texted.splice(0), [{
      from: FREE,
      to: ANA,
      text: 'Locust Grove: Prayer meeting moved to 7.',
    }])
    assertEquals(pilot.delivered.map((d) => d.person?.eid), [ana])
    assertEquals(pilot.bounced.map((d) => [d.person?.eid, d.text.reason]), [
      [bo, PILOT],
    ])

    // The church's own number, registered: everyone on the list is texted
    // from it.
    await k.dir.stamp({
      entities: [{
        entity: { eid: them.eids[`${space}/messages`] },
        phone: { number: CHURCH },
      }],
    })
    let live = await send('Potluck Sunday after service.')
    assertEquals(texted.splice(0).map((t) => [t.from, t.to]).sort(), [
      [CHURCH, ANA],
      [CHURCH, BO],
    ])
    assertEquals(live.delivered.length, 2)

    let textIn = async (id: string, from: string, text: string) => {
      let body = JSON.stringify({
        data: {
          event_type: 'message.received',
          payload: {
            id,
            type: 'SMS',
            text,
            from: { phone_number: from },
            to: [{ phone_number: CHURCH }],
          },
        },
      })
      let t = String(Math.floor(Date.now() / 1000))
      let signature = b64(
        await crypto.subtle.sign(
          'Ed25519',
          signer.privateKey,
          new TextEncoder().encode(`${t}|${body}`),
        ),
      )
      let r = await k.at('yaks.app', '/telnyx/webhook', {
        method: 'POST',
        headers: {
          'telnyx-timestamp': t,
          'telnyx-signature-ed25519': signature,
        },
        body,
      })
      assertEquals(r.status, 200)
      await k.settled()
      m = await picture()
    }

    // A reply lands in the inbox, waiting for an answer.
    await textIn('in-1', ANA, 'Amen, see you there')
    let [thread] = conversations(m)
    assertEquals([thread.name, thread.waiting], ['Ana Yoder', 1])
    assertEquals(texted.splice(0), [])

    // The office answers it, from the church's number, and it is answered.
    await office.applied({ entities: replyBundles(m, thread, 'Thank you!') })
    await k.settled()
    m = await picture()
    assertEquals(texted.splice(0), [{
      from: CHURCH,
      to: ANA,
      text: 'Thank you!',
    }])
    assertEquals(conversations(m)[0].waiting, 0)

    // HELP and STOP are answered at once in the church's name; STOP takes
    // Bo off every broadcast after it.
    let said = answers(space)
    await textIn('in-2', BO, 'help')
    await textIn('in-3', BO, 'STOP')
    assertEquals(texted.splice(0), [
      { from: CHURCH, to: BO, text: said.help },
      { from: CHURCH, to: BO, text: said.stop },
    ])
    assertEquals(
      recipients(m, general).left.map((l) => [l.person.eid, l.why]),
      [
        [bo, 'texted STOP'],
      ],
    )
    await send('Choir practice is cancelled.')
    assertEquals(texted.splice(0).map((t) => t.to), [ANA])

    let page = await k.at(host, '/messages/')
    assertEquals(page.status, 200)
    assertStringIncludes(await page.text(), 'Opening messages')
    assert(!k.reported.length, JSON.stringify(k.reported))
  } finally {
    await k.stop()
  }
})
