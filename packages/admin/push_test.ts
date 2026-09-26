// A push through a platform that keeps apps in memory: after it, the app holds
// exactly the directory's files and has been released once.
import { assertEquals, assertRejects } from '@std/assert'
import { type Ask, type File, fileOf, push, read } from './push.ts'

type Args = Record<string, unknown> & { files?: File[] }

// yaks.app's app_new, app_files and app_deploy, over apps held in memory,
// answering as the connector does: words for a person, with `more` after them
// (the unseen block), and the answer as data on the bundle that carries them.
let platform = (apps: Record<string, Map<string, File>> = {}, more = '') => {
  let deployed: string[] = []
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
  let ask: Ask = (_method, params) => {
    let { name, arguments: a } = params as { name: string; arguments: Args }
    let app = String(a.app ?? a.slug)
    let files = apps[app]
    if (name == 'app_new') {
      return Promise.resolve(ok(`${apps[app] = new Map()}`))
    }
    if (!files) return Promise.resolve(no(`no app ${app}`))
    if (name == 'app_deploy') deployed.push(app)
    else if (a.op == 'list') {
      let paths = [...files.keys()]
      return Promise.resolve(
        ok(paths.join('\n'), { files: paths.map((path) => ({ path })) }),
      )
    } else if (a.op == 'delete') {
      if (!files.delete(String(a.path))) {
        return Promise.resolve(no(`no file ${a.path}`))
      }
    } else for (let f of a.files!) files.set(f.path, f)
    return Promise.resolve(ok('done'))
  }
  let held = (app: string) => [...apps[app].keys()].sort()
  return { ask, held, deployed }
}

let file = (path: string): File => ({ path, content: path })
let held = (...paths: string[]) => new Map(paths.map((p) => [p, file(p)]))

Deno.test('a push leaves the app holding exactly the directory, released once', async () => {
  let p = platform({ mail: held('index.html', 'old.js') })
  let said = await push(p.ask, [file('index.html'), file('new.js')], {
    app: 'mail',
  })
  assertEquals(p.held('mail'), ['index.html', 'new.js'])
  assertEquals(p.deployed, ['mail'])
  assertEquals(said[0], 'wrote 2 files, deleted old.js')
})

Deno.test('a list whose words carry more than the files still yields the files', async () => {
  let p = platform(
    { mail: held('index.html', 'old.js') },
    '\n\n## unseen errors\n- 2026-09-26 page /mail/ — boom is not a function',
  )
  let said = await push(p.ask, [file('index.html')], { app: 'mail' })
  assertEquals(p.held('mail'), ['index.html'])
  assertEquals(said[0], 'wrote 1 file, deleted old.js')
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
})
