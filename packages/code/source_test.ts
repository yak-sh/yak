// Commit-pinned resolution against a code sync's records, served over the same
// HTTP query door as the fleet. Newer and dirty files must not change the answer.

import { equal, ok, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { gitDoc } from '@yaks/git'
import { run } from '@yaks/git/land'
import { codeDoc } from './vocab.ts'
import { codeMirror } from './sync.ts'
import { sync } from '@yaks/mirror'
import { ask } from '@yaks/api'
import { catalogAt, remembered, sourceFrames, sourcePath } from './source.ts'

let sources = {
  roots: ['/srv/app', '/srv/tree'],
  origins: ['https://box.test'],
}
test('source paths require a known root or origin and reject traversal', () => {
  equal(sourcePath('file:///srv/tree/a%20b.ts?token=x', sources), 'a b.ts')
  equal(
    sourcePath('https://box.test/packages/a.ts?token=x', sources),
    'packages/a.ts',
  )
  for (
    let file of [
      'file:///etc/passwd',
      'file:///srv/apple/a.ts',
      'file://host/srv/app/a.ts',
      'file:///srv/app/../app/a.ts',
      'https://box.test/%2e%2e/a.ts',
      'https://box.test/%ZZ',
      'https://evil.test/a.ts',
      'data:text/plain,secret',
      'https://user:secret@box.test/a.ts',
      'file:///srv/app/a%00.ts',
    ]
  ) equal(sourcePath(file, sources), undefined)
})

test('a remembered catalog asks again after a failure or once its answers age', async () => {
  let asked = 0
  let down = true
  let catalog = remembered({
    get: (ids) =>
      ++asked && down
        ? Promise.reject(Error('catalog down'))
        : Promise.resolve(ids.map((eid) => ({ entity: { eid } }))),
  }, 20)
  await catalog.get(['f']).then(() => ok(false), () => ok(true))
  down = false
  equal((await catalog.get(['f'])).length, 1)
  equal((await catalog.get(['f'])).length, 1)
  equal(asked, 2)
  await new Promise((wait) => setTimeout(wait, 25))
  await catalog.get(['f'])
  equal(asked, 3)
})

test('frames resolve only cataloged exports of the exact failing commit', async () => {
  let dir = await Deno.makeTempDir()
  let git = async (...args: string[]) => {
    let got = await run(args, dir)
    if (!got.ok) throw Error(got.err)
    return got.out.trim()
  }
  try {
    await git('init', '-q')
    await Deno.writeTextFile(
      `${dir}/deno.json`,
      '{"name":"@test/code","exports":"./a.ts"}',
    )
    await Deno.writeTextFile(
      `${dir}/a.ts`,
      'export let fail = () => { throw Error("old") }\nlet hidden = () => 0\n',
    )
    await Deno.mkdir(`${dir}/vendor`)
    await Deno.writeTextFile(`${dir}/vendor/dep.ts`, 'export let fail = 1\n')
    await git('add', '.')
    await git(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-qm',
      'old',
    )
    let old = await git('rev-parse', 'HEAD')
    let vocab = loadVocab([kernelDoc, docDoc, edgeDoc, gitDoc, codeDoc], [
      kernelKeywords,
      edgeKeywords,
    ])
    let g = graph({ vocab, storage: ram(vocab) })
    let pass = async () => sync((await codeMirror(g, dir)).binding)
    equal((await pass()).failed, [])
    let [exported] = await g.read('.symbol.name=fail')
    equal(
      exported.symbol && typeof exported.symbol == 'object' &&
        'line' in exported.symbol && exported.symbol.line,
      1,
    )
    let send: typeof fetch = (url, init) => ask(g, new Request(url, init))
    let resolver = sourceFrames(
      { cwd: dir, url: 'http://catalog.test' },
      catalogAt('http://catalog.test', send),
    )
    let frames = [
      { file: `file://${dir}/vendor/dep.ts`, function: 'fail' },
      { file: `file://${dir}/a.ts`, function: 'fail' },
      { file: `file://${dir}/a.ts`, function: 'hidden' },
      { file: `file://${dir}/a.ts`, function: 'Object.fail' },
      { file: 'http://catalog.test/a.ts', function: 'fail' },
      { file: 'http://catalog.test/web/app.js', function: 'fail' },
      { file: 'http://else.test/a.ts', function: 'fail' },
    ]
    let first = await resolver(frames, old)
    equal(first[0].app, false)
    ok(first[1].module && first[1].symbol)
    ok(first[2].module && !first[2].symbol)
    ok(first[3].module && !first[3].symbol)
    equal(first[4].symbol, first[1].symbol)
    equal(first[5].app, false)
    equal(first[6].app, false)
    equal(
      (await resolver([{ ...frames[1], line: -1 }], old))[0].symbol,
      undefined,
    )
    await Deno.writeTextFile(`${dir}/a.ts`, 'export let fail = () => 2\n')
    // Mutable checkout bytes are irrelevant while the catalog still matches.
    equal((await resolver(frames, old))[1].symbol, first[1].symbol)
    await git('add', '.')
    await git(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-qm',
      'new',
    )
    let newer = await git('rev-parse', 'HEAD')
    await pass()
    let changed = await resolver(frames, old)
    equal(changed[1].app, true)
    equal(changed[1].module, undefined)
    equal(changed[1].symbol, undefined)
    equal((await resolver(frames, newer))[1].symbol, first[1].symbol)
    equal((await resolver(frames, 'HEAD'))[1].module, undefined)
    equal((await resolver(frames, 'a'.repeat(40)))[1].module, undefined)
    equal(
      (await sourceFrames({ cwd: dir, url: 'http://catalog.test' }, {
        get: () => Promise.resolve([]),
      })(frames, newer))[1].module,
      undefined,
    )
    // What a resolver read of Git it keeps, so a run costs no process, and a
    // checkout gone bad meanwhile changes no answer.
    let kept = await resolver(frames, newer)
    await Deno.rename(`${dir}/.git`, `${dir}/.git-gone`)
    equal(await resolver(frames, newer), kept)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
