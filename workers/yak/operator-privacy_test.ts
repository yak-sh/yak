import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { draftEid } from '@yaks/draft'
import type { Held } from './build-door.ts'
import type { Operator } from './operator.ts'
import { operatorMemory } from './operator-testing.ts'
import { operatorFrames, operatorRequest } from './operator-host.ts'
import { seenBy } from './operator-access.ts'
import type { Lines } from './operator-draw.ts'
import { rowsOf } from './operator-rows.ts'
import { chatPage, operatorAnswer } from './operator-page.ts'
import { rootOf } from './operator-root.ts'
import { platform } from './testing.ts'
import type { Space } from './directory.ts'

let store = operatorMemory()
let [
  space,
  ada,
  bea,
  root,
  helper,
  task,
  taskSession,
  request,
  pending,
  unknown,
  made,
] = Array.from({ length: 11 }, () => crypto.randomUUID())
let who = (person: string): Held => ({ person, space, role: 'owner' })
// Deliberately not rootOf(space, ada): the stored owner determines access.
let secret = 'My private appointment'
let sessions = [root, helper, taskSession]
await store.g.apply([
  { entity: { eid: space } },
  ...[ada, bea].map((eid) => ({ entity: { eid }, person: {} })),
  ...sessions.map((eid) => ({
    entity: { eid },
    session: {},
    ...eid == helper ? { spawned: { parent: root } } : {
      operator_session: { person: ada, space },
    },
  })),
  { entity: { eid: task }, task: {}, doc: { title: secret } },
  {
    entity: { eid: crypto.randomUUID() },
    contains: {},
    edge: { from: task, to: taskSession },
  },
  ...[request, pending].map((eid) => ({
    entity: { eid },
    doc: { title: secret, body: secret },
    operator_request: {
      person: ada,
      space,
      channel: 'chat',
      ...eid == request ? { session: root } : {},
    },
  })),
  ...sessions.map((session) => ({
    entity: { eid: crypto.randomUUID() },
    entry: { session },
    content: { body: secret },
  })),
  // A file a step brought back, owned by its session's person.
  {
    entity: { eid: made },
    entry: { session: root },
    operator_files: {
      files: [{ name: 'image.png', mime: 'image/png', key: 'k' }],
    },
  },
  // Knowing the derived id does not confer ownership when the record differs.
  {
    entity: { eid: rootOf(space, bea) },
    session: {},
    operator_session: { person: ada, space },
  },
], { trusted: true })
let operator = {
  store,
  named: () => Promise.resolve(null),
} as unknown as Operator
let door = async (
  person: string,
  path: string,
  args: Record<string, unknown>,
) =>
  (await operatorRequest(
    operator,
    who(person),
    '/operator/' + path,
    args,
    () => undefined,
  ))!
let read = async (
  person: string,
  path: string,
  args: Record<string, unknown> = {},
) => {
  let response = await door(person, path, args)
  return { status: response.status, body: await response.json() }
}

for (
  let [name, open] of Object.entries({ root, helper, task, request, pending })
) {
  test(`only the recorded owner opens a ${name} conversation`, async () => {
    let own = await read(ada, 'conversation', { open })
    assertEquals(own.status, 200)
    assertStringIncludes(JSON.stringify(own.body), secret)
    assertEquals((await read(bea, 'conversation', { open })).status, 404)
    let missing = await read(bea, 'conversation', { open: unknown })
    assertEquals(missing.status, 404)
    assertEquals(await read(bea, 'conversation', { open }), missing)
    assertEquals(
      await read(bea, 'conversation', { open, everyone: true }),
      missing,
    )
  })
}

test('a derived conversation id does not override its stored owner or space', async () => {
  assertEquals(
    (await read(bea, 'conversation', { open: rootOf(space, bea) })).status,
    404,
  )
  let response = await operatorRequest(
    operator,
    { ...who(ada), space: unknown },
    '/operator/conversation',
    { open: root },
    () => undefined,
  )
  assertEquals(response!.status, 404)
})

test('a file a step brought back opens only for its session’s owner', async () => {
  assertEquals((await read(ada, 'attachment', { id: made, file: 0 })).body, {
    name: 'image.png',
    mime: 'image/png',
    key: 'k',
  })
  for (
    let [person, args] of [[bea, { id: made, file: 0 }], [ada, {
      id: made,
      file: 1,
    }]] as const
  ) assertEquals((await read(person, 'attachment', args)).status, 404)
})

test('request and transcript doors hide other people’s requests and tasks', async () => {
  assertEquals((await read(ada, 'request', { id: request })).status, 200)
  assertEquals(
    await read(bea, 'request', { id: request }),
    await read(bea, 'request', { id: unknown }),
  )
  assertEquals(
    (await read(bea, 'requests', { ids: [request, pending, unknown] })).body,
    [],
  )
  assertEquals((await read(bea, 'messages')).body, [])
  assertEquals((await read(bea, 'work')).body, [])
  assertEquals((await read(bea, 'read')).body, { tasks: [], conversations: [] })
  assertEquals(
    await read(bea, 'read', { task }),
    await read(bea, 'read', { task: unknown }),
  )
  let own = await read(ada, 'read', { task })
  assertStringIncludes(JSON.stringify(own.body.entries), secret)
  for (let path of ['stop', 'run']) {
    assertEquals((await read(bea, path, { task })).status, 404)
  }
})

