// A commit's tree is read of Git once per path, whoever asks and however often.

import { equal, test } from '@yaks/testing'
import type { Run } from './land.ts'
import { commitsOf, trees } from './source.ts'

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

// Git, holding the commits and the tree its objects map to their kinds.
let holding = (objects: Record<string, 'commit' | 'tree'>): Run => (args) => {
  let found = (p: string) =>
    Object.keys(objects).filter((id) => id.startsWith(p))
  let said = (out: string[]) =>
    Promise.resolve(
      out.length
        ? { ok: true, code: 0, out: out.join('\n') + '\n', err: '' }
        : { ok: false, code: 1, out: '', err: '' },
    )
  let wants = args.find((a) => a.startsWith('--disambiguate='))
  if (wants) {
    return said(found(wants.split('=')[1])).then((r) => ({ ...r, ok: true }))
  }
  let commits = found(args.at(-1)!.replace('^{commit}', ''))
    .filter((id) => objects[id] == 'commit')
  return said(commits.length == 1 ? commits : [])
}

test('a sha names the commits it starts, as Git reads it', async () => {
  let [a, b, t] = [
    'abc1234' + '1'.repeat(33),
    'abc1234' + '2'.repeat(33),
    'abd' + '3'.repeat(37),
  ]
  let ask = holding({ [a]: 'commit', [b]: 'commit', [t]: 'tree' })
  let named = (sha: string) => commitsOf('/repo', sha, ask)
  equal(
    await Promise.all(['abc12341', 'abc1234', 'abd3', 'abe0', 'zz'].map(named)),
    [
      [a],
      [a, b],
      [],
      [],
      [],
    ],
  )
})
