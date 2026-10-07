// A commit's tree is read of Git once per path, whoever asks and however often.

import { equal, test } from '@yaks/testing'
import type { Run } from './land.ts'
import { trees } from './source.ts'

let sha = 'c'.repeat(40)
// Git, as `ls-tree` answers for a commit holding a.ts, refusing while `down`.
let git = () => {
  let asked: string[][] = []
  let state = { down: false }
  let ask: Run = (args) => {
    asked.push(args.slice(args.indexOf('--') + 1))
    return Promise.resolve(
      state.down
        ? { ok: false, code: 128, out: '', err: 'fatal: not a tree object' }
        : { ok: true, code: 0, out: `100644 blob b1\ta.ts\0`, err: '' },
    )
  }
  return { asked, state, tree: trees('/repo', { ask }) }
}

test('a commit is read of Git once per path, however many ask at once', async () => {
  let { asked, tree } = git()
  let got = await Promise.all([
    tree(sha, ['a.ts', 'b.ts']),
    tree(sha, ['a.ts']),
    tree(sha, ['b.ts', 'a.ts']),
  ])
  equal(got.map((m) => Object.fromEntries(m)), [
    { 'a.ts': 'b1' },
    { 'a.ts': 'b1' },
    { 'a.ts': 'b1' },
  ])
  equal(asked, [['a.ts', 'b.ts']])
  await tree(sha, ['a.ts', 'c.ts'])
  equal(asked, [['a.ts', 'b.ts'], ['c.ts']])
  await tree('HEAD', ['a.ts'])
  equal(asked.length, 2)
})

test('a read Git refused is asked again', async () => {
  let { asked, state, tree } = git()
  state.down = true
  equal((await tree(sha, ['a.ts'])).size, 0)
  state.down = false
  equal(Object.fromEntries(await tree(sha, ['a.ts'])), { 'a.ts': 'b1' })
  equal(asked, [['a.ts'], ['a.ts']])
})
