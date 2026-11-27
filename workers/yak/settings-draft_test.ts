import { assert, assertEquals } from '@std/assert'
import { keep, landed, raise, writes } from '@yaks/api/log'
import { draftDoc, draftEid, drafts } from '@yaks/draft'
import { type Bundle, type Comp, graph, mint } from '@yaks/graph'
import {
  moveCredentialDrafts,
  prepareCredentialWrites,
} from '@yaks/platform/credential-draft-move'
import {
  draftReference,
  openDraft,
  openDraftRow,
} from '@yaks/platform/credential-drafts'
import { line } from '@yaks/query'
import { ramVault } from '@yaks/secrets'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { d1 } from '../../packages/d1/testing.ts'
import type { Env } from './env.ts'
import { fresh, signIn } from './probe.ts'

let k = await fresh({}, (env) => {
  env.VAULT = d1() as unknown as Env['VAULT']
  env.VAULT_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)))
})
let jo = await signIn(k), al = await signIn(k)
let scope = '/manage/a/settings'
let at = '/manage/account/profile?settings-draft=1&scope=' +
  encodeURIComponent(scope)
let place = `settings:${scope}:title`
let read = async (person = jo, path = at) => {
  let response = await k.at('yaks.app', path, {
    headers: { cookie: person.cookie },
  })
  return { status: response.status, ...await response.json() }
}
let write = (
  text: string,
  over = '',
  origin = 'https://yaks.app',
  extra = {},
  key = place,
) =>
  k.at('yaks.app', at, {
    method: 'POST',
    headers: {
      cookie: jo.cookie,
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      bundles: [{
        entity: { eid: al.person },
        draft: { by: al.person, place: key, text },
        typed: { over },
        ...extra,
      }],
    }),
  })

let kept = await (await write('A new title')).json()
let spending = place + ':spending'
await write('An unsaved edit', '', 'https://yaks.app', {}, spending)

test('settings drafts survive another load and belong to the signed-in person', async () => {
  let result = await read()
  assertEquals(result.status, 200)
  assertEquals(result.person, jo.person)
  result.bundles = result.bundles.filter((b: { draft: { place: string } }) =>
    b.draft.place == place
  )
  assertEquals(result.bundles[0].entity.eid, draftEid(jo.person, place))
  assertEquals(result.bundles[0].draft.by, jo.person)
  assertEquals(result.bundles[0].draft.place, place)
  assertEquals(result.bundles[0].draft.text, 'A new title')
  assertEquals(result.bundles[0].draft.rev, 1)
  assertEquals(kept.bundles[0].draft.text, 'A new title')
  assertEquals((await read(al)).bundles, [])
  assertEquals(
    (await read(
      jo,
      at.replace(
        encodeURIComponent(scope),
        encodeURIComponent('/manage/b/settings'),
      ),
    )).bundles,
    [],
  )
})

test('settings drafts refuse another origin and never apply unrelated components', async () => {
  assertEquals(
    (await write('Cross origin', '', 'https://other.test')).status,
    403,
  )
  let answer = await write(
    'A new title, edited',
    '',
    'https://yaks.app',
    { doc: { title: 'Overwrite person' } },
    place + ':unrelated',
  )
  assertEquals(answer.status, 200)
  let bundles = (await answer.json()).bundles
  assertEquals(bundles[0].doc, undefined)
  assertEquals(bundles[0].draft.text, 'A new title, edited')
})

test('spending a settings draft empties it and retains its revision', async () => {
  let answer = await write(
    '',
    'An unsaved edit',
    'https://yaks.app',
    {},
    spending,
  )
  assertEquals(answer.status, 200)
  assertEquals((await answer.json()).bundles[0].draft.text, '')
  let rows = (await read()).bundles
  assertEquals(
    rows.find((b: { draft: { place: string } }) => b.draft.place == spending)
      .draft.text,
    '',
  )
})

