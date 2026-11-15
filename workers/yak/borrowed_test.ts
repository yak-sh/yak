// A store whose app borrows a word from another app's store answers it
// itself, across both (graph.ts `#across`, homes.ts): a read naming it, a
// write carrying it, the words its pages load, and a page's watch of it
// (`#lending`), which the home tells of each commit (`#herald`, `/heard`),
// so neither store holds a socket to the other and both can sleep.
import { equal, test, until } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import type { Frame } from '@yaks/api'
import type { VocabDoc } from '@yaks/vocab'
import { installPair, made } from '../../packages/workerd/testing.ts'
import { call, type Ctx } from './tools.ts'
import { operators } from './operator-service-probe.ts'
import { platform } from './testing.ts'
import { ADA, ADA_OWNS, SECRET, seeded } from './serving-data-probe.ts'
import { type App, appStore, storeName } from './directory.ts'
import { ACROSS } from './door.ts'
import { KERNEL } from './meta.ts'
import { homesOf } from './homes.ts'

let runtime = platform(SECRET, { BUILDER: operators })
let { env } = runtime
let { dir, space } = await seeded(env)
let ctx: Ctx = { env, dir, person: ADA }
let deployed = async (slug: string, defs: Record<string, unknown>) => {
  await call(ctx, 'app_new', { space: 'ada', slug, title: slug })
  await call(ctx, 'app_files', {
    space: 'ada',
    app: slug,
    files: [
      { path: 'index.html', content: `<h1>${slug}</h1>` },
      { path: 'vocab.json', content: JSON.stringify({ $defs: defs }) },
    ],
  })
  await call(ctx, 'app_deploy', { space: 'ada', app: slug })
  return (await dir.app(space, slug))!
}
let text = { type: 'string' }
let book = { component: true, properties: { title: text } }
let shelf = await deployed('shelf', { book })
let loans = await deployed('loans', {
  book,
  loan: { component: true, properties: { to: text } },
})

// Ada at one app's store, as its pages' door asks it (`ACROSS`) or as a
// member of a reach is asked, alone.
let ask = (app: App, path: string, init: RequestInit = {}, across = true) =>
  appStore(env.STORE, space, app, env).consume(
    path,
    (r) => r.json(),
    init,
    { ...ADA_OWNS, ...across ? { [ACROSS]: '1' } : {} },
  )
let titles = (rows: Bundle[]) =>
  rows.map((b) => (b.book as { title: string }).title).sort()
let shelved = (title: string) =>
  ask(shelf, '/apply', {
    method: 'POST',
    body: JSON.stringify([{
      entity: { eid: crypto.randomUUID() },
      book: { title },
    }]),
  })

await shelved('Dune')

test('a read naming a borrowed word is answered from its home', async () => {
  equal(titles(await ask(loans, '/query?q=.book&listing=1')), ['Dune'])
  // Alone, as a member of a reach is asked, the store knows no such word.
  equal(
    (await ask(loans, '/query?q=.book&listing=1', {}, false)).error,
    'Unknown',
  )
})

test('a write carrying a borrowed word lands at its home', async () => {
  let applied = await ask(loans, '/apply', {
    method: 'POST',
    body: JSON.stringify([
      { entity: { eid: '$kim' }, book: { title: 'Kim' }, loan: { to: 'Bo' } },
    ]),
  }) as Bundle[]
  let kim = applied.find((b) => b.$alias == '$kim')!.entity.eid
  let at = async (app: App) =>
    (await ask(app, `/query?q=.entity.eid=${kim}`, {}, false) as Bundle[])
      .flatMap((b) =>
        Object.keys(b).filter((k) => ['book', 'loan'].includes(k))
      )
  equal([await at(shelf), await at(loans)], [['book'], ['loan']])
})

test("a page's words are its store's and the ones it borrows", async () => {
  let docs = await ask(loans, '/vocab.json') as VocabDoc[]
  equal(Object.keys(docs.find((d) => d.title == 'shelf')?.$defs ?? {}), [
    'book',
  ])
  let { docs: same, keywords } = await ask(loans, '/api/vocab')
  equal([same, Array.isArray(keywords)], [docs, true])
})

