import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Item, Model, Request } from '@yaks/model'
import {
  type Directory,
  directoryOf,
  type Role,
  type Space,
} from './directory.ts'
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
import { answering, operatorRequest } from './operator-host.ts'
import { handed } from './operator-texts.ts'
import { drain, type operatorStore as Stored } from './operator-store.ts'

// One Operator per store, as the Builder object keeps, answered by `model`.
let operatorOf = (
  store: ReturnType<typeof Stored>,
  env: Parameters<typeof operating>[1],
  model: Model,
  dir: Directory,
) =>
  operating(store, env, {
    ...operatorModel(model),
    directory: () => dir,
    tools: attachmentTools(env),
  })
import { TOOLS } from './tools.ts'
import {
  conversation,
  elsewhere,
  operatorAnswer,
  operatorBody,
} from './operator-page.ts'
import { operatorDoor } from './build-door.ts'
import { arrived, Refused } from './inbox.ts'
import type { Inbound } from './env.ts'
import { endpoints } from './endpoints.ts'
import { REPLIES, telnyxDoor, textSend } from './operator-texts.ts'
import { textSigned } from './operator-channels.ts'
import type { Bundle } from '@yaks/graph'
import type { Binding } from '@yaks/cloudflare-mail'

let fixture = async () => {
  let p = platform('operator-intake')
  let dir = p.dir
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
  let ctx = await operatorContext(p.env, held, space, () => dir)
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
    {
      directory: () => dir,
      ...operatorModel((req) =>
        Promise.resolve({
          id: crypto.randomUUID(),
          model: req.model,
          items: [{ kind: 'assistant', text: 'Which date and time?' }],
          cost: 0.001,
        })
      ),
    },
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
let operator = operatorOf(f.store, f.env, model, f.dir)
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
// A request with the newest answer it was given, as the page reads it.
let answerOf = async (store: ReturnType<typeof Stored>, id: string) =>
  (await answering(store, await store.g.get([id])))[0]
let result = await answerOf(f.store, id)

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
// The intake of the same request again, as a retried effect gives it.
await operator.ask(f.held, f.space, { say: 'Post the notice.' }, {
  request: id,
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
handleChannels(operatorOf(reopened, f.env, model, f.dir), f.env)
await drain(reopened)
let recovered = await answerOf(reopened, pending)

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
test('the operator page says once where else it works and what it may do there', () => {
  let said = (...roles: Role[]) =>
    parseHTML(elsewhere(
      roles.map((role, i) => ({
        eid: `r${i}`,
        role,
        space: { slug: `s${i}`, title: `S${i}` } as Space,
      })),
      true,
    )).document.querySelector('p')?.textContent ?? null
  assertEquals(said(), null)
  assertEquals(
    said('editor', 'editor', 'owner'),
    'It can also work in S0, S1, and S2, and change things there.',
  )
  assertEquals(
    said('viewer'),
    'It can also look at S0, but not change anything there.',
  )
  assertEquals(
    said('editor', 'viewer', 'editor'),
    'It can also change things in S0 and S2, and look at S1 without changing anything.',
  )
})
test('the operator page names its email address, lists its conversations and draws kept answers', () => {
  assertStringIncludes(html, 'clerk@yaks.app')
  assertStringIncludes(html, 'Your conversations appear here.')
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
  // The box is never ticked for them, whatever else the page has chosen.
  assertEquals(
    parseHTML(textsHtml).document.querySelector('[name=agreed]')
      ?.hasAttribute('checked'),
    false,
  )
  assertEquals(stopped.said, null)
})
test("a person's number stays on them, beside their address, after texts stop", () => {
  assertEquals(kept?.phone, '+12695550142')
  assertEquals(kept?.email, 'clerk@example.com')
})

// Telnyx at its HTTP boundary: the "yaks.app" profile with a 269 number and
// a toll-free one, and every text posted to it. A number in `blocked` is
// refused the way a carrier refuses one before a campaign is approved.
let ANA = '+12695550142', FREE = '+18885550100'
let texted: { from: string; to: string; text: string }[] = []
let blocked = new Set<string>()
let telnyxApi = endpoints(globalThis).open(async (req) => {
  let path = new URL(req.url).pathname
  if (path == '/messaging_profiles') {
    return Response.json({ data: [{ id: 'profile-1' }] })
  }
  if (path.endsWith('/phone_numbers')) {
    return Response.json({
      data: [{ phone_number: '+12695550100' }, { phone_number: FREE }],
    })
  }
  let sent = await req.json()
  if (blocked.has(sent.to)) {
    return Response.json({ errors: [{ code: '40010' }] }, { status: 400 })
  }
  texted.push({ from: sent.from, to: sent.to, text: sent.text })
  return Response.json({ data: { id: `msg-${texted.length}` } })
})
let signer = await crypto.subtle.generateKey('Ed25519', true, [
  'sign',
  'verify',
]) as CryptoKeyPair
let b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
Object.assign(f.env, {
  TELNYX_API: telnyxApi.url,
  TELNYX_API_KEY: 'a-key',
  TELNYX_PUBLIC_KEY: b64(
    await crypto.subtle.exportKey('raw', signer.publicKey),
  ),
})
let texting = async (id: string, text: string, sign = true) => {
  let body = JSON.stringify({
    data: {
      event_type: 'message.received',
      payload: {
        id,
        type: 'SMS',
        text,
        from: { phone_number: ANA },
        to: [{ phone_number: FREE }],
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
  let answer = await telnyxDoor(
    new Request('https://yaks.app/telnyx/webhook', {
      method: 'POST',
      headers: sign
        ? { 'telnyx-timestamp': t, 'telnyx-signature-ed25519': signature }
        : {},
      body,
    }),
    f.env,
  )
  await f.drain()
  return answer.status
}
let rejoined = await choose({ number: ANA, agreed: 'yes' })
let welcome = texted.splice(0)
// The Operator's requests by text, as its page reads them.
let byText = async () =>
  (await operatorDoor(f.env, f.space, f.held, 'messages', {}) as Bundle[])
    .filter((r) =>
      (r.operator_request as { channel: string }).channel == 'text'
    )
let unsigned = await texting('t0', 'Post the agenda', false)
let afterUnsigned = (await byText()).length
let signedIn = await texting('t1', 'Post the agenda')
let [asked] = await byText()
let answered = texted.splice(0)
await texting('t2', 'help')
await texting('t3', 'STOP')
let replies = texted.splice(0)
let stoppedTexts = await directoryOf(f.env.STORE).texting(f.held.person)
test('agreeing to texts sends the welcome from the toll-free number', () => {
  assertEquals(rejoined.said.number, ANA)
  assertEquals(welcome, [{ from: FREE, to: ANA, text: REPLIES.welcome }])
})
test("a signed text reaches the space's Operator, which answers by text; an unsigned one is refused", () => {
  assertEquals([unsigned, signedIn], [400, 200])
  assertEquals(afterUnsigned, 0)
  assertEquals(asked?.doc, {
    title: 'Post the agenda',
    body: 'Post the agenda',
  })
  assertEquals((asked?.operator_request as { address: string }).address, ANA)
  assertEquals(answered, [{
    from: FREE,
    to: ANA,
    text: `Which date and time?\n\n${textSigned(f.space)}`,
  }])
})
test('HELP and STOP are answered in the campaign words, and STOP ends consent', () => {
  assertEquals(replies.map((r) => r.text), [REPLIES.help, REPLIES.stop])
  assertEquals(stoppedTexts, null)
})

// The Operator texts first, from the toll-free number, signed with its name.
let unagreed = await Promise.resolve(
  textSend(f.env, f.ctx, f.space).run({ text: 'Hi' }),
).catch((e: Error) => e.message)
await choose({ number: ANA, agreed: 'yes' })
texted.splice(0)
await textSend(f.env, f.ctx, f.space).run({ text: 'Your agenda is up.' })
let first = texted.splice(0)
test('the Operator texts the person it works for only at the number they agreed to, signed with its name', () => {
  assertStringIncludes(String(unagreed), 'not agreed to texts')
  assertEquals(first, [{
    from: FREE,
    to: ANA,
    text: `Your agenda is up.\n\n${textSigned(f.space)}`,
  }])
})

// A carrier refusing the answer bounces it in plain words.
blocked.add(ANA)
await texting('t4', 'Post the minutes')
blocked.clear()
let refusedAnswer = (await byText()).find((r) =>
  (r.doc as { body: string }).body == 'Post the minutes'
)
await telnyxApi.stop()
test('an answer a carrier will not carry yet is bounced with the reason', () => {
  assertStringIncludes(
    String((refusedAnswer?.bounced as { reason: string }).reason),
    'business texting registration',
  )
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
  let { operatorDoor } = await import('./build-door.ts')
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
  operatorOf(attachmentStore, f.env, (req) => attachmentModel(req), f.dir),
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
  (await answerOf(attachmentStore, attachmentId)).operator_answer
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
  to: string | string[]
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
} satisfies Binding
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
  // The letter is the newest words of the person's one conversation.
  assertStringIncludes(
    heard[0].rows.map((r) => r.html).join(''),
    'Schedule the special meeting.',
  )
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
// Both letters reach the person's one conversation with the Operator.
let sessionOf = (id: string) =>
  (messages.find((row) => row.entity.eid == id)!.operator_request as {
    session: string
  }).session
let emailTask = sessionOf(firstEmail)
let followedTask = sessionOf(secondEmail)
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
await receive(attachmentStore, {
  space: f.space.eid,
  person: f.person,
  channel: 'chat',
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
  }, f.dir),
  f.env,
)
let mediaId = await receive(media, {
  space: f.space.eid,
  person: f.person,
  channel: 'chat',
  files: [photo, pdf],
}, 'Read the attached minutes.')
await drain(media)
let mediaAnswer = (await answerOf(media, mediaId)).operator_answer
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

// The same Operator conversation over Pinnacle's documented webhook and HTTP
// contracts. No provider payload is retained in the request or its reply.
let pf = await fixture()
let pinnacleTexts: { from: string; to: string; text: string }[] = []
let pinnacleApi = endpoints(globalThis).open(async (req) => {
  pinnacleTexts.push(await req.json())
  return Response.json({ messageId: `msg_${pinnacleTexts.length}` })
})
Object.assign(pf.env, {
  PHONE_SENDER: { via: 'pinnacle' },
  PINNACLE_API_KEY: 'test-key',
  PINNACLE_NUMBER: FREE,
  PINNACLE_API: pinnacleApi.url,
  PINNACLE_SIGNING_SECRET: 'pss_test',
})
let { textDoor, texts } = await import('./operator-texts.ts')
await pf.dir.apply({
  entities: texts(pf.person, ANA, true, undefined, pf.space.eid),
}, {
  'x-yak-person': pf.person,
  'x-yak-role': 'owner',
})
let pinnacleInbound = (id: string, text: string, signed = true) =>
  textDoor(
    new Request('https://yaks.app/pinnacle/webhook', {
      method: 'POST',
      headers: signed ? { 'PINNACLE-SIGNING-SECRET': 'pss_test' } : {},
      body: JSON.stringify({
        type: 'MESSAGE.RECEIVED',
        direction: 'INBOUND',
        status: 'RECEIVED',
        sentAt: '2026-11-05T12:00:00Z',
        conversation: { id: 'conv_1', from: ANA, to: FREE },
        message: { id, type: 'SMS', text },
      }),
    }),
    pf.env,
    'pinnacle',
  )
let pinnacleUnsigned = await pinnacleInbound(
  'unsigned',
  'Post the agenda',
  false,
)
let pinnacleSigned = await pinnacleInbound('msg_request', 'Post the agenda')
await pf.drain()
await pinnacleInbound('msg_request', 'Post the agenda')
await pf.drain()
let pinnacleRequests =
  (await operatorDoor(pf.env, pf.space, pf.held, 'messages', {}) as Bundle[])
    .filter((row) =>
      (row.operator_request as { channel: string }).channel == 'text'
    )
await pinnacleInbound('msg_stop', 'STOP')
let pinnacleStopped = await pf.dir.texting(pf.person)
await pinnacleApi.stop()

test('Pinnacle webhooks reach one Operator conversation and its replies and STOP use the shared channel', () => {
  assertEquals([pinnacleUnsigned.status, pinnacleSigned.status], [400, 200])
  assertEquals(pinnacleRequests.length, 1)
  assertEquals(pinnacleRequests[0].doc, {
    title: 'Post the agenda',
    body: 'Post the agenda',
  })
  assertEquals(
    (pinnacleRequests[0].operator_request as { via: string }).via,
    'pinnacle',
  )
  assertEquals(pinnacleTexts, [
    {
      from: FREE,
      to: ANA,
      text: `Which date and time?\n\n${textSigned(pf.space)}`,
    },
    { from: FREE, to: ANA, text: REPLIES.stop },
  ])
  assertEquals(pinnacleStopped, null)
})

// A call's turn, as operator-calls.ts `asking` gives it: answered by the
// model the Operator's calls are set to answer with, one its provider serves
// (this Operator's `test-model` is OpenAI's by its name, operator.ts `usingOf`).
let voiceAsks = asks.length
let spoken = await receive(f.store, {
  space: f.space.eid,
  person: f.person,
  channel: 'voice',
  address: '+12695550142',
  reply_to: '+18663141594',
  via: 'telnyx',
  model: 'gpt-5-mini',
}, 'Can you add a recipe to my recipe box?')
await drain(f.store)

test("a call's turn reaches the Operator, answered by the call's model", async () => {
  assertEquals((await f.store.g.get([spoken]))[0].doc, {
    title: 'Can you add a recipe to my recipe box?',
    body: 'Can you add a recipe to my recipe box?',
  })
  assertEquals(asks.slice(voiceAsks).map((r) => r.model), ['gpt-5-mini'])
})
