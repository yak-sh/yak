// An asset build as data: what it names by its bytes, what it writes, and
// what it serves.
import * as io from '@yaks/file/io'
import { equal, test } from '@yaks/testing'
import { type Asset, plan, served, write } from './assets.ts'

let encoded = (files: Record<string, string>) => (name: string) =>
  new TextEncoder().encode(files[name] ?? '')
let decoded = (bytes?: Uint8Array) => new TextDecoder().decode(bytes)
let hashed = (name: string) =>
  `_yak/${name.replace(/(\.\w+)$/, '.[0-9a-f]{10}$1')}`

test('assets: a named sheet holds its imports in place and names what it points at', () => {
  let sources = {
    'style.css': "@import url('kit.css');\na { color: red }",
    'kit.css': 'b { background: url("pencil.svg#line") } ' +
      'i { background: url(data:x) } u { background: url(https://a.b/c.png) }',
    'pencil.svg': '<svg/>',
  }
  let { files, names } = plan(
    [{ name: 'style.css', named: true }],
    encoded(sources),
    (css) => `${css}\n/* halved */`,
  )
  let css = decoded(files.get(names['style.css']))
  let pencil = names['pencil.svg']
  equal(new RegExp(hashed('pencil.svg')).test(pencil), true)
  equal(decoded(files.get(pencil)), '<svg/>')
  equal(
    css,
    `b { background: url(${pencil.slice('_yak/'.length)}#line) } ` +
      'i { background: url(data:x) } u { background: url(https://a.b/c.png) }' +
      '\na { color: red }\n/* halved */',
  )
})

test('assets: a name changes with the bytes and only then, and only a named asset has one', () => {
  let name = (js: string) =>
    plan(
      [{ name: 'menu.js', named: true }, { name: 'data.js' }],
      encoded({ 'menu.js': js }),
    ).names
  equal(name('a()'), name('a()'))
  equal(name('a()')['menu.js'] == name('b()')['menu.js'], false)
  equal(Object.keys(name('a()')), ['menu.js'])
})

test('assets: a build writes what it makes, names it by its bytes, and leaves no earlier names', async () => {
  let to = await io.makeTempDir()
  try {
    await io.mkdir(`${to}/_yak`)
    await io.mkdir(`${to}/_kit`)
    await io.writeTextFile(`${to}/_yak/menu.0123456789.js`, 'old')
    await io.writeTextFile(`${to}/_kit/old.css`, 'old')
    await io.writeTextFile(`${to}/kept.js`, 'kept()')
    let assets: Asset[] = [
      { name: 'menu.js', body: () => 'menu()', named: true },
      { name: 'kept.js', named: true },
      { name: '_kit/new.css', body: () => new TextEncoder().encode('a{}') },
      { name: 'asset.ts', file: new URL('./assets.ts', import.meta.url) },
    ]
    await write(to, assets, { fresh: ['_kit'] })
    let read = (path: string) => io.readTextFile(`${to}/${path}`)
    let names = plan(assets, (name) => io.readFileSync(`${to}/${name}`)).names
    equal(
      await Promise.all(
        ['menu.js', names['menu.js'], names['kept.js'], '_kit/new.css'].map(
          read,
        ),
      ),
      ['menu()', 'menu()', 'kept()', 'a{}'],
    )
    equal(
      await read('asset.ts'),
      await io.readTextFile(new URL('./assets.ts', import.meta.url)),
    )
    equal(
      [...io.readDirSync(`${to}/_yak`)].map((f) => f.name).toSorted(),
      [names['kept.js'], names['menu.js']].map((at) => at.slice(5)).toSorted(),
    )
    equal([...io.readDirSync(`${to}/_kit`)].map((f) => f.name), ['new.css'])
  } finally {
    await io.remove(to, { recursive: true })
  }
})

test('assets: each is served at its address, with its type', async () => {
  let routes = served([
    { name: 'styles.css', body: () => 'a{}' },
    { name: 'icon.png', body: () => new Uint8Array([1, 2]) },
  ], '/web/')
  equal(routes.map((r) => [r.method, r.path]), [
    ['GET', '/web/styles.css'],
    ['GET', '/web/icon.png'],
  ])
  let answers = await Promise.all(
    routes.map((r) => r.handle(new Request(`http://x${r.path}`))),
  )
  equal(answers.map((a) => a.headers.get('content-type')), [
    'text/css; charset=utf-8',
    'image/png',
  ])
  equal(await answers[0].text(), 'a{}')
  equal([...new Uint8Array(await answers[1].arrayBuffer())], [1, 2])
})
