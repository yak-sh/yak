import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { durable } from '../../packages/durable-object/testing.ts'
import { derivedEid } from '@yaks/graph/identity'
import type { Item, Model, Request } from '@yaks/model'
import { directoryOf } from './directory.ts'
import { modelPage, platform } from './testing.ts'
import { operatorModel } from './operator-testing.ts'
import { operatorStore } from './operator-store.ts'
import {
  authenticated,
  handleChannels,
  keepFile,
  receive,
} from './operator-channels.ts'
import { runOperator } from './operator.ts'
import { operatorContext } from './operator.ts'
import { TOOLS } from './tools.ts'
import { conversation, operatorPage } from './operator-page.ts'
import { operatorDoor } from './operator-page.ts'
import { arrived, Refused } from './inbox.ts'
import type { Inbound } from './env.ts'

let fixture = async () => {
  let p = platform('operator-intake')
  let dir = directoryOf(p.env.STORE)
  let person = crypto.randomUUID(), eid = crypto.randomUUID()
  await dir.apply({
    entities: [
      {
        entity: { eid: person },
        person: {},
        email: { address: 'clerk@example.com' },
      },
      {
        entity: { eid },
        space: { slug: 'clerk', store: 'clerk' },
        doc: { title: 'Township' },
      },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person, space: eid, role: 'owner' },
      },
    ],
  }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
  let space = (await dir.at(eid))!
  let raw = durable()
  let store = operatorStore(raw)
  let held = { person, role: 'owner' as const, space: eid }
  let ctx = operatorContext(p.env, held, space)
  await TOOLS.find((t) => t.name == 'app_new')!.run(ctx, {
    slug: 'notices',
    title: 'Notices',
  })
  await TOOLS.find((t) => t.name == 'app_files')!.run(ctx, {
    app: 'notices',
    files: [
      { path: 'index.html', content: '<h1>Notices</h1>' },
      {
        path: 'vocab.json',
        content: JSON.stringify({
          $defs: { meeting: { properties: { title: { type: 'string' } } } },
          imports: ['blob'],
        }),
      },
    ],
  })
  await TOOLS.find((t) => t.name == 'app_deploy')!.run(ctx, { app: 'notices' })
  return { ...p, dir, space, person, raw, store, held, ctx }
}
let f = await fixture()
let asks: Request[] = []
let call = (
  name: string,
  args: unknown,
): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let notice = crypto.randomUUID()
let script = [
  call('graph_schema', { component: 'meeting' }),
  call('graph_query', { q: '.meeting&*' }),
  call('graph_apply', {
    bundles: [{
      entity: { eid: notice },
      meeting: { title: 'Road millage: Thursday at 7' },
    }],
  }),
  [{ kind: 'assistant', text: 'The road millage notice is posted.' } as Item],
]
let model: Model = (req) => {
  asks.push(req)
  return Promise.resolve({
    id: crypto.randomUUID(),
    model: req.model,
    items: script.shift() ??
      [{ kind: 'assistant', text: 'Which date and time?' }],
    cost: 0.001,
  })
}
let options = operatorModel(model)
let sent: string[] = []
handleChannels(f.store, f.env, options, {
  chat: (_request, answer) => {
    sent.push(answer.text)
    return Promise.resolve({})
  },
})
let id = await receive(f.store, {
  space: f.space.eid,
  person: f.person,
  channel: 'chat',
}, 'Post a special meeting Thursday at 7 about the road millage.')
await f.store.fx.work(f.store.g)
await f.store.fx.idle()
let [result] = await f.store.g.get([id])
let task = (result.operator_answer as { task: string }).task

let { reaching } = await import('./agent.ts')
let { inReach } = await import('./declared.ts')
let graph = await reaching(f.ctx, await inReach(f.ctx))
let posted = (await graph.get([notice]))[0]
let charged = (await f.dir.at(f.space.eid))!.meter!.models
let count = asks.length
let duplicate = await receive(
  f.store,
  { space: f.space.eid, person: f.person, channel: 'chat' },
  'duplicate',
  { id },
)
await f.store.fx.work(f.store.g)
let session = derivedEid('operator-session|' + id)
await runOperator(
  f.store,
  f.env,
  f.held,
  f.space,
  { say: 'Post the notice.' },
  { ...options, session, task },
)
let afterResume = asks.length
let sessions = await f.store.g.read('.session')
let pending = await receive(f.store, {
  space: f.space.eid,
  person: f.person,
  channel: 'chat',
}, 'Continue this request')
let [effect] = await f.store.g.read(`.effect.target=${pending}`)
await f.store.g.apply([{
  entity: effect.entity,
  effect: { attempts: 1, state: 'pending' },
}], { trusted: true })
let reopened = operatorStore(f.raw)
handleChannels(reopened, f.env, options)
await reopened.fx.work(reopened.g)
let [recovered] = await reopened.g.get([pending])