// A page of `app` watching the books it borrows, as the door that let its
// socket in vouched `who`, with the app as the directory has it now: the
// next `n` answers it is sent.
let watching = async (slug: string, who: Record<string, string>) => {
  let app = (await dir.app(space, slug))!
  let undo = installPair()
  let opened = await appStore(env.STORE, space, app, env)(
    '/ws',
    { headers: { upgrade: 'websocket' } },
    who,
  )
  await opened.body?.cancel()
  let ws = made.at(-1)![1]
  undo()
  await runtime.object(storeName(space, app)).webSocketMessage(
    ws,
    JSON.stringify({ subscribe: '.book', id: 'books' }),
  )
  let heard = async (n = 1) => {
    let said: unknown[] = []
    await until(() => {
      said.push(
        ...(ws.taken() as Frame[]).filter((f) => f.id == 'books')
          .map((f) => f.refused ? f.refused.message : titles(f.bundles ?? [])),
      )
      return said.length >= n
    })
    return said
  }
  return { ws, heard }
}

// Ada's loans page watches the books its app borrows from the shelf.
let name = storeName(space, loans)
let { ws, heard } = await watching('loans', ADA_OWNS)

// It was answered before Kim was written, and again once she was.
test('a watch of a borrowed word is answered from its home', async () =>
  equal(await heard(2), [['Dune'], ['Dune', 'Kim']]))

test('a commit at the home reaches the page watching its word', async () => {
  await shelved('Emma')
  equal(await heard(), [['Dune', 'Emma', 'Kim']])
})

test('a home stops telling a store nobody there watches', async () => {
  await runtime.object(name).webSocketClose(ws)
  let told = await appStore(env.STORE, space, loans, env)(
    '/heard',
    { method: 'POST' },
    KERNEL,
  )
  equal(told.status, 410)
})

test('a store-scoped app keeps the homes of the words it uses out of its reach', async () => {
  let scoped = { ...loans, scope: 'store' } as App
  let found = await homesOf(
    {
      appAt: () => Promise.resolve({ space, app: scoped }),
      app: () => Promise.resolve(shelf),
    } as unknown as Parameters<typeof homesOf>[0],
    scoped.eid,
    { book: 'shelf' },
  )
  equal(found?.homes, [])
})

let UNLENT =
  ".book is borrowed from shelf, which is private, so it can't be read here now"
let access = (app: string, access: string) =>
  call(ctx, 'app_set', { space: 'ada', app, access })

test('a visitor watches a borrowed word with the standing their visit holds', async () => {
  await access('loans', 'private')
  await access('shelf', 'private')
  let visit = { 'x-yak-via': crypto.randomUUID(), 'x-yak-role': 'viewer' }
  equal(await (await watching('loans', visit)).heard(), [[
    'Dune',
    'Emma',
    'Kim',
  ]])
})

test('a home made private leaves the next answer of a watch it fed', async () => {
  await access('loans', 'public')
  await access('shelf', 'public')
  let guest = await watching('loans', {})
  equal(await guest.heard(), [['Dune', 'Emma', 'Kim']])
  await access('shelf', 'private')
  await shelved('Ulysses')
  // Refused as the page's read of it is.
  equal(await guest.heard(), [UNLENT])
})

test("a read of a word borrowed from a home made private says it can't be read now", async () => {
  let read = () =>
    appStore(env.STORE, space, loans, env).consume(
      '/query?q=.book&listing=1',
      (r) => r.json(),
      {},
      { [ACROSS]: '1' },
    )
  await access('shelf', 'public')
  equal(titles(await read()), ['Dune', 'Emma', 'Kim', 'Ulysses'])
  await access('shelf', 'private')
  let { error, message } = await read()
  equal([error, message], ['Denied', UNLENT])
})
