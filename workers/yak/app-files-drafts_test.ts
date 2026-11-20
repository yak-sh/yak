// One app_files call makes several drafts of an app: the files they share
// sent once, each draft's own laid over them, all over what the call's own
// draft held.
import { equal, ok, test, throws } from '@yaks/testing'
import { ADA, SECRET, seeded } from './serving-data-probe.ts'
import { platform } from './directory-rows-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { digest } from '@yaks/graph/sha256'

let runtime = platform(SECRET)
let { env } = { ...runtime, ...lifecycleStores(runtime.env) }
let { dir, space } = await seeded(env, 'public', runtime.dir)
let run = (
  name: string,
  args: Record<string, unknown>,
  call: string = crypto.randomUUID(),
) => {
  let ctx: Ctx = { env, dir, person: ADA, call }
  return TOOLS.find((t) => t.name == name)!.run(ctx, args)
}
let made = async (slug: string) => {
  await run('app_new', { slug, title: slug, access: 'public' })
  return slug
}

// Files as the tool takes them, and as a read answers them: path to sha.
let sent = (files: Record<string, string>) =>
  Object.entries(files).map(([path, content]) => ({ path, content }))
let shas = async (files: Record<string, string>) =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([path, content]) =>
        [path, await digest(content)] as const
      ),
    ),
  )
let held = async (app: string, draft?: string) => {
  let out = await run('app_files', { app, op: 'read', draft })
  let files = out.value!.files as { path: string; sha: string }[]
  return Object.fromEntries(files.map((f) => [f.path, f.sha]))
}
let open = async (slug: string) =>
  (await dir.drafts((await dir.app(space, slug))!)).map((d) => d.eid).sort()

let SHARED = { 'copy.json': '{"hero":"Welcome"}', 'seed.json': '[]' }
let OWN: Record<string, string>[] = [
  { 'index.html': '<h1 data-copy="hero">warm</h1>', 'warm.css': 'i{}' },
  { 'index.html': '<h1 data-copy="hero">plain</h1>', 'style.css': 'b{}' },
  { 'index.html': '<h1 data-copy="hero">bold</h1>' },
]
let fanned = (app: string, more: Record<string, unknown> = {}, call?: string) =>
  run('app_files', {
    app,
    files: sent(SHARED),
    drafts: OWN.map((own) => ({ files: sent(own) })),
    ...more,
  }, call)

test('a new app whose vocab went in first ends with one draft per entry, each holding it, the shared files and its own', async () => {
  let app = await made('fresh')
  let vocab = { 'vocab.json': '{"$defs":{}}' }
  await run('app_files', { app, files: sent(vocab) })
  let out = await fanned(app)
  let ids = out.value!.drafts as string[]
  equal(ids.length, 3)
  equal(await open(app), [...ids].sort())
  for (let [i, id] of ids.entries()) {
    equal(await held(app, id), await shas({ ...vocab, ...SHARED, ...OWN[i] }))
    ok(out.text.includes(`draft ${id}:\nindex.html`), out.text)
  }
  for (let step of ['app_preview', 'decision_new', 'app_deploy']) {
    ok(out.text.includes(step), out.text)
  }
})

test("an app with a live version keeps what live holds in every draft, and each draft's own over it", async () => {
  let app = await made('live')
  let live = { 'index.html': '<h1>live</h1>', 'about.html': '<p>about</p>' }
  await run('app_files', { app, files: sent(live) })
  await run('app_deploy', { app })
  let ids = (await fanned(app)).value!.drafts as string[]
  equal(await open(app), [...ids].sort())
  for (let [i, id] of ids.entries()) {
    equal(await held(app, id), await shas({ ...live, ...SHARED, ...OWN[i] }))
  }
  // A read naming none takes one of them; a write naming none refuses.
  ok(
    ids.includes(
      (await run('app_files', { app, op: 'list' })).value!.draft as string,
    ),
  )
  await throws(
    () => run('app_files', { app, path: 'a.txt', content: 'a' }),
    'holds 3 drafts',
  )
})

// The call cut off where the last entry's bytes go out, so the drafts before
// it may have landed and it has not.
let cutOff = async (sha: string, work: () => Promise<unknown>) => {
  let put = env.BLOBS.put
  env.BLOBS.put = (key, ...rest) => {
    if (!key.endsWith(sha)) return put.call(env.BLOBS, key, ...rest)
    env.BLOBS.put = put
    throw new Error('cut off')
  }
  await throws(work, 'cut off').finally(() => env.BLOBS.put = put)
}

test('the call sent again after it was cut off, and again after it landed, lands in the same drafts', async () => {
  let app = await made('again')
  let vocab = { 'vocab.json': '{}' }
  await run('app_files', { app, files: sent(vocab) })
  let call = crypto.randomUUID()
  let last = (await shas(OWN[2]))['index.html']
  await cutOff(last, () => fanned(app, {}, call))
  let first = (await fanned(app, {}, call)).value!.drafts as string[]
  let again = (await fanned(app, {}, call)).value!.drafts as string[]
  equal(again, first)
  equal(await open(app), [...first].sort())
  for (let [i, id] of first.entries()) {
    equal(await held(app, id), await shas({ ...vocab, ...SHARED, ...OWN[i] }))
  }
})

test('drafts with draft new start every draft from the live files, beside the one the conversation holds', async () => {
  let app = await made('anew')
  let live = { 'index.html': '<h1>live</h1>' }
  await run('app_files', { app, files: sent(live) })
  await run('app_deploy', { app })
  let mine = (await run('app_files', { app, files: sent({ 'a.txt': 'a' }) }))
    .value!.draft as string
  let ids = (await fanned(app, { draft: 'new' })).value!.drafts as string[]
  equal(ids.length, 3)
  equal(await open(app), [mine, ...ids].sort())
  for (let [i, id] of ids.entries()) {
    equal(await held(app, id), await shas({ ...live, ...SHARED, ...OWN[i] }))
  }
  await run('app_delete', { app })
})

test('drafts beside another op, or of one entry, is refused as the caller mistake', async () => {
  let app = 'refused'
  await throws(() => fanned(app, { op: 'patch' }), 'drafts: for a write')
  await throws(
    () => run('app_files', { app, drafts: [{ files: sent(OWN[0]) }] }),
    'two to four',
  )
})

test('a plain write answers as it did, in the one draft it opened', async () => {
  let app = await made('plain')
  let out = await run('app_files', { app, files: sent(SHARED) })
  equal(Object.keys(out.value!).sort(), ['already', 'draft', 'wrote'])
  equal(await open(app), [out.value!.draft])
  ok(out.text.includes(`In draft ${out.value!.draft}`), out.text)
  // A read of a file it lacks names the ones it holds, for the next read.
  await throws(
    () => run('app_files', { app, op: 'read', path: 'index.html' }),
    'no file index.html; it holds copy.json, seed.json',
  )
  // A refused argument ends with the whole shape its op takes.
  await throws(
    () => run('app_files', { app, content: 'x' }),
    'path is required — write takes path and content',
  )
})