test('chat reaches the scoped operator, changes app rows, answers and charges the space', () => {
  assertEquals(sent, ['The road millage notice is posted.'])
  assertEquals(!!result.delivered, true)
  assertEquals(count, 4)
  assertEquals(posted.meeting, { title: 'Road millage: Thursday at 7' })
  assertEquals(charged, 0.004)
})
test('redelivering a request and resuming its committed transcript do not repeat app changes', () => {
  assertEquals(duplicate, id)
  assertEquals(afterResume, count)
  assertEquals(sessions.length, 1)
})
test('the same intake recovers a recorded interrupted effect after reopening its store', () => {
  assertEquals(!!recovered.operator_answer, true)
  assertEquals(!!recovered.delivered, true)
})

test('an email needs the receiving MTA DMARC pass aligned with the member From', () => {
  assertEquals(
    authenticated(
      'mx.cloudflare.net; dmarc=pass header.from=example.com; dkim=pass',
      'clerk@example.com',
    ),
    true,
  )
  for (
    let header of [
      null,
      'mx.cloudflare.net; dkim=pass header.d=evil.com',
      'evil.com; dmarc=pass header.from=example.com',
      'mx.cloudflare.net; dmarc=fail header.from=example.com, mx.cloudflare.net; dmarc=pass header.from=example.com',
      'mx.cloudflare.net; dmarc=pass header.from=evil.com',
    ]
  ) {
    assertEquals(authenticated(header, 'clerk@example.com'), false)
  }
})

let page = await operatorPage(
  new Request('https://yaks.app/manage/operator?space=clerk'),
  f.env,
  f.space,
  f.held,
)
let html = await page.text()
test('the operator page names its email address, keeps a durable draft and draws kept answers', () => {
  assertStringIncludes(html, 'clerk@yaks.app')
  assertStringIncludes(html, 'browserDrafts')
  assertStringIncludes(
    conversation([result]),
    'The road millage notice is posted.',
  )
  assertEquals(
    conversation([{
      ...result,
      operator_answer: null,
      failed: { reason: 'interrupted' },
    }]).includes('data-pending'),
    false,
  )
})

let textsAt = 'https://yaks.app/manage/operator?space=clerk&texts=1'
let choose = async (fields: Record<string, string>) => {
  let body = new FormData()
  for (let [k, v] of Object.entries(fields)) body.set(k, v)
  let response = await operatorPage(
    new Request(textsAt, { method: 'POST', body }),
    f.env,
    f.space,
    f.held,
  )
  return { status: response.status, said: await response.json() }
}
let unticked = await choose({ number: '269-555-0142' })
let wrong = await choose({ number: '555-0142', agreed: 'yes' })
let agreed = await choose({ number: '(269) 555-0142', agreed: 'yes' })
let textsHtml = await (await operatorPage(
  new Request('https://yaks.app/manage/operator?space=clerk'),
  f.env,
  f.space,
  f.held,
)).text()
let stopped = await choose({ stop: '1', number: '269-555-0142' })
test('a person agrees to texts with a ticked box and a mobile number, and stops them', () => {
  assertEquals(unticked.status, 400)
  assertStringIncludes(unticked.said.message, 'Tick the box')
  assertEquals(wrong.status, 400)
  assertEquals(agreed.said.number, '+12695550142')
  assertStringIncludes(agreed.said.consent, 'Msg & data rates may apply')
  assertStringIncludes(textsHtml, '269-555-0142')
  assertEquals(textsHtml.includes('checked'), false)
  assertEquals(stopped.said, null)
})

let draft = async (text?: string, over = '') => {
  let { operatorDoor } = await import('./operator-page.ts')
  return operatorDoor(
    f.env,
    f.space,
    f.held,
    'draft',
    text === undefined
      ? {}
      : { bundles: [{ draft: { text }, typed: { over } }] },
  ) as Promise<{ bundles: { draft: { text: string } }[] }>
}
await draft('Post the meeting')
await draft('Post the special meeting', 'Post the meeting')
await draft('Post the meeting Thursday', 'Post the meeting')
let savedDraft = await draft()
test('chat drafts persist at the operator door and merge concurrent edits', () => {
  assertEquals(
    savedDraft.bundles[0].draft.text,
    'Post the special meeting Thursday',
  )
})