test('key drafts recover only through their owner’s settings desk and can be spent', async () => {
  let key = `settings:${scope}:key-${mint()}:key`
  let text = JSON.stringify({ before: [''], value: ['synthetic paste'] })
  let eid = draftEid(jo.person, key)
  let saved = await write(text, '', 'https://yaks.app', {}, key)
  assertEquals(saved.status, 200)
  assertEquals(saved.headers.get('cache-control'), 'no-store')
  assert((await saved.json()).bundles[0].draft.text === text)
  let [stored] = await k.dir.read(line`.entity.eid=${eid}&?draft`)
  assert(draftReference(String((stored.draft as Comp).text)))
  let otherBrowser = await signIn(k, jo.email)
  let recovered = (await read(otherBrowser)).bundles.find(
    (b: { entity: { eid: string } }) => b.entity.eid === eid,
  )
  assert(recovered?.draft.text === text)
  assertEquals((await read(al)).bundles, [])
  let spent = await write('', text, 'https://yaks.app', {}, key)
  assertEquals(spent.status, 200)
  assertEquals((await spent.json()).bundles[0].draft.text, '')
  let [after] = await k.dir.read(line`.entity.eid=${eid}&?draft`)
  assertEquals((after.draft as Comp).text, '')
  assertEquals((after.draft as Comp).rev, 2)
})

let migration = await (async () => {
  let db = open(':memory:')
  let vocab = loadVocab([draftDoc])
  let saved = storage(db, vocab)
  saved.install()
  raise(db)
  let g = graph({ vocab, storage: saved, plugins: [drafts()] })
  let vault = ramVault()
  let by = mint()
  let row = (place: string, text: string, over = ''): Bundle => ({
    entity: { eid: draftEid(by, place) },
    draft: { by, place, text },
    typed: { over },
  })
  let prior = 'synthetic access identifier'
  let next = 'synthetic new access identifier'
  let gone = row(`settings:${scope}:own-${mint()}-${mint()}:key.access`, prior)
  let live = row(`settings:${scope}:key-${mint()}:key.secret`, prior)
  let edit = {
    ...live,
    draft: { ...(live.draft as Comp), text: next },
    typed: { over: prior },
  }
  await g.apply([{ entity: { eid: by } }, gone, live])
  await g.apply([{ entity: gone.entity, draft: null }])
  let logged = (row: Bundle, key?: string) => {
    let body = JSON.stringify([row])
    return keep(
      db,
      new Request('https://example.test/apply', {
        method: 'POST',
        body,
        headers: key ? { 'idempotency-key': key } : undefined,
      }),
      body,
    )
  }
  let pending = logged(edit)
  let applied = logged(gone, 'kept')
  landed(db, applied, () => [gone])
  return { db, g, saved, vault, prior, next, gone, live, pending, applied }
})()

test('legacy live drafts, trash and receipts move behind the vault without losing recovery', async () => {
  let { db, g, saved, vault, prior, next, gone, live, pending, applied } =
    migration
  let pass: Awaited<ReturnType<typeof moveCredentialDrafts>> = {}
  for (let i = 0; !pass.done && i < 5; i++) {
    pass = await moveCredentialDrafts(g, db, vault, pass)
  }
  assertEquals(pass.done, true)
  assertEquals(pass.moved, 4)
  let [stored] = await g.get([live.entity.eid])
  assert(draftReference(String((stored.draft as Comp).text)))
  assertEquals((stored.draft as Comp).rev, 1)
  assert(((await openDraftRow(vault, stored)).draft as Comp).text === prior)
  let [trash] = await saved.trash!([gone.entity.eid])
  let archived = trash.bundles.find((row) => row.entity.eid == gone.entity.eid)!
  assert(draftReference(String((archived.draft as Comp).text)))
  assert(((await openDraftRow(vault, archived)).draft as Comp).text === prior)
  let [write] = writes(db, pending)
  let [receipt] = writes(db, applied)
  assert(!JSON.stringify([write, receipt]).includes(prior))
  assert(!JSON.stringify([write, receipt]).includes(next))
  let [replay] = await prepareCredentialWrites(
    g,
    vault,
    JSON.parse(String(write.body)),
  )
  assert(
    (await openDraft(
      vault,
      live.entity.eid,
      String((replay.draft as Comp).text),
    )) === next,
  )
  await g.apply([replay])
  let [after] = await g.get([live.entity.eid])
  assert(((await openDraftRow(vault, after)).draft as Comp).text === next)
  assertEquals(
    await moveCredentialDrafts(g, db, vault, pass),
    pass,
  )
})
