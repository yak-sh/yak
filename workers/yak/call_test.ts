// Recorded app commands preserve caller standing, result text and write guards.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { toolEid } from '@yaks/tools'
import { parseTools } from '@yaks/tools/declared'
import type { Bundle, Comp } from '@yaks/graph'
import type { Dispatch } from './door.ts'
import { appStore, storeName } from './directory.ts'
import * as apps from './apps.ts'
import { ADA, ADA_OWNS, as, platform, seeded, visit } from './serving-probe.ts'

let ELI = 'e0000000-0000-4000-8000-000000000001'
let words = {
  $defs: {
    log_note: {
      tool: true,
      description: 'Write a note',
      input: { at: { type: 'string' } },
      required: ['at'],
      apply: { entity: { eid: '$n' }, doc: { title: '$at' } },
    },
    owner_word: {
      tool: true,
      description: 'Read an owner word',
      floor: 'owner',
      worker: '/owner-word',
    },
    owner_note: {
      tool: true,
      description: 'Keep an owner note',
      floor: 'owner',
      apply: { entity: { eid: '$n' }, doc: { title: 'owner note' } },
    },
    caller: {
      tool: true,
      description: 'Read the caller',
      floor: 'person',
      readOnly: true,
      worker: '/caller',
    },
    read_draft: {
      tool: true,
      description: 'Read a draft',
      floor: 'person',
      query: '.entity.eid=$at&*',
      input: { at: { type: 'string' } },
      required: ['at'],
    },
  },
}

let commandFixture = async () => {
  let p = platform()
  let { env } = p
  let { dir, space, app } = await seeded(env, 'private')
  await dir.apply({
    entities: [
      { entity: { eid: ELI }, person: {} },
      {
        entity: { eid: '$seat' },
        member: { space: space.eid, person: ELI, role: 'editor' },
      },
    ],
  }, ADA_OWNS)
  let dispatched: Request[] = []
  env.DISPATCH = {
    get: () => ({
      fetch: (req: Request) => {
        dispatched.push(req)
        return Promise.resolve(
          req.url.endsWith('/caller')
            ? Response.json({
              person: req.headers.get('x-yak-person'),
              role: req.headers.get('x-yak-role'),
            })
            : new Response('welcome'),
        )
      },
    }),
  } as Dispatch
  let store = appStore(env.STORE, space, app)
  let declared = await store('/tools', {
    method: 'POST',
    body: JSON.stringify(parseTools(words, ['doc'])),
  }, ADA_OWNS)
  assertEquals(declared.status, 200, await declared.text())
  let privateDraft = crypto.randomUUID(), otherDraft = crypto.randomUUID()
  await store('/apply', {
    method: 'POST',
    body: JSON.stringify([privateDraft, otherDraft].map((eid) => ({
      entity: { eid },
      draft: { by: ADA, place: `command:${eid}`, text: 'unshared input' },
    }))),
  }, ADA_OWNS)
  return {
    p,
    env,
    dir,
    space,
    app,
    dispatched,
    store,
    privateDraft,
    otherDraft,
  }
}
let commandScene = await commandFixture()