let file = await keepFile(
  f.env,
  f.space,
  'minutes.txt',
  'text/plain',
  new TextEncoder().encode('The board approved the road millage.'),
)
let attachmentRequests: Request[] = []
let attachmentStore = operatorStore(durable())
handleChannels(
  attachmentStore,
  f.env,
  operatorModel((req) => {
    attachmentRequests.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Read the minutes.' }],
      cost: 0,
    })
  }),
)
let attachmentId = await receive(attachmentStore, {
  space: f.space.eid,
  person: f.person,
  channel: 'chat',
  files: [file],
}, 'Read these minutes.')
await attachmentStore.fx.work(attachmentStore.g)
let original = new TextDecoder().decode(
  await (await f.env.BLOBS.get(file.key))!.arrayBuffer(),
)
let attachmentAnswer =
  (await attachmentStore.g.get([attachmentId]))[0].operator_answer
test('attachment contents reach the model and the original is retained for publishing', () => {
  assertStringIncludes(
    JSON.stringify(attachmentRequests[0].items),
    'The board approved the road millage.',
  )
  assertEquals(
    attachmentRequests[0].tools.some((t) => t.name == 'operator_attachment'),
    true,
  )
  assertEquals(
    original,
    'The board approved the road millage.',
  )
  assertEquals(
    !!attachmentAnswer,
    true,
  )
})

let letters: {
  to: string
  subject: string
  text?: string
  headers?: Record<string, string>
}[] = []
f.env.OPERATOR_MODEL = '@cf/test/operator'
f.env.MODEL_FETCH = () =>
  Promise.resolve(new Response('$1 per M input tokens, $2 per M output tokens'))
f.env.AI = {
  gateway: () => ({ getUrl: () => Promise.resolve('https://unused') }),
  run: () =>
    Promise.resolve({
      response: 'Which date and time?',
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
}
f.env.MAIL = {
  send: (letter) => {
    letters.push(letter)
    return Promise.resolve({ messageId: `reply-${letters.length}` })
  },
}
let email = (id: string, reply?: string, authenticated = true): Inbound => {
  let headers = new Headers({
    From: 'clerk@example.com',
    To: 'clerk@yaks.app',
    Subject: 'Special meeting',
    'Message-ID': `<${id}>`,
    'Content-Type': 'text/plain',
    'Authentication-Results': authenticated
      ? 'mx.cloudflare.net; dmarc=pass header.from=example.com; dkim=pass'
      : 'mx.cloudflare.net; dkim=pass header.d=evil.com',
    ...(reply ? { 'In-Reply-To': `<${reply}>` } : {}),
  })
  return {
    from: 'clerk@example.com',
    to: 'clerk@yaks.app',
    headers,
    raw: new Response(
      [...headers].map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\nSchedule the special meeting.',
    ).body!,
    setReject: () => {},
  }
}
let firstEmail = await arrived(email('request-1'), f.env)
await f.builder(f.space.eid).alarm()
let duplicateEmail = await arrived(email('request-1'), f.env)
await f.builder(f.space.eid).alarm()
let secondEmail = await arrived(email('request-2', 'reply-1'), f.env)
await f.builder(f.space.eid).alarm()
let messages = await operatorDoor(
  f.env,
  f.space,
  f.held,
  'messages',
  {},
) as import('@yaks/graph').Bundle[]
let emailTask =
  (messages.find((row) => row.entity.eid == firstEmail)!.operator_answer as {
    task: string
  }).task
let followedTask =
  (messages.find((row) => row.entity.eid == secondEmail)!.operator_answer as {
    task: string
  }).task
let emailMeter = (await f.dir.at(f.space.eid))!.meter!.emails
let rejected: unknown
try {
  await arrived(email('forged', undefined, false), f.env)
} catch (error) {
  rejected = error
}
test('a clerk email queues durable work, answers once, threads a follow-up and meters both directions', () => {
  assertEquals(duplicateEmail, firstEmail)
  assertEquals(letters.length, 2)
  assertEquals(letters[0].to, 'clerk@example.com')
  assertEquals(letters[0].headers?.['In-Reply-To'], '<request-1>')
  assertEquals(letters[1].headers?.['In-Reply-To'], '<request-2>')
  assertEquals(emailTask, followedTask)
  assertEquals(emailMeter, 4)
  assertEquals(rejected instanceof Refused, true)
})

let { desk } = await import('@yaks/draft')
let draftText = (await draft()).bundles[0].draft.text
await draft('', draftText)
let submission = new FormData()
let onlyFile = crypto.randomUUID()
submission.set('request', onlyFile)
submission.set('say', '')
submission.set(
  'file',
  new Blob(['Signed minutes'], { type: 'text/plain' }),
  'minutes.txt',
)
let confirmed: import('@yaks/graph').Bundle[] = []
let liveDraft = desk({
  watch: () => ({ value: [], subscribe: () => () => {} }),
  mutate: async (bundles) => {
    submission.set('draft', JSON.stringify(bundles))
    let response = await operatorPage(
      new Request('https://yaks.app/manage/operator?space=clerk', {
        method: 'POST',
        body: submission,
      }),
      f.env,
      f.space,
      f.held,
    )
    confirmed = (await response.json()).bundles
    return confirmed
  },
}, { by: () => f.person })
let savedOnlyFile = await liveDraft.spend('operator', [{
  entity: { eid: onlyFile },
}])
let onlyFileRow = await operatorDoor(f.env, f.space, f.held, 'request', {
  id: onlyFile,
}) as import('@yaks/graph').Bundle
liveDraft.close()
test('an attachment-only page submission reaches intake even when its draft is empty', () => {
  assertEquals(savedOnlyFile, true)
  assertEquals(
    (onlyFileRow.operator_request as { files: unknown[] }).files.length,
    1,
  )
  assertEquals((onlyFileRow.doc as { body: string }).body, '')
})

let receivedTools: Request[] = []
let attachmentScript = [
  call('operator_attachment', { index: 0, app: 'notices' }),
  [{ kind: 'assistant', text: 'The original minutes are attached.' } as Item],
]
handleChannels(
  attachmentStore,
  f.env,
  operatorModel((req) => {
    receivedTools.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: attachmentScript.shift()!,
      cost: 0,
    })
  }),
)
let attachmentTask = (attachmentAnswer as { task: string }).task
await receive(attachmentStore, {
  space: f.space.eid,
  person: f.person,
  channel: 'chat',
  task: attachmentTask,
}, 'Post the original minutes in notices.')
await attachmentStore.fx.work(attachmentStore.g)
let originalRows = await graph.read('.attachment ?created *')
test('a follow-up can publish an earlier request original without asking for it again', () => {
  assertEquals(
    receivedTools[0].tools.some((t) => t.name == 'operator_attachment'),
    true,
  )
  assertEquals(originalRows.length, 1)
  assertEquals(
    (originalRows[0].attachment as { name: string }).name,
    'minutes.txt',
  )
  assertEquals((originalRows[0].created as { by: string }).by, f.space.eid)
})

