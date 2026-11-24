// One app_files call makes several drafts of an app: the files they share
// sent once, each draft's own laid over them, all over what the call's own
// draft held.
import { equal, ok, test, throws } from '@yaks/testing'
import { ADA, ADA_OWNS, SECRET, seeded } from './serving-data-probe.ts'
import { platform } from './directory-rows-probe.ts'
import { lifecycleStores } from './app-lifecycle-probe.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { digest } from '@yaks/graph/sha256'
import { validateToolInput } from '@yaks/vocab/tools'

let runtime = platform(SECRET)
let { env } = { ...runtime, ...lifecycleStores(runtime.env) }
let { dir, space } = await seeded(env, 'public', runtime.dir)
await dir.stamp({
  entities: [{
    entity: { eid: space.eid },
    comp: { tier: 'plus', by: ADA, reason: 'Draft tool test fixture' },
  }],
}, ADA_OWNS)
let run = (
  name: string,
  args: Record<string, unknown>,
  call: string = crypto.randomUUID(),
  who?: Ctx['who'],
) => {
  let ctx: Ctx = { env, dir, person: ADA, call, who }
  let tool = TOOLS.find((t) => t.name == name)!
  return tool.run(ctx, validateToolInput({ inputSchema: tool.input }, args))
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

let choices = async (
  call: () => Promise<unknown>,
  drafts: [string, string[]][],
) => {
  let { message } = await throws(
    call,
    `has ${drafts.length} open drafts`,
  ) as Error
  for (let [id, paths] of drafts) {
    let line = message.split('\n').find((l) => l.startsWith(`- ${id} · `))!
    ok(/ · (just now|[^·]+ ago|in [^·]+) · /.test(line), message)
    for (let path of paths) ok(line.includes(path), message)
  }
}

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
  for (
    let args of [
      { op: 'list' },
      { op: 'read' },
      { path: 'a.txt', content: 'a' },
    ]
  ) {
    await choices(
      () => run('app_files', { app, ...args }),
      ids.map((id, i) => [id, Object.keys(OWN[i])]),
    )
  }
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

test('drafts needs a write and says how to send more than four choices', async () => {
  let app = 'refused'
  await throws(() => fanned(app, { op: 'patch' }), 'drafts: for a write')
  await throws(
    () =>
      run('app_files', {
        app,
        drafts: Array.from({ length: 5 }, () => ({ files: sent(OWN[0]) })),
      }),
    'Send the rest in later calls with draft: new',
  )
})

test('one drafts entry is a plain write with its files over the shared files', async () => {
  let app = await made('single')
  let out = await run('app_files', {
    app,
    files: sent({ ...SHARED, 'index.html': 'shared' }),
    drafts: [{ files: sent(OWN[0]) }],
  })
  equal(Object.keys(out.value!).sort(), ['already', 'draft', 'wrote'])
  let id = String(out.value!.draft)
  equal(await open(app), [id])
  equal(await held(app), await shas({ ...SHARED, ...OWN[0] }))
  let next = await run('app_files', {
    app,
    draft: 'new',
    drafts: [{ files: sent(OWN[1]) }],
  })
  equal(await held(app, String(next.value!.draft)), await shas(OWN[1]))
})

test('files and previews use a lone draft and offer recovery when a draft closes', async () => {
  let app = await made('closed')
  let write = (path: string, content: string, draft?: string) =>
    run('app_files', { app, path, content, ...draft ? { draft } : {} })
  let show = (draft?: string, released = false) =>
    run('app_preview', {
      app,
      screenshot: false,
      released,
      ...draft ? { draft } : {},
    })
  let opened = await run(
    'app_files',
    {
      app,
      files: sent(OWN[0]),
    },
    crypto.randomUUID(),
    {
      person: ADA,
      agent: 'Claude',
      via: 'oauth',
      instrument: crypto.randomUUID(),
    },
  )
  let first = String(opened.value!.draft)
  equal(await held(app), await shas(OWN[0]))
  equal((await show()).value!.draft, first)
  equal((await write('notes.txt', 'mine')).value!.draft, first)

  let next = String((await write('next.txt', 'next', 'new')).value!.draft)
  let other = String((await write('other.txt', 'other', 'new')).value!.draft)
  await choices(() => show(), [
    [first, ['warm.css']],
    [next, ['next.txt']],
    [other, ['other.txt']],
  ])
  for (let draft of [first, next]) await run('app_deploy', { app, draft })
  for (let call of [() => show(first), () => held(app, first)]) {
    let { message } = await throws(
      call,
      `was released as v1. The live version is v2.`,
    ) as Error
    ok(message.includes(other) && message.includes('other.txt'), message)
  }
  equal((await show(first, true)).value!.version, 2)

  await run('app_files', { app, op: 'discard', draft: other })
  for (let call of [() => show(other), () => write('new.txt', 'new', other)]) {
    let { message } = await throws(
      call,
      'may have been released or discarded',
    ) as Error
    ok(
      message.includes('An app_files write without draft opens a new draft.'),
      message,
    )
  }
  await throws(
    () => show(),
    'An app_files write without draft opens a new draft.',
  )
  equal(
    await held(app),
    await shas({ ...OWN[0], 'notes.txt': 'mine', 'next.txt': 'next' }),
  )
  let fresh = (await write('new.txt', 'new')).value!.draft
  equal(await open(app), [fresh])
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
  let missing = await throws(
    () => run('app_files', { app, op: 'read', path: 'NOTES.md' }),
    'To create it, call app_files with',
  )
  let create = JSON.parse((missing as Error).message.match(/\{.*\}/)![0])
  equal([create.app, create.draft, create.op, create.path], [
    app,
    out.value!.draft,
    'write',
    'NOTES.md',
  ])
  // A refused argument ends with the whole shape its op takes.
  await throws(
    () => run('app_files', { app, content: 'x' }),
    'path is required — write takes path and content',
  )
})