test('a command that takes an argument runs in its store', async () => {
  await using p = commandScene.p
  let {
    env,
    dir,
    space,
    app,
    dispatched,
    store,
    privateDraft,
    otherDraft,
  } = commandScene
  let cookies = new Map([[ADA, await as(ADA)], [ELI, await as(ELI)]])
  let rows = async (q: string): Promise<Bundle[]> =>
    await (await store(`/query?q=${encodeURIComponent(q)}`, {}, ADA_OWNS))
      .json()
  let write = async (person: string, entities: Bundle[]) => {
    let res = await apps.fetch(
      visit('/cookbook/api/apply', {
        method: 'POST',
        headers: {
          cookie: cookies.get(person)!,
          'content-type': 'application/json',
        },
        body: JSON.stringify(entities),
      }),
      env,
    )
    assertEquals(res.status, 200, await res.text())
    await p.object(storeName(space, app)).alarm()
    await Promise.all([...p.states.get(storeName(space, app))!.pending])
  }
  let record = async (
    person: string,
    name: string,
    extra: Record<string, unknown> = {},
    args: Record<string, unknown> = {},
  ) => {
    let id = crypto.randomUUID()
    await write(person, [{
      entity: { eid: id },
      call: { to: toolEid(name), args, source: id },
      ...extra,
    }])
    return id
  }
  let answer = async (id: string) =>
    (await rows(`.result.call=${id}&?content`))[0]?.content as Comp
  let failureOf = async (id: string) =>
    (await rows(`.output.source=${id}&?refusal&?content`))[0]

  let ownedRead = await record(ADA, 'read_draft', {}, { at: privateDraft })
  assertStringIncludes(String((await answer(ownedRead)).body), 'unshared input')
  let foreignRead = await record(ELI, 'read_draft', {}, { at: privateDraft })
  assertStringIncludes(String((await answer(foreignRead)).body), '0 rows')

  let noted = await record(ADA, 'log_note', {}, { at: 'monday' })
  assertEquals(
    (await rows('.doc.title=monday')).map((r) => (r.doc as Comp).title),
    ['monday'],
  )
  assertEquals((await rows(`.result.call=${noted}`)).length, 1)
  let recordedOwner = await record(ADA, 'owner_word')
  assertStringIncludes(String((await answer(recordedOwner)).body), 'welcome')
  let [ownerCall] = await rows(`.entity.eid=${recordedOwner}&?created`)
  assertEquals(dispatched.at(-1)?.headers.get('x-yak-person'), ADA)
  assertEquals(dispatched.at(-1)?.headers.get('x-yak-role'), 'owner')
  assertEquals(
    dispatched.at(-1)?.headers.get('x-yak-via'),
    (ownerCall.created as Comp).via,
  )
  let count = dispatched.length
  let deniedOwner = await record(ELI, 'owner_word')
  assertEquals((await failureOf(deniedOwner)).refusal, { code: 'access' })
  assertEquals(dispatched.length, count)
  let deniedNote = await record(ELI, 'owner_note')
  assertEquals((await failureOf(deniedNote)).refusal, { code: 'access' })
  assertEquals((await rows('.doc.title=owner%20note')).length, 0)

  let future = Date.now() + 60_000
  let sleeping = { wake: { at: new Date(future).toISOString() } }
  let editedRead = await record(ADA, 'read_draft', sleeping, {
    at: privateDraft,
  })
  await write(ELI, [{
    entity: { eid: editedRead },
    call: { args: { at: otherDraft } },
  }])
  let [altered, mine, unchanged, recurring] = Array.from(
    { length: 4 },
    () => crypto.randomUUID(),
  )
  await write(
    ADA,
    [altered, mine, unchanged, recurring].map((eid) => ({
      entity: { eid },
      call: {
        to: toolEid(eid == recurring ? 'caller' : 'owner_word'),
        args: eid == unchanged ? { a: 1, b: 2 } : {},
      },
      wake: {
        ...sleeping.wake,
        ...eid == recurring ? { every: '1d' } : {},
      },
    })),
  )
  await write(ELI, [
    { entity: { eid: altered }, call: { args: { edited: true } } },
    // Property order, a provider id and display text change no executable ask.
    {
      entity: { eid: unchanged },
      call: { args: { b: 2, a: 1 }, id: 'provider-id' },
      doc: { title: 'a label' },
    },
    { entity: { eid: recurring }, call: { args: { edited: true } } },
  ])
  await write(ADA, [{
    entity: { eid: mine },
    call: { args: { edited: true } },
  }])
  count = dispatched.length
  await p.object(storeName(space, app)).tick(future)
  await Promise.all([...p.states.get(storeName(space, app))!.pending])
  assertStringIncludes(String((await answer(editedRead)).body), '0 rows')
  assertEquals((await failureOf(altered)).refusal, { code: 'access' })
  assertStringIncludes(String((await answer(mine)).body), 'welcome')
  assertStringIncludes(String((await answer(unchanged)).body), 'welcome')
  assertEquals(dispatched.length, count + 3)
  let [invocation] = await rows(`.call.source=${recurring}&!wake&?call`)
  assertStringIncludes(
    String((await answer(invocation.entity.eid)).body),
    'editor',
  )
  assertEquals(
    dispatched.find((req) =>
      req.headers.get('x-yak-command-call') == invocation.entity.eid
    )?.headers.get('x-yak-person'),
    ELI,
  )

  // The command's own template goes through the same component floors as a
  // direct write: recording a call grants no authority to add an access row.
  let guarded = parseTools({
    $defs: {
      elevate: {
        tool: true,
        description: 'Try to elevate a grant',
        apply: {
          entity: { eid: '$grant' },
          grant: { app: app.eid, person: ELI, access: 'owner' },
        },
      },
    },
  }, ['grant'])
  await store('/tools', {
    method: 'POST',
    body: JSON.stringify({ ...parseTools(words, ['doc']), ...guarded }),
  }, ADA_OWNS)
  let deniedGrant = await record(ELI, 'elevate')
  assertEquals(((await failureOf(deniedGrant)).refusal as Comp)?.code, 'Denied')

  let seat = (await dir.member(space, ELI))!
  await dir.apply({
    entities: [{ entity: { eid: seat.eid }, member: { role: 'viewer' } }],
  }, ADA_OWNS)
  await dir.apply({
    entities: [{ entity: { eid: app.eid }, app: { access: 'open' } }],
  }, ADA_OWNS)
  let reader = await record(ELI, 'caller')
  assertStringIncludes(String((await answer(reader)).body), 'viewer')
  assertEquals(dispatched.at(-1)?.headers.get('x-yak-person'), ELI)
  assertEquals(dispatched.at(-1)?.headers.get('x-yak-role'), 'viewer')

  await dir.apply({
    entities: [{ entity: { eid: app.eid }, app: { access: 'private' } }],
  }, ADA_OWNS)
  let later = new Date(Date.now() + 60_000).toISOString()
  // Queue while they may write, then revoke before the recorded errand runs.
  await dir.apply({
    entities: [{ entity: { eid: seat.eid }, member: { role: 'editor' } }],
  }, ADA_OWNS)
  let delayed = await record(ELI, 'caller', { wake: { at: later } })
  assertEquals(await answer(delayed), undefined)
  await dir.apply(
    { entities: [{ entity: { eid: seat.eid }, $delete: true }] },
    ADA_OWNS,
  )
  count = dispatched.length
  await p.object(storeName(space, app)).tick(Date.parse(later))
  await Promise.all([...p.states.get(storeName(space, app))!.pending])
  assertEquals(((await failureOf(delayed)).refusal as Comp)?.code, 'Denied')
  assertEquals(dispatched.length, count)

  // Scheduled work the app writes without a browser stays its automation.
  let automated = crypto.randomUUID()
  await store('/apply', {
    method: 'POST',
    body: JSON.stringify([{
      entity: { eid: automated },
      call: { to: toolEid('caller'), args: {} },
    }]),
  }, { 'x-yak-kernel': '1' })
  await p.object(storeName(space, app)).alarm()
  await Promise.all([...p.states.get(storeName(space, app))!.pending])
  assertStringIncludes(String((await answer(automated)).body), 'editor')
  assertEquals(dispatched.at(-1)?.headers.get('x-yak-person'), app.eid)
})