let media = operatorStore(durable())
let mediaAsks: Request[] = [], ocrInputs: unknown[] = []
let beforeMedia = (await f.dir.at(f.space.eid))!.meter!.models
f.env.MODEL_FETCH = () => Promise.resolve(modelPage(0.1, 0.3))
f.env.AI!.run = (_name, input) => {
  ocrInputs.push(input)
  return Promise.resolve({
    response: 'Signed minutes approve the road millage.',
    usage: { input_tokens: 10, output_tokens: 5 },
  })
}
f.env.RASTER = {
  fetch: (req) =>
    Promise.resolve(Response.json(
      new URL(req.url).searchParams.has('page')
        ? { pages: 1, text: 'Forwarded PDF: meeting approved.' }
        : { pages: 1 },
    )),
}
let photo = await keepFile(
  f.env,
  f.space,
  'signed.jpg',
  'image/jpeg',
  new Uint8Array([255, 216, 255, 217]),
)
let pdf = await keepFile(
  f.env,
  f.space,
  'forwarded.pdf',
  'application/pdf',
  new TextEncoder().encode('%PDF-1.7'),
)
handleChannels(
  media,
  f.env,
  operatorModel((req) => {
    mediaAsks.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Read the documents.' }],
      cost: 0,
    })
  }),
)
let mediaId = await receive(media, {
  space: f.space.eid,
  person: f.person,
  channel: 'chat',
  files: [photo, pdf],
}, 'Read the attached minutes.')
await media.fx.work(media.g)
let mediaAnswer = (await media.g.get([mediaId]))[0].operator_answer
let afterMedia = (await f.dir.at(f.space.eid))!.meter!.models
test('PDF pages and a JPEG photo are read through metered extraction before asking the operator', () => {
  assertStringIncludes(
    JSON.stringify(mediaAsks[0].items),
    'Signed minutes approve the road millage.',
  )
  assertStringIncludes(
    JSON.stringify(mediaAsks[0].items),
    'Forwarded PDF: meeting approved.',
  )
  assertStringIncludes(JSON.stringify(ocrInputs), 'data:image/jpeg;base64,')
  assertEquals(afterMedia > beforeMedia, true)
  assertEquals((mediaAnswer as { text: string }).text, 'Read the documents.')
})
