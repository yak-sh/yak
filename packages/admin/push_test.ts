// A push through a platform that keeps apps in memory: after it, the app holds
// exactly the directory's files and has been released once.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type Ask,
  type File,
  fileOf,
  push,
  type PushProgress,
  read,
  versions,
} from './push.ts'

type Args = Record<string, unknown> & { files?: File[] }

// yaks.app's app_new, app_files and app_deploy, over apps held in memory,
// answering as the connector does: words for a person, with `more` after them
// (the unseen block), and the answer as data on the bundle that carries them.
let platform = (
  apps: Record<string, Map<string, File>> = {},
  more = '',
  valuesAfter = 0,
  running = 0,
) => {
  let deployed: string[] = []
  let writes: string[][] = []
  let released = new Map(
    Object.entries(apps).map(([app, files]) => [app, new Map(files)]),
  )
  let lists = 0
  let versions = new Map(Object.keys(apps).map((app) => [app, 1]))
  let bases: unknown[] = []
  let past = new Map<string, string[]>()
  let ok = (text: string, value?: Record<string, unknown>) => ({
    content: [{ type: 'text', text: text + more }],
    structuredContent: {
      result: [{
        entity: { eid: '$said' },
        content: { body: text + more },
        ...value ? { output: { value } } : {},
      }],
    },
  })
  let no = (text: string) => ({ ...ok(text), isError: true })
  let ask: Ask = async (_method, params) => {
    let { name, arguments: a } = params as { name: string; arguments: Args }
    let app = String(a.app ?? a.slug)
    let files = apps[app]
    if (name == 'app_new') {
      return ok(`${apps[app] = new Map()}`)
    }
    if (!files) return no(`no app ${app}`)
    if (name == 'app_deploy') {
      bases.push(a.base)
      if (running-- > 0) {
        return ok('app_deploy is still running', {
          running: true,
          asked: '2026-11-06T00:00:00.000Z',
        })
      }
      let version = versions.get(app) ?? 0
      if (typeof a.base == 'number' && a.base < version && !a.confirm) {
        return ok('stale base: confirm to deploy', {
          deployed: false,
          base: a.base,
          version,
          removed: [],
          replaced: [],
        })
      }
      deployed.push(app)
      released.set(app, new Map(files))
      versions.set(app, ++version)
      return ok('done', { deployed: true, version })
    } else if (a.op == 'list') {
      let paths = [...files.keys()]
      let live = released.get(app)
      return ok(
        paths.join('\n'),
        ++lists > valuesAfter
          ? {
            files: await Promise.all(paths.map(async (path) => ({
              path,
              sha: await hash(files.get(path)!),
            }))),
            version: versions.get(app) ?? 0,
            unreleased: !live || paths.length != live.size ||
              (await Promise.all(paths.map(async (path) =>
                live.has(path) &&
                (files.get(path) == live.get(path) ||
                  await hash(files.get(path)!) == await hash(live.get(path)!))
              ))).includes(false),
          }
          : valuesAfter == Infinity
          ? undefined
          : {
            files: paths.map((path) => ({ path })),
          },
      )
    } else if (a.op == 'read') {
      let f = files.get(String(a.path))
      if (!f || !('content' in f)) return no(`no file ${a.path}`)
      return ok(f.content, {
        version: versions.get(app) ?? 0,
        sha: await hash(f),
        content: f.content,
      })
    } else if (a.op == 'history') {
      let f = files.get(String(a.path))
      return ok('history', {
        now: f ? await hash(f) : null,
        replaced: (past.get(`${app}/${a.path}`) ?? []).map((sha) => ({ sha })),
      })
    } else if (a.op == 'delete') {
      if (!files.delete(String(a.path))) {
        return no(`no file ${a.path}`)
      }
    } else if (a.files) {
      writes.push(a.files.map((f) => f.path))
      for (let f of a.files) {
        let was = files.get(f.path)
        let key = `${app}/${f.path}`
        if (was) past.set(key, [await hash(was), ...past.get(key) ?? []])
        files.set(f.path, f)
      }
    }
    return ok('done')
  }
  let held = (app: string) => [...apps[app].keys()].sort()
  return { ask, held, deployed, writes, bases, lists: () => lists }
}

