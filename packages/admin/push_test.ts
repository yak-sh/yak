// A push through a platform that keeps apps in memory: after it, the app holds
// exactly the directory's files and has been released once.
import { assertEquals, assertRejects } from '@std/assert'
import {
  type Ask,
  type File,
  fileOf,
  push,
  type PushProgress,
  read,
} from './push.ts'

type Args = Record<string, unknown> & { files?: File[] }

// yaks.app's app_new, app_files and app_deploy, over apps held in memory,
// answering as the connector does: words for a person, with `more` after them
// (the unseen block), and the answer as data on the bundle that carries them.
let platform = (
  apps: Record<string, Map<string, File>> = {},
  more = '',
  valuesAfter = 0,
) => {
  let deployed: string[] = []
  let writes: string[][] = []
  let released = new Map(
    Object.entries(apps).map(([app, files]) => [app, new Map(files)]),
  )
  let lists = 0
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
      deployed.push(app)
      released.set(app, new Map(files))
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
            unreleased: !live || paths.length != live.size ||
              (await Promise.all(paths.map(async (path) =>
                live.has(path) &&
                await hash(files.get(path)!) == await hash(live.get(path)!)
              ))).includes(false),
          }
          : valuesAfter == Infinity
          ? undefined
          : {
            files: paths.map((path) => ({ path })),
          },
      )
    } else if (a.op == 'delete') {
      if (!files.delete(String(a.path))) {
        return no(`no file ${a.path}`)
      }
    } else if (a.files) {
      writes.push(a.files.map((f) => f.path))
      for (let f of a.files) files.set(f.path, f)
    }
    return ok('done')
  }
  let held = (app: string) => [...apps[app].keys()].sort()
  return { ask, held, deployed, writes, lists: () => lists }
}

let file = (path: string): File => ({ path, content: path })
let held = (...paths: string[]) => new Map(paths.map((p) => [p, file(p)]))
let hash = async (f: File) => {
  let bytes = 'content' in f
    ? new TextEncoder().encode(f.content)
    : Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.test('a push leaves the app holding exactly the directory, released once', async () => {
  let p = platform({ mail: held('index.html', 'old.js') })
  let said = await push(p.ask, [file('index.html'), file('new.js')], {
    app: 'mail',
  })
  assertEquals(p.held('mail'), ['index.html', 'new.js'])
  assertEquals(p.deployed, ['mail'])
  assertEquals(p.writes, [['new.js']])
  assertEquals(said[0], 'wrote 1 file, deleted old.js')
})

Deno.test('a changed file is written and an unchanged file is left alone', async () => {
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

Deno.test('a released app with the same bytes causes no write or deploy', async () => {
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

Deno.test('a retry releases files written before the deploy failed', async () => {
  let p = platform({ mail: held('index.html') })
  let files = [file('index.html'), file('new.js')]
  let ask: Ask = (method, params) => {
    let { name } = params as { name: string }
    if (name == 'app_deploy') throw new Error('transport lost before deploy')
    return p.ask(method, params)
  }
  await assertRejects(() => push(ask, files, { app: 'mail' }))
  assertEquals(p.writes, [['new.js']])
  assertEquals(p.deployed, [])
  assertEquals(await push(p.ask, files, { app: 'mail' }), [
    'wrote 0 files',
    'done',
  ])
  assertEquals(p.writes, [['new.js']])
  assertEquals(p.deployed, ['mail'])
})

Deno.test('a large directory fits bounded calls before deletion and deploy', async () => {
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

Deno.test('progress marks each remote operation before it waits and after it answers', async () => {
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

Deno.test('large files are split by request size', async () => {
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

Deno.test('an interrupted push can be run again before deletion or deploy', async () => {
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

Deno.test('a list whose words carry more than the files still yields the files', async () => {
  let p = platform(
    { mail: held('index.html', 'old.js') },
    '\n\n## unseen errors\n- 2026-09-26 page /mail/ — boom is not a function',
  )
  let said = await push(p.ask, [file('index.html')], { app: 'mail' })
  assertEquals(p.held('mail'), ['index.html'])
  assertEquals(said[0], 'wrote 0 files, deleted old.js')
})

Deno.test('a push waits for a deploying server to answer file hashes', async () => {
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

Deno.test('a server that keeps answering no list data changes nothing', async () => {
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
    'app_files answered no file hashes after 0s',
  )
  assertEquals(p.lists(), 1)
  assertEquals(p.held('mail'), ['index.html', 'old.js'])
  assertEquals(p.deployed, [])
})

Deno.test('malformed list data is a defect immediately', async () => {
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

Deno.test('a push to an app that does not exist creates it first', async () => {
  let p = platform()
  await push(p.ask, [file('index.html')], { app: 'mail' })
  assertEquals(p.held('mail'), ['index.html'])
  assertEquals(p.deployed, ['mail'])
})

Deno.test('an empty directory pushes nothing', async () => {
  let p = platform()
  await assertRejects(() => push(p.ask, [], { app: 'mail' }))
  assertEquals(p.deployed, [])
})

Deno.test('a directory reads as text, bytes that are not UTF-8 as base64, and no dotfiles', async () => {
  let dir = await Deno.makeTempDir()
  await Deno.mkdir(`${dir}/js`)
  await Deno.writeTextFile(`${dir}/index.html`, '<p>hi')
  await Deno.writeTextFile(`${dir}/js/app.js`, 'let a = 1')
  await Deno.writeFile(`${dir}/icon.png`, new Uint8Array([0x89, 0x50, 0xff]))
  await Deno.writeTextFile(`${dir}/.DS_Store`, 'x')
  assertEquals(await read(dir), [
    { path: 'icon.png', base64: 'iVD/' },
    { path: 'index.html', content: '<p>hi' },
    { path: 'js/app.js', content: 'let a = 1' },
  ])
  await Deno.remove(dir, { recursive: true })
})

Deno.test('fileOf keeps UTF-8 as text', () => {
  assertEquals(fileOf('a.txt', new TextEncoder().encode('é')), {
    path: 'a.txt',
    content: 'é',
  })
  assertEquals(fileOf('bom.txt', new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), {
    path: 'bom.txt',
    content: '\ufeffa',
  })
})
