// Parse runtime stacks and enrich grouped occurrences without replaying their
// counters. Unknown code remains useful text, never a guessed global link.

import { equal, ok, test } from '@yaks/testing'
import { enrichFrames, stackFrames } from './frames.ts'
import { fixture } from './fixture_test.ts'
import { group, reframe } from './group.ts'
import { comp } from './model.ts'
import { capture } from './report.ts'

let commit = 'a'.repeat(40)
let module = crypto.randomUUID(), symbol = crypto.randomUUID()

let stack = `TypeError: no row
    at async fail (file:///srv/app/a.ts?secret=x:10:3)
    at file:///srv/app/b.ts:9:2
hidden@https://box.test/c.ts?q=private:4:5
Caused by: Error: inner
    at nested (ext:core/01_core.js:18:7)
    at bad (native)
`
test('Deno and browser stack parsing retains order, causes and locations', () => {
  equal(stackFrames(stack), [
    { file: 'file:///srv/app/a.ts', line: 10, column: 3, function: 'fail' },
    { file: 'file:///srv/app/b.ts', line: 9, column: 2 },
    { file: 'https://box.test/c.ts', line: 4, column: 5, function: 'hidden' },
    { file: 'ext:core/01_core.js', line: 18, column: 7, function: 'nested' },
  ])
  equal(stackFrames('Error: message@not a stack\n at one (file:///a.ts:4)'), [
    { file: 'file:///a.ts', line: 4, function: 'one' },
  ])
})

test('later frame resolution fills a culprit without recounting its group', async () => {
  let g = fixture()
  let error = new Error('broken')
  error.stack = stack
  await g.apply(
    capture(error, {
      sink: () => {},
      eid: 'occurrence',
      commit,
    }),
    { trusted: true },
  )
  await group(g, 'occurrence')
  let [bug] = await g.read('.bug *')
  equal(comp(bug, 'bug').hits, 1)
  ok(comp(bug, 'bug').spot)
  let enrich = enrichFrames((frames, revision) => {
    equal(revision, commit)
    return Promise.resolve(frames.map((f, i) => ({
      ...f,
      app: i == 1,
      ...i == 1 ? { module, symbol } : {},
    })))
  })
  await reframe(g, 'occurrence', enrich)
  await reframe(g, 'occurrence', enrich)
  let [full] = await g.get(['occurrence'])
  let [filled] = await g.read('.bug *')
  equal(comp(filled, 'bug').hits, 1)
  equal(comp(filled, 'bug').culprit, symbol)
  ok(!comp(filled, 'bug').spot)
  equal(comp(full, 'error').commit, commit)
  equal(
    comp(full, 'exception').frames,
    await enrich(full).then((r) => comp(r, 'exception').frames),
  )
})

test('reporter-supplied links are not trusted and console errors need no frames', async () => {
  let row = {
    entity: { eid: 'reported' },
    error: {},
    exception: {
      frames: [{
        file: 'https://box.test/a.ts?secret=x',
        line: 1,
        function: 'fail',
        app: true,
        module: 'invented',
        symbol: 'invented',
      }],
    },
  }
  equal(comp(await enrichFrames()(row), 'exception').frames, [
    { file: 'https://box.test/a.ts', line: 1, function: 'fail', app: false },
  ])
  let console = { entity: { eid: 'message' }, error: { message: 'failed' } }
  equal(await enrichFrames()(console), console)
})