let examples = new Map<string, File>()
let file = (path: string): File => {
  let saved = examples.get(path)
  if (!saved) examples.set(path, saved = { path, content: path })
  return saved
}
let held = (...paths: string[]) => new Map(paths.map((p) => [p, file(p)]))
// The platform keeps a file's address with its immutable bytes.
let hashes = new WeakMap<File, Promise<string>>()
let hash = (f: File): Promise<string> => {
  let saved = hashes.get(f)
  if (saved) return saved
  let result = digest(f)
  hashes.set(f, result)
  return result
}
let digest = async (f: File) => {
  let bytes = 'content' in f
    ? new TextEncoder().encode(f.content)
    : Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
}

test('a push sends the version it read and remembers its deployed version', async () => {
  let p = platform({ mail: held('index.html') })
  let seen: number[] = []
  await push(p.ask, [file('new.js')], { app: 'mail' }, {
    remember: (version: number) => {
      seen.push(version)
    },
  })
  assertEquals(p.bases, [1])
  assertEquals(seen, [1, 2])
})

test('a release still running is asked for again until it says how it ended', async () => {
  let p = platform({ mail: held('index.html') }, '', 0, 2)
  let seen: number[] = []
  await push(p.ask, [file('new.js')], { app: 'mail' }, {
    remember: (version: number) => {
      seen.push(version)
    },
  })
  assertEquals(p.bases, [1, 1, 1])
  assertEquals(p.deployed, ['mail'])
  assertEquals(seen, [1, 2])
})

test('a stale push keeps its base through a fresh list and explicit confirmation', async () => {
  let p = platform({ mail: held('index.html') })
  await push(p.ask, [file('index.html'), file('new.js')], { app: 'mail' })
  let seen: number[] = []
  let opts = {
    base: 1,
    remember: (version: number) => {
      seen.push(version)
    },
  }
  let said = await push(
    p.ask,
    [file('index.html')],
    { app: 'mail' },
    opts,
  )
  assertEquals(p.deployed.length, 1)
  assertEquals(p.bases, [1, 1])
  assertEquals(seen, [])
  assert(said.at(-1)?.includes('confirm'))
  await push(p.ask, [file('index.html')], { app: 'mail' }, {
    ...opts,
    confirm: true,
  })
  assertEquals(p.bases, [1, 1, 1])
  assertEquals(p.deployed.length, 2)
  assertEquals(seen, [3])
})

test('a base past live writes nothing until confirmed, then pushes from live', async () => {
  let p = platform({ mail: held('index.html') })
  let seen: number[] = []
  let opts = {
    base: 2,
    remember: (version: number) => {
      seen.push(version)
    },
  }
  let said = await push(p.ask, [file('new.js')], { app: 'mail' }, opts)
  assert(said.at(-1)?.includes('--confirm'))
  assertEquals([p.writes, p.deployed, p.held('mail'), seen], [
    [],
    [],
    ['index.html'],
    [],
  ])
  await push(p.ask, [file('new.js')], { app: 'mail' }, {
    ...opts,
    confirm: true,
  })
  assertEquals([p.bases, p.held('mail'), seen], [[1], ['new.js'], [1, 2]])
})

