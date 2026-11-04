import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { derivedEid } from '@yaks/graph/identity'
import type { Item, Model, Request } from '@yaks/model'
import { directoryOf } from './directory.ts'
import { declared } from './directory-fixture.ts'
import { modelPage } from './model-probe.ts'
import { platform } from './directory-rows-probe.ts'
import { stores } from './app-store-probe.ts'
import { appDoc, appVocab } from './vocab.ts'
import {
  operatorMemory,
  operatorModel,
  operatorService,
} from './operator-testing.ts'
import {
  attachmentTools,
  authenticated,
  handleChannels,
  keepFile,
  receive,
} from './operator-channels.ts'
import { operating, type Operator, operatorContext } from './operator.ts'
import { operatorRequest } from './operator-host.ts'
import { handed } from './operator-texts.ts'
import { drain, type operatorStore as Stored } from './operator-store.ts'

// One Operator per store, as the Builder object keeps, answered by `model`.
let operatorOf = (
  store: ReturnType<typeof Stored>,
  env: Parameters<typeof operating>[1],
  model: Model,
) =>
  operating(store, env, {
    ...operatorModel(model),
    tools: attachmentTools(env),
  })
import { TOOLS } from './tools.ts'
import { conversation, operatorAnswer, operatorBody } from './operator-page.ts'
import { operatorDoor } from './operator-page.ts'
import { arrived, Refused } from './inbox.ts'
import { chatPath } from './route.ts'
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
  let store = operatorMemory()
  let raw = store.storage
  let held = { person, role: 'owner' as const, space: eid }
  let ctx = await operatorContext(p.env, held, space)
  let words = {
    $defs: { meeting: { properties: { title: { type: 'string' } } } },
    imports: ['blob'],
  }
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
        content: JSON.stringify(words),
      },
    ],
  })
  let app = (await dir.app(space, 'notices'))!
  await dir.apply({
    entities: [{ entity: { eid: app.eid }, app: { version: 1 } }],
  }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
  app = (await dir.app(space, 'notices'))!
  await declared(p.env, space, app, { vocab: appDoc(words), tools: {} })
  stores(p.env, appVocab(words))
  let service = operatorService(
    p.env,
    held,
    operatorModel((req) =>
      Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: [{ kind: 'assistant', text: 'Which date and time?' }],
        cost: 0.001,
      })
    ),
  )
  p.env.BUILDER = service.binding
  return {
    ...p,
    dir,
    space,
    person,
    raw,
    store,
    held,
    ctx,
    sockets: service.sockets,
    drain: service.drain,
  }
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
let sent: string[] = []
let operator = operatorOf(f.store, f.env, model)
handleChannels(operator, f.env, {
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
await drain(f.store)
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
await drain(f.store)
let session = derivedEid('operator-session|' + id)
// The intake of the same request again, as a retried effect gives it.
await operator.ask(f.held, f.space, { say: 'Post the notice.', task }, {
  request: id,
  session,
  task,
})
await drain(f.store)
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
let reopened = operatorMemory(f.raw)
handleChannels(operatorOf(reopened, f.env, model), f.env)
await drain(reopened)
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

let html = await operatorBody(f.env, f.space, f.held)
let seatDir = directoryOf(f.env.STORE)
let [seat] = await seatDir.seats(f.held.person, 'owner')
await seatDir.apply({
  entities: [{ entity: { eid: seat.seat }, member: { own: true } }],
}, { 'x-yak-person': f.held.person, 'x-yak-role': 'owner' })
let ownHtml = await operatorBody(f.env, f.space, f.held)
test("the operator page on a person's own space says it works in their other spaces", () => {
  assertEquals(html.includes('your other spaces'), false)
  assertStringIncludes(ownHtml, 'your other spaces')
})
test('the operator page names its email address, opens a new conversation and draws kept answers', () => {
  assertStringIncludes(html, 'clerk@yaks.app')
  assertStringIncludes(html, `href="${chatPath('clerk')}"`)
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
  // What went wrong reads in plain words; the error itself waits in Details.
  let { document } = parseHTML(conversation([{
    ...result,
    operator_answer: null,
    failed: { reason: 'TypeError: x is undefined' },
  }]))
  assertEquals(
    document.querySelector('.Talk_Trouble > p')!.textContent!.includes(
      'TypeError',
    ),
    false,
  )
  assertStringIncludes(
    document.querySelector('.Talk_Trouble details pre')!.textContent!,
    'TypeError',
  )
})

let textsAt = 'https://yaks.app/manage/clerk/operator?texts=1'
let choose = async (fields: Record<string, string>) => {
  let body = new FormData()
  for (let [k, v] of Object.entries(fields)) body.set(k, v)
  let response = (await operatorAnswer(
    new Request(textsAt, { method: 'POST', body }),
    f.env,
    f.space,
    f.held,
  ))!
  return { status: response.status, said: await response.json() }
}
let unticked = await choose({ number: '269-555-0142' })
let wrong = await choose({ number: '555-0142', agreed: 'yes' })
let agreed = await choose({ number: '(269) 555-0142', agreed: 'yes' })
let textsHtml = await operatorBody(f.env, f.space, f.held)
let stopped = await choose({ stop: '1', number: '269-555-0142' })
let kept = await directoryOf(f.env.STORE).known(f.held.person)
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
test("a person's number stays on them, beside their address, after texts stop", () => {
  assertEquals(kept?.phone, '+12695550142')
  assertEquals(kept?.email, 'clerk@example.com')
})

// An opt-in kept in the operator store before the number moved onto the
// person: listed at the door, then dropped once handed over.
let legacy = operatorMemory()
let door = (args: Record<string, unknown>) =>
  operatorRequest(
    { store: legacy } as unknown as Operator,
    f.held,
    '/operator/texts',
    args,
    () => undefined,
  ).then((r) => r!.json())
let old = {
  person: f.held.person,
  number: '+12695550199',
  consent: 'Text me.',
  at: '2026-11-03T00:00:00.000Z',
}
await legacy.g.apply([{
  entity: { eid: crypto.randomUUID() },
  sms_consent: old,
}])
let listed = await door({})
await door({ handed: true })
let left = await door({})
test('the operator store hands its old opt-ins over and keeps none', () => {
  assertEquals(listed, [old])
  assertEquals(handed(old)[0], {
    entity: { eid: f.held.person },
    phone: { number: '+12695550199' },
  })
  assertEquals(left, [])
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
let attachmentStore = operatorMemory()
let attachmentModel: Model = (req) => {
  attachmentRequests.push(req)
  return Promise.resolve({
    id: crypto.randomUUID(),
    model: req.model,
    items: [{ kind: 'assistant', text: 'Read the minutes.' }],
    cost: 0,
  })
}
handleChannels(
  operatorOf(attachmentStore, f.env, (req) => attachmentModel(req)),
  f.env,
)
let attachmentId = await receive(attachmentStore, {
  space: f.space.eid,
  person: f.person,
  channel: 'chat',
  files: [file],
}, 'Read these minutes.')
await drain(attachmentStore)
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
// A page watching the Operator, at the object's sockets the way the
// handshake leaves one (build.ts `#accept`), and a page watching a build.
let watched = (operator: boolean) => {
  let sent: {
    operator?: { task: string; rows: { html: string }[]; now: string }
  }[] = []
  let held: unknown = {
    person: f.person,
    role: 'owner',
    space: f.space.eid,
    operator,
  }
  let ws = {
    readyState: 1,
    send: (data: string) => void sent.push(JSON.parse(data)),
    serializeAttachment: (v: unknown) => void (held = v),
    deserializeAttachment: () => held,
  }
  f.sockets.push(ws)
  return sent
}
let operatorPage = watched(true)
let buildPage = watched(false)
let firstEmail = await arrived(email('request-1'), f.env)
await f.drain()
let heard = operatorPage.flatMap((frame) =>
  frame.operator ? [frame.operator] : []
)
test('a page watching the Operator hears each step as the lines it changed, and a build page hears none', () => {
  assertEquals(heard.length > 1, true)
  assertStringIncludes(heard[0].rows[0].html, 'Schedule the special meeting.')
  assertEquals(heard[0].now, 'Thinking…')
  assertStringIncludes(
    heard.flatMap((h) => h.rows.map((r) => r.html)).join(''),
    'Talk_Reply',
  )
  // Ended, however it ended: nothing is said to be under way.
  assertEquals(heard.at(-1)!.now.endsWith('…'), false)
  assertEquals(buildPage.length, 0)
})
let duplicateEmail = await arrived(email('request-1'), f.env)
await f.drain()
let secondEmail = await arrived(email('request-2', 'reply-1'), f.env)
await f.drain()
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
    let response = (await operatorAnswer(
      new Request('https://yaks.app/manage/clerk/operator', {
        method: 'POST',
        body: submission,
      }),
      f.env,
      f.space,
      f.held,
    ))!
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
attachmentModel = (req) => {
  receivedTools.push(req)
  return Promise.resolve({
    id: crypto.randomUUID(),
    model: req.model,
    items: attachmentScript.shift()!,
    cost: 0,
  })
}
let attachmentTask = (attachmentAnswer as { task: string }).task
await receive(attachmentStore, {
  space: f.space.eid,
  person: f.person,
  channel: 'chat',
  task: attachmentTask,
}, 'Post the original minutes in notices.')
await drain(attachmentStore)
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

let media = operatorMemory()
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
  operatorOf(media, f.env, (req) => {
    mediaAsks.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'Read the documents.' }],
      cost: 0,
    })
  }),
  f.env,
)
let mediaId = await receive(media, {
  space: f.space.eid,
  person: f.person,
  channel: 'chat',
  files: [photo, pdf],
}, 'Read the attached minutes.')
await drain(media)
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
