// A page and an agent invoke the same declared app command with their caller's
// authority. The page door exercises the stored declaration and HTTP result.
import { assertEquals } from '@std/assert'
import { parseTools } from '@yaks/tools/declared'
import * as apps from './apps.ts'
import { appStore } from './directory.ts'
import type { Dispatch } from './door.ts'
import { ADA, ADA_OWNS, as, platform, seeded, visit } from './serving-probe.ts'

let ELI = 'e0000000-0000-4000-8000-000000000001'
let words = {
  $defs: {
    note: {
      tool: true,
      description: 'Keep a note',
      input: { title: { type: 'string' } },
      required: ['title'],
      apply: { entity: { eid: '$note' }, doc: { title: '$title' } },
    },
    owner_word: {
      tool: true,
      description: 'Ask the app owner for a word',
      floor: 'owner',
      worker: '/owner-word',
    },
    owner_json: {
      tool: true,
      description: 'Ask the app owner for a record',
      floor: 'owner',
      worker: '/owner-json',
    },
    notes: {
      tool: true,
      description: 'Read the notes',
      query: '.doc',
    },
  },
}

Deno.test('a page invokes declared commands as its owner; the command door refuses an editor', async () => {
  using p = platform()
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
  let store = appStore(env.STORE, space, app)
  let declared = await store('/tools', {
    method: 'POST',
    body: JSON.stringify(parseTools(words, ['doc'])),
  }, ADA_OWNS)
  assertEquals(declared.status, 200, await declared.text())
  env.DISPATCH = {
    get: () => ({
      fetch: (req: Request) =>
        Promise.resolve(
          req.url.endsWith('/owner-json')
            ? Response.json({ name: 'Elder Wren', land: 'tombsands' })
            : new Response(
              req.headers.get('x-yak-role') == 'owner'
                ? 'welcome'
                : 'owner only',
              { status: req.headers.get('x-yak-role') == 'owner' ? 200 : 403 },
            ),
        ),
    }),
  } as Dispatch
  let post = async (cookie: string, name: string, args = {}) => {
    let res = await apps.fetch(
      visit('/cookbook/api/command', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name, args }),
      }),
      env,
    )
    return { status: res.status, body: await res.json() }
  }
  let commands = async (cookie: string) => {
    let res = await apps.fetch(
      visit('/cookbook/api/commands', { headers: { cookie } }),
      env,
    )
    assertEquals(res.status, 200)
    return await res.json()
  }
  let ownerTools = await commands(await as(ADA))
  assertEquals(ownerTools.note, {
    description: 'Keep a note',
    input: { title: { type: 'string' } },
    required: ['title'],
  })
  assertEquals(
    ownerTools.owner_word?.description,
    'Ask the app owner for a word',
  )
  let editorTools = await commands(await as(ELI))
  assertEquals(editorTools.note?.description, 'Keep a note')
  assertEquals(editorTools.owner_word, undefined)

  let made = await post(await as(ADA), 'note', { title: 'A page note' })
  assertEquals(made.status, 200)
  assertEquals(made.body.ok, true)
  assertEquals(typeof made.body.value.aliases.$note, 'string')
  let read = await apps.fetch(
    visit('/cookbook/api/query?.doc&?created', {
      headers: { cookie: await as(ADA) },
    }),
    env,
  )
  let [row] = await read.json()
  assertEquals(row.doc.title, 'A page note')
  assertEquals(row.created.by, ADA)
  let listed = await post(await as(ADA), 'notes')
  assertEquals(listed.status, 200)
  assertEquals(listed.body.value.rows[0].doc.title, 'A page note')

  let owner = await post(await as(ADA), 'owner_word')
  assertEquals(owner, {
    status: 200,
    body: {
      ok: true,
      text: 'owner_word: welcome in ada/cookbook',
      value: { answer: 'welcome' },
    },
  })
  let json = await post(await as(ADA), 'owner_json')
  assertEquals(json.status, 200)
  assertEquals(
    json.body.value.answer,
    '{"name":"Elder Wren","land":"tombsands"}',
  )
  assertEquals(json.body.text.includes('{"name":'), false)
  assertEquals(json.body.text.includes('**name**: `"Elder Wren"`'), true)
  let editor = await post(await as(ELI), 'owner_word')
  assertEquals(editor.status, 403)
  assertEquals(editor.body.error.code, 'access')
  assertEquals(editor.body.error.message, 'owner_word requires the app owner')
})