// Persistence happens through the same boundary the CLI uses, prepared once
// so assertions measure the behavior rather than filesystem scheduling.
let remembered = await (async () => {
  let dir = await Deno.makeTempDir()
  try {
    let p = platform({ mail: held('index.html') })
    let files = [file('index.html')]
    let to = { app: 'mail' }
    await push(p.ask, files, to, await versions(dir, 'checkout-a/account/mail'))
    await push(p.ask, files, to, await versions(dir, 'checkout-b/account/mail'))
    await push(
      p.ask,
      [...files, file('new.js')],
      to,
      await versions(dir, 'checkout-a/account/mail'),
    )
    let old = await versions(dir, 'checkout-b/account/mail')
    let latest = await versions(dir, 'checkout-a/account/mail')
    await push(p.ask, files, to, old)
    let declined = (await versions(dir, 'checkout-b/account/mail')).base
    await push(p.ask, files, to, {
      ...await versions(dir, 'checkout-b/account/mail'),
      confirm: true,
    })
    return {
      latest: latest.base,
      old: old.base,
      declined,
      confirmed: (await versions(dir, 'checkout-b/account/mail')).base,
      other: (await versions(dir, 'checkout-b/other-account/mail')).base,
      bases: p.bases,
    }
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})()

test('checkout versions survive reopening and stay separate by target', () => {
  assertEquals(remembered, {
    latest: 2,
    old: 1,
    declined: 1,
    confirmed: 3,
    other: undefined,
    bases: [1, 1, 1],
  })
})

test('a push leaves the app holding exactly the directory, released once', async () => {
  let p = platform({ mail: held('index.html', 'old.js') })
  let said = await push(p.ask, [file('index.html'), file('new.js')], {
    app: 'mail',
  })
  assertEquals(p.held('mail'), ['index.html', 'new.js'])
  assertEquals(p.deployed, ['mail'])
  assertEquals(p.writes, [['new.js']])
  assertEquals(said[0], 'wrote 1 file, deleted old.js')
})

test('a changed file is written and an unchanged file is left alone', async () => {
  let p = platform({ mail: held('index.html', 'icon.png') })
  let files = [
    { path: 'index.html', content: 'new page' },
    file('icon.png'),
  ]
  let said = await push(p.ask, files, { app: 'mail' })
  assertEquals(p.writes, [['index.html']])
  assertEquals(p.deployed, ['mail'])
  assertEquals(said[0], 'wrote 1 file')
})

test('a released app with the same bytes causes no write or deploy', async () => {
  let p = platform({
    mail: new Map([
      ['index.html', { path: 'index.html', content: 'é' }],
      ['icon.png', { path: 'icon.png', base64: 'iVD/' }],
    ]),
  })
  let files = [
    { path: 'index.html', content: 'é' },
    { path: 'icon.png', base64: 'iVD/' },
  ]
  assertEquals(await push(p.ask, files, { app: 'mail' }), ['no files changed'])
  assertEquals(p.writes, [])
  assertEquals(p.deployed, [])
})

test('the lock the compile wrote stays while its package.json is pushed', async () => {
  let p = platform({
    mail: held('package.json', 'package-lock.json', 'site/package-lock.json'),
  })
  assertEquals(await push(p.ask, [file('package.json')], { app: 'mail' }), [
    'wrote 0 files, deleted site/package-lock.json',
    'done',
  ])
  assertEquals(await push(p.ask, [file('package.json')], { app: 'mail' }), [
    'no files changed',
  ])
  assertEquals(p.held('mail'), ['package-lock.json', 'package.json'])
  assertEquals(p.deployed, ['mail'])
})

let retryPlatform = platform({ mail: held('index.html') })
let retryFiles = [file('index.html'), file('new.js')]
let lostDeploy: Ask = (method, params) => {
  let { name } = params as { name: string }
  if (name == 'app_deploy') throw new Error('transport lost before deploy')
  return retryPlatform.ask(method, params)
}
let failedDeploy: unknown
try {
  await push(lostDeploy, retryFiles, { app: 'mail' })
} catch (error) {
  failedDeploy = error
}

test('a retry releases files written before the deploy failed', async () => {
  let p = retryPlatform
  let files = retryFiles
  assert(failedDeploy instanceof Error)
  assertEquals(p.writes, [['new.js']])
  assertEquals(p.deployed, [])
  assertEquals(await push(p.ask, files, { app: 'mail' }), [
    'wrote 0 files',
    'done',
  ])
  assertEquals(p.writes, [['new.js']])
  assertEquals(p.deployed, ['mail'])
})

test('a large directory fits bounded calls before deletion and deploy', async () => {
  let p = platform({ mail: held('old.js') })
  let files = Array.from({ length: 40 }, (_, i) => ({
    path: `part-${i}.js`,
    content: 'x'.repeat(12_000),
  }))
  let calls: string[] = []
  let ask: Ask = (method, params) => {
    let { name, arguments: a } = params as { name: string; arguments: Args }
    let op = a.files ? 'write' : String(a.op ?? name)
    if (a.files) {
      if (a.files.length > 20 || JSON.stringify(params).length > 270_000) {
        throw new Error('app_files call too large')
      }
    }
    calls.push(op)
    return p.ask(method, params)
  }
  let progress: PushProgress[] = []
  await push(ask, files, { app: 'mail' }, {
    progress: (event) => progress.push(event),
  })
  assertEquals(p.held('mail'), files.map((f) => f.path).sort())
  assertEquals(p.deployed, ['mail'])
  assertEquals(calls.at(-2), 'delete')
  assertEquals(calls.at(-1), 'app_deploy')
  let uploaded = progress.filter((p) =>
    p.phase == 'upload' && p.state == 'done'
  )
  assertEquals(uploaded.at(-1), {
    phase: 'upload',
    state: 'done',
    done: files.length,
    total: files.length,
    batch: 8,
  })
  assertEquals(uploaded.length > 1, true)
})

test('progress marks each remote operation before it waits and after it answers', async () => {
  let p = platform({ mail: held('old.js') })
  let events: PushProgress[] = []
  let ask: Ask = (method, params) => {
    let { name, arguments: a } = params as { name: string; arguments: Args }
    let phase = name == 'app_deploy'
      ? 'deploy'
      : a.op == 'list'
      ? 'list'
      : a.op == 'delete'
      ? 'delete'
      : 'upload'
    assertEquals(events.at(-1)?.phase, phase)
    assertEquals(events.at(-1)?.state, 'start')
    return p.ask(method, params)
  }
  await push(ask, [file('new.js')], { app: 'mail' }, {
    progress: (event) => events.push(event),
  })
  assertEquals(events.map((e) => `${e.phase}:${e.state}`), [
    'list:start',
    'list:done',
    'hash:start',
    'hash:done',
    'upload:start',
    'upload:done',
    'delete:start',
    'delete:done',
    'deploy:start',
    'deploy:done',
  ])
})

test('large files are split by request size', async () => {
  let p = platform({ mail: held() })
  let files = Array.from({ length: 3 }, (_, i) => ({
    path: `large-${i}.js`,
    content: 'x'.repeat(140_000),
  }))
  let calls = 0
  let ask: Ask = (method, params) => {
    let { arguments: a } = params as { arguments: Args }
    if (a.files) {
      calls++
      if (JSON.stringify(params).length > 200_000) {
        throw new Error('app_files call too large')
      }
    }
    return p.ask(method, params)
  }
  await push(ask, files, { app: 'mail' })
  assertEquals(p.held('mail'), files.map((f) => f.path))
  assertEquals(p.deployed, ['mail'])
  assertEquals(calls > 1, true)
})

test('an interrupted push can be run again before deletion or deploy', async () => {
  let p = platform({ mail: held('old.js') })
  let files = Array.from({ length: 40 }, (_, i) => file(`part-${i}.js`))
  let writes = 0
  let ask: Ask = async (method, params) => {
    let { name, arguments: a } = params as { name: string; arguments: Args }
    let answer = await p.ask(method, params)
    if (name == 'app_files' && a.files && ++writes == 2) {
      throw new Error('transport lost after write')
    }
    return answer
  }
  await assertRejects(
    () => push(ask, files, { app: 'mail' }),
    Error,
    'transport lost after write',
  )
  assertEquals(p.held('mail').includes('old.js'), true)
  assertEquals(p.deployed, [])
  await push(p.ask, files, { app: 'mail' })
  assertEquals(p.held('mail'), files.map((f) => f.path).sort())
  assertEquals(p.deployed, ['mail'])
})

test('a list whose words carry more than the files still yields the files', async () => {
  let p = platform(
    { mail: held('index.html', 'old.js') },
    '\n\n## unseen errors\n- 2026-09-26 page /mail/ — boom is not a function',
  )
  let said = await push(p.ask, [file('index.html')], { app: 'mail' })
  assertEquals(p.held('mail'), ['index.html'])
  assertEquals(said[0], 'wrote 0 files, deleted old.js')
})

test('a push waits for a deploying server to answer file hashes', async () => {
  let p = platform({ mail: held('index.html', 'old.js') }, '', 1)
  let said = await push(
    p.ask,
    [file('index.html')],
    { app: 'mail' },
    { wait: 100, poll: 0 },
  )
  assertEquals(p.lists(), 2)
  assertEquals(p.held('mail'), ['index.html'])
  assertEquals(p.deployed, ['mail'])
  assertEquals(said[0], 'wrote 0 files, deleted old.js')
})

test('a server that keeps answering no list data changes nothing', async () => {
  let p = platform({ mail: held('index.html', 'old.js') }, '', Infinity)
  await assertRejects(
    () =>
      push(
        p.ask,
        [file('index.html')],
        { app: 'mail' },
        { wait: 0, poll: 0 },
      ),
    Error,
    'app_files answered no file hashes or version after 0s',
  )
  assertEquals(p.lists(), 1)
  assertEquals(p.held('mail'), ['index.html', 'old.js'])
  assertEquals(p.deployed, [])
})

test('malformed list data is a defect immediately', async () => {
  let calls = 0
  let ask: Ask = () => {
    calls++
    return Promise.resolve({
      content: [{ type: 'text', text: 'index.html' }],
      structuredContent: {
        result: [{ output: { value: { files: ['index.html'] } } }],
      },
    })
  }
  await assertRejects(
    () =>
      push(
        ask,
        [file('index.html')],
        { app: 'mail' },
        { wait: 100, poll: 0 },
      ),
    Error,
    'app_files answered malformed file data',
  )
  assertEquals(calls, 1)
})

test('a push to an app that does not exist creates it first', async () => {
  let p = platform()
  await push(p.ask, [file('index.html')], { app: 'mail' })
  assertEquals(p.held('mail'), ['index.html'])
  assertEquals(p.deployed, ['mail'])
})

test('an empty directory pushes nothing', async () => {
  let p = platform()
  await assertRejects(() => push(p.ask, [], { app: 'mail' }))
  assertEquals(p.deployed, [])
})

// The directory is input to the reader, built once before reading it.
let dir = await Deno.makeTempDir()
await Deno.mkdir(`${dir}/js`)
await Deno.writeTextFile(`${dir}/index.html`, '<p>hi')
await Deno.writeTextFile(`${dir}/js/app.js`, 'let a = 1')
await Deno.writeFile(`${dir}/icon.png`, new Uint8Array([0x89, 0x50, 0xff]))
await Deno.writeTextFile(`${dir}/.DS_Store`, 'x')
await Deno.symlink('js/app.js', `${dir}/linked.js`)
await Deno.symlink('js', `${dir}/api`)
let directoryFiles = await read(dir)
await Deno.remove(dir, { recursive: true })
test('a directory reads as text, bytes that are not UTF-8 as base64, linked files as theirs, and no dotfiles or linked directories', () => {
  assertEquals(directoryFiles, [
    { path: 'icon.png', base64: 'iVD/' },
    { path: 'index.html', content: '<p>hi' },
    { path: 'js/app.js', content: 'let a = 1' },
    { path: 'linked.js', content: 'let a = 1' },
  ])
})

test('fileOf keeps UTF-8 as text', () => {
  assertEquals(fileOf('a.txt', new TextEncoder().encode('é')), {
    path: 'a.txt',
    content: 'é',
  })
  assertEquals(fileOf('bom.txt', new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), {
    path: 'bom.txt',
    content: '\ufeffa',
  })
})

test('pictures, PDFs, fonts and sounds are released; a checkout without one keeps the held copy', async () => {
  let p = platform({
    mail: held('index.html', 'stamp.png', 'printable.pdf', 'old.js'),
  })
  let said = await push(
    p.ask,
    ['index.html', 'icon.png', 'fonts/serif.woff2'].map(file),
    { app: 'mail' },
  )
  assertEquals(p.held('mail'), [
    'fonts/serif.woff2',
    'icon.png',
    'index.html',
    'printable.pdf',
    'stamp.png',
  ])
  assertEquals(p.writes, [['icon.png', 'fonts/serif.woff2']])
  assertEquals(said[0], 'wrote 2 files, deleted old.js')
})

test('a checkout without the icon deletes it', async () => {
  let p = platform({ mail: held('index.html', 'icon.png') })
  await push(p.ask, [file('index.html')], { app: 'mail' })
  assertEquals(p.held('mail'), ['index.html'])
})

// The app's copy as the checkout's git, the page and the push each leave it.
let text = (snippets: Record<string, string>) =>
  JSON.stringify(snippets, null, 2) + '\n'
let copy = (snippets: Record<string, string>): File => ({
  path: 'copy.json',
  content: text(snippets),
})
let pushed = { title: 'Mail', send: 'Send', hint: 'Write here' }
let copied = async (
  page: Record<string, string>,
  ours: Record<string, string>,
  earlier: Record<string, string>[] = [pushed],
) => {
  let p = platform({ mail: new Map([['copy.json', copy(pushed)]]) })
  // Save on the page: copy.json written over what the last push left.
  await p.ask('tools/call', {
    name: 'app_files',
    arguments: { app: 'mail', files: [copy(page)] },
  })
  let wrote: string[] = []
  let said = await push(p.ask, [copy(ours)], { app: 'mail' }, {
    checkout: {
      earlier: async function* () {
        for (let e of earlier) yield text(e)
      },
      write: (_path, content) => Promise.resolve(void wrote.push(content)),
    },
  })
  let live = (await p.ask('tools/call', {
    name: 'app_files',
    arguments: { app: 'mail', op: 'read', path: 'copy.json' },
  })) as { content: { text: string }[] }
  return {
    live: JSON.parse(live.content[0].text),
    wrote: wrote.map((text) => JSON.parse(text)),
    kept: said.some((line) => line.includes('edits made on the page')),
  }
}

test('a push keeps copy edited on the page, and writes it into the checkout', async () => {
  let merged = { title: 'Mail', send: 'Send it', hint: 'Type here', cc: 'Cc' }
  assertEquals(
    await copied(
      { ...pushed, send: 'Send it' },
      { ...pushed, hint: 'Type here', cc: 'Cc' },
    ),
    { live: merged, wrote: [merged], kept: true },
  )
})

test('a push takes the page’s text over the checkout’s for a key both changed', async () => {
  let page = { ...pushed, send: 'Send it' }
  assertEquals(await copied(page, { ...pushed, send: 'Post' }), {
    live: page,
    wrote: [page],
    kept: true,
  })
})

test('a push with no version in common with the app takes every page key', async () => {
  let page = { ...pushed, send: 'Send it' }
  assertEquals(await copied(page, { ...pushed, title: 'Post' }, []), {
    live: page,
    wrote: [page],
    kept: true,
  })
})

test('a push of copy the page never touched sends the checkout’s as it is', async () => {
  let ours = { ...pushed, title: 'Post' }
  assertEquals(await copied(pushed, ours), {
    live: ours,
    wrote: [],
    kept: false,
  })
})
