// The walkthrough component (walkthrough.ts) end to end in one process: a
// demo app released four times in the demo space, a picture kept of each
// release (app_preview `keep`), and a conversation in the space's Operator
// store its person marks walkthrough{app} through the connector (graph_apply
// `self`). A page with the component holds each step's
// exchange beside the picture of the release it ended in, and drops the
// walkthrough while no conversation is marked.
import { test } from '@yaks/testing'
import { line as q } from '@yaks/query'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { toolEid } from '@yaks/tools/result'
import type { Bundle } from '@yaks/graph'
import { valued } from '@yaks/tools/value'
import { resultValue } from './results.ts'
import { connector, fresh, owned } from './probe.ts'
import { directoryOf } from './directory.ts'
import type { Env } from './env.ts'
import { IMAGE, image, made } from './gallery.ts'
import { r2Objects } from './lib/objects.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'
import { stepsOf, Walkthrough } from './site/home.tsx'
import { base64 } from './bytes.ts'
import { sourceReference } from '@yaks/platform/operator-source'

// A picture of each render, told apart by the byte after its PNG signature.
let renders = 0
let png = () =>
  base64(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ++renders]),
  )
let BROWSER = {
  fetch: () =>
    Promise.resolve(Response.json({
      image: png(),
      text: 'Guestbook',
      console: [],
      errors: [],
      status: 200,
      accessibility: {
        engine: 'axe',
        standard: 'wcag21aa',
        problems: [],
        review: [],
      },
      duration: 10,
    })),
}

let env!: Env
let k = await fresh({ BROWSER }, (e) => (env = e))
let dir = directoryOf(env.STORE)
let agent = connector(k, k.owner.cookie)
await owned(k, k.owner.person, 'yourname', 'Demos')
let demo = { space: 'yourname', app: 'guestbook' }
await agent.tool('app_new', {
  ...demo,
  slug: 'guestbook',
  title: 'Guestbook',
  access: 'private',
})

// Each step's request, and the version it released.
let REQUESTS = [
  'A guestbook for Mum’s 70th that anyone with the link can sign.',
  'Let guests add a photo.',
  'Text me when someone signs.',
  'After the party, email everyone who signed a thank-you.',
]
for (let [i] of REQUESTS.entries()) {
  await agent.tool('app_files', {
    ...demo,
    files: [{
      path: 'index.html',
      content: `<h1>Guestbook, step ${i + 1}</h1>`,
    }],
  })
  await agent.tool('app_deploy', { ...demo, message: `step ${i + 1}` })
  await agent.tool('app_preview', { ...demo, released: true, keep: true })
}
await agent.tool('app_publish', { ...demo, name: 'birthday-guestbook' })
await agent.tool('gallery_feature', {
  app: 'yourname/guestbook',
  featured: true,
})

let space = (await dir.space('yourname'))!
let app = (await dir.app(space, 'guestbook'))!
let versions = await dir.deploys(app)

// The demo space's Operator, its store in memory.
let person = k.owner.person
let service = operatorService(
  env,
  { person, role: 'owner', space: space.eid },
  operatorModel(() =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: 'test-model',
      items: [{ kind: 'assistant', text: 'Made the guestbook.' }],
      cost: 0.001,
    })
  ),
)
env.BUILDER = service.binding
await receive(
  service.store,
  { space: space.eid, person, channel: 'chat' },
  REQUESTS[0],
)
await service.drain()
let session = rootOf(space.eid, person)
let { seq: last } = (await service.store.g.read(
  q`.entry.session=${session}&.order=-entry.seq&.limit=1&*`,
))[0].entry as { seq: number }