let draft = (
  person: string,
  open: string,
  text = 'Unsent private words',
): Bundle => ({
  entity: { eid: draftEid(person, 'operator:' + open) },
  draft: { by: person, place: 'operator:' + open, text },
})
test('drafts keep the caller’s authorship and only name their own conversations', async () => {
  assertEquals(
    (await read(ada, 'draft', { bundles: [draft(ada, root)] })).status,
    200,
  )
  let forged = await read(bea, 'draft', { bundles: [draft(ada, root)] })
  assertEquals(forged.status, 404)
  assertEquals((await read(bea, 'draft')).body, { bundles: [] })
  let kept = (await read(ada, 'draft')).body.bundles
  assertEquals(kept.length, 1)
  assertEquals(kept[0].draft.text, 'Unsent private words')
  assertEquals(
    (await read(bea, 'receive', {
      say: 'hello',
      request: { channel: 'chat' },
      draft: [draft(ada, root)],
    })).status,
    404,
  )
})

test('live transcript and typing frames go only to the conversation’s owner', async () => {
  let listen = (person: string, at = space) => {
    let sent: string[] = []
    return {
      sent,
      send: (data: string) => void sent.push(data),
      deserializeAttachment: () => ({
        ...who(person),
        space: at,
        operator: true,
      }),
    }
  }
  let own = listen(ada), other = listen(bea), elsewhere = listen(ada, unknown)
  let frames = operatorFrames(store, () => [own, other, elsewhere])
  for (let session of [root, helper, taskSession]) {
    await frames.tell(session)
    await frames.typing(session, secret)
  }
  // each a step and typing, and the helper's step on its own page as well
  assertEquals(own.sent.length, 7)
  assertStringIncludes(own.sent.join(''), secret)
  assertEquals(other.sent, [])
  assertEquals(elsewhere.sent, [])
})

test('a page that draws its lines is sent them as data, and a page opened before is sent them drawn', async () => {
  let page = (lines: boolean) => {
    let sent: { operator?: Record<string, unknown> }[] = []
    return {
      sent,
      send: (data: string) => void sent.push(JSON.parse(data)),
      deserializeAttachment: () => ({
        ...who(ada),
        space,
        operator: true,
        ...lines ? { lines } : {},
      }),
    }
  }
  let drawing = page(true), older = page(false)
  await operatorFrames(store, () => [drawing, older]).tell(root)
  let [{ operator: data }] = drawing.sent, [{ operator: drawn }] = older.sent
  let { lines, ...rest } = data as { lines: Lines }
  assertEquals(drawn, { ...rest, rows: rowsOf(lines) })
  assertStringIncludes(JSON.stringify(drawn), secret)
})

let { env } = platform('operator-privacy')
env.BUILDER = {
  idFromName: (name) => name,
  get: () => ({
    fetch: async (req: Request) =>
      (await operatorRequest(
        operator,
        who(req.headers.get('x-yak-person')!),
        new URL(req.url).pathname,
        await req.json(),
        () => undefined,
      ))!,
  }),
}
let at = {
  eid: space,
  slug: 'private',
  title: 'Private',
  operator: 'Wren',
} as Space
test('the chat page and its polling door conceal foreign and unknown ids alike', async () => {
  let page = (open: string) => chatPage(env, at, who(bea), open)
  let foreign = await page(root), missing = await page(unknown)
  assertEquals(foreign.status, 404)
  assertEquals(missing.status, 404)
  assertEquals((await foreign.text()).includes(secret), false)
  assertEquals(
    (await (await page(rootOf(space, bea))).text()).includes(secret),
    false,
  )
  for (let open of [root, helper, request, unknown]) {
    let response = await operatorAnswer(
      new Request(`https://yaks.app/manage/private/operator?talk=${open}`),
      env,
      at,
      who(bea),
    )
    assertEquals(response!.status, 404)
    assertEquals(await response!.json(), {
      message: 'That conversation is missing.',
    })
  }
  assertEquals((await chatPage(env, at, who(ada), root)).status, 200)
})

test('a saved draft is told only to its owner’s pages in its space', async () => {
  let sent = new Map<string, unknown[]>()
  let page = (name: string, person: string, at = space) => ({
    send: (data: string) =>
      void sent.set(name, [...sent.get(name) ?? [], JSON.parse(data)]),
    deserializeAttachment: () => ({
      ...who(person),
      space: at,
      operator: true,
    }),
  })
  let frames = operatorFrames(store, () => [
    page('own', ada),
    page('other', bea),
    page('elsewhere', ada, unknown),
  ])
  let told: Bundle[][] = []
  let answered = await operatorRequest(
    operator,
    who(ada),
    '/operator/draft',
    { bundles: [draft(ada, root, 'Words on the way')] },
    () => undefined,
    (bundles) => {
      told.push(bundles)
      frames.drafts(who(ada), bundles)
    },
  )
  assertEquals(told.length, 1)
  assertEquals(sent.get('own'), [
    { drafts: (await answered!.json()).bundles },
  ])
  assertEquals([sent.has('other'), sent.has('elsewhere')], [false, false])
})

test("the Operator's own store, read for one person, shows none of another's conversations", async () => {
  let words = async (person: string, query: string) =>
    JSON.stringify(await seenBy(store.g, person).read(query))
  for (let query of ['.entry&*', '.operator_request&*', '.session&*']) {
    assertEquals((await words(bea, query)).includes(secret), false, query)
  }
  assertEquals((await seenBy(store.g, bea).get([root, helper])).length, 0)
  assertStringIncludes(await words(ada, '.entry&*'), secret)
  // What nobody owns, such as a task, stays in view.
  assertStringIncludes(await words(bea, `.entity.eid=${task}&*`), secret)
})