// The rest of the conversation: each step's release and the Operator's answer,
// and each later step's request before them, each result kept as the
// Operator keeps a call's (results.ts `resultValue`).
let seq = last
let line = (rest: Record<string, unknown>) => ({
  entity: { eid: crypto.randomUUID() },
  entry: { session, seq: ++seq },
  ...rest,
})
// What the second step did besides, none of which was said: a memory
// recalled, a reply written mid-work, the contact list read with its owner's
// address and number, and a Pending line; the third request came by a channel
// that adds a note to the words.
// A background call's interim line (@yaks/session `PENDING`).
let PENDING = 'Pending; its result will follow.'
let NOT_SAID = [
  'Mum is turning 70',
  'Looking at your contacts first.',
  'ada@example.com',
  '+1 555 0100',
  PENDING,
  'Original message text',
]
let unsaid = () => {
  let read = line({ call: { name: 'contact_list', args: {} } })
  return [
    line({
      prompt: { scope: 'local', source: 'operator:earlier' },
      content: { body: NOT_SAID[0] },
    }),
    line({ output: {}, content: { body: NOT_SAID[1] } }),
    read,
    line({
      tool_progress: { call: read.entity.eid },
      content: { body: PENDING },
    }),
    line({
      result: {
        call: read.entity.eid,
        value: { contacts: NOT_SAID.slice(2, 4) },
      },
      content: { body: `Ada <${NOT_SAID[2]}> ${NOT_SAID[3]}` },
    }),
  ]
}
let rows = REQUESTS.flatMap((said, i) => {
  let body = i == 2 ? said + sourceReference('a'.repeat(64)) : said
  let asked = i ? [line({ content: { body } }), ...i == 1 ? unsaid() : []] : []
  let call = line({
    call: {
      to: toolEid('app_deploy'),
      name: 'app_deploy',
      args: { space: 'yourname', app: 'guestbook' },
    },
  })
  return [
    ...asked,
    call,
    line({
      result: {
        call: call.entity.eid,
        value: resultValue(
          [valued(call, { deployed: true, version: i + 1 })],
          { name: 'app_deploy' } as never,
        ),
      },
      content: { body: `deployed yourname/guestbook v${i + 1}` },
    }),
    line({ output: {}, content: { body: `Released step ${i + 1}.` } }),
  ]
})
await service.store.g.apply(rows, { trusted: true })

let file = renderToString(
  h('main', null, h(Walkthrough, {}), h('p', { id: 'after' }, 'after')),
)
let served = async () =>
  parseHTML(
    await (await made(env, dir, new Response(file))).text(),
  )
    .document

test('a page shows no walkthrough while no conversation is marked one', async () => {
  let document = await served()
  assertEquals(document.querySelector('.Walk'), null)
  assert(document.querySelector('#after'))
})

test("each step of a marked conversation is served beside its release's picture", async () => {
  let { value } = await agent.answer('graph_apply', {
    space: 'yourname',
    self: true,
    bundles: [{ entity: { eid: session }, walkthrough: { app: 'guestbook' } }],
  })
  assertEquals(
    (value?.bundles as Bundle[]).map((b) => b.walkthrough),
    [{ app: 'guestbook' }],
  )
  let steps = stepsOf('guestbook')
  assertEquals(steps.length, REQUESTS.length)
  let document = await served()
  let walk = document.querySelector('.Walk_App[data-walk="guestbook"]')!
  assert(walk)
  let shots = new Set<string>()
  for (let [i, step] of steps.entries()) {
    let li = walk.querySelector(`[data-walk-step="${step}"]`)!
    let talk = li.querySelector('.Walk_Talk')!
    assertStringIncludes(talk.textContent!, REQUESTS[i])
    // The Operator's reply is its last words in the step, not those it wrote
    // before them.
    assertStringIncludes(talk.textContent!, `Released step ${i + 1}.`)
    assert(!talk.textContent!.includes('Made the guestbook.'))
    // Only what was said: no call, result, memory, progress or mid-work
    // reply, and the words without their channel's note.
    assertEquals(talk.querySelectorAll('.More_Summary').length, 0)
    for (let unsaid of NOT_SAID) {
      assert(!talk.innerHTML.includes(unsaid), unsaid)
    }
    // Only this step's exchange: the next step's request is not in it.
    if (REQUESTS[i + 1]) assert(!talk.textContent!.includes(REQUESTS[i + 1]))
    let release = versions.find((v) => v.version == i + 1)!
    assert(release.screenshot)
    let src = li.querySelector('.Walk_Image')!.getAttribute('src')!
    assertEquals(
      src,
      `https://yaks.app${IMAGE}${app.eid}/${release.screenshot}`,
    )
    shots.add(src)
    // The picture is served to anyone while the app is featured.
    let picture = await image(dir, r2Objects(env.BLOBS), new URL(src).pathname)
    assertEquals(picture.status, 200)
    assertEquals(picture.headers.get('content-type'), 'image/png')
    // On a phone a step reads down: its words, its exchange, then the app,
    // and the box to ask for a change of the visitor's own, which names the
    // demo and the step.
    assertEquals(
      [...li.querySelectorAll('.Walk_Copy, .Walk_Talk, .Walk_Shot, .Walk_Ask')]
        .map((e) => e.className),
      ['Walk_Copy', 'Walk_Talk', 'Walk_Shot', 'Walk_Ask'],
    )
    let ask = li.querySelector('form.Walk_Ask')!
    assertEquals(ask.getAttribute('action'), '/start')
    assertEquals(
      [...ask.querySelectorAll('input[type="hidden"]')]
        .map((e) => [e.getAttribute('name'), e.getAttribute('value')]),
      [['demo', 'guestbook'], ['step', step]],
    )
  }
  assertEquals(shots.size, REQUESTS.length)
})
