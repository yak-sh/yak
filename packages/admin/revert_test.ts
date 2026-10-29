import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Run } from '@yaks/git/land'
import { revert } from './revert.ts'

// Git's boundary answers in memory; no repository, process or deployment is
// needed to exercise recovery's publication and worktree ownership.
let recovering = (
  root: string,
  opts: { moved?: boolean; published?: boolean } = {},
) => {
  let tree = ''
  let branch = ''
  let removed = false
  let rebased = false
  let out: string[] = []
  let run: Run = (args, cwd) => {
    let text = args.join(' ')
    let result = (out = '', code = 0) =>
      Promise.resolve({ out, code, ok: code == 0, err: '' })
    if (text == 'worktree list --porcelain') {
      return result(`worktree ${root}\nbranch refs/heads/main\n`)
    }
    if (text == 'config branch.main.remote') return result('origin')
    if (text == 'config branch.main.merge') return result('refs/heads/main')
    if (args[0] == 'fetch' || args[0] == 'push') return result()
    if (text == 'rev-parse --verify origin/main') return result('base')
    if (args[0] == 'rev-parse') {
      if (args.includes('--show-toplevel')) return result(cwd)
      if (args.includes('--verify')) return result('target')
      return result(args[1] == 'HEAD' ? 'correction' : 'base')
    }
    if (text == 'symbolic-ref -q --short HEAD') return result(branch)
    if (args[0] == 'merge-base') {
      if (args[2] == 'correction') {
        return result('', opts.published === false ? 1 : 0)
      }
      return result('', args[2] == 'main' && opts.moved && !rebased ? 1 : 0)
    }
    if (text.startsWith('worktree add')) {
      branch = args[3]
      tree = args[4]
      return result()
    }
    if (text.startsWith('worktree remove')) removed = true
    if (text == 'rebase main') rebased = true
    if (args[0] == 'diff' && args[1] == '--name-only') {
      return result('broken.ts\0')
    }
    if (
      [
        'revert',
        'diff',
        'status',
        'worktree',
        'update-index',
        'read-tree',
        'merge',
        'rebase',
        'branch',
      ].includes(args[0])
    ) return result()
    throw new Error(`unexpected git: ${text}`)
  }
  return {
    run: () =>
      revert(
        root,
        'target',
        (s) => out.push(s),
        (s) => out.push(s),
        new AbortController().signal,
        run,
      ),
    state: () => ({ tree, branch, removed, rebased, out }),
  }
}

let root = await Deno.makeTempDir({ prefix: 'revert-' })
let direct = recovering(root)
let moved = recovering(root, { moved: true })
let unpublished = recovering(root, { published: false })

for (
  let [name, fixture, rebased] of [
    [
      'a revert returns after publishing and removes its worktree',
      direct,
      false,
    ],
    ['a main change rebases and publishes the correction', moved, true],
  ] as const
) {
  test(name, async () => {
    assertEquals(await fixture.run(), 0)
    let state = fixture.state()
    assertEquals(state.removed, true)
    assertEquals(state.rebased, rebased)
    assertEquals(
      state.out.includes(
        'pushed correction; Workers Builds deploys in the background',
      ),
      true,
    )
  })
}

test('a revert that lands only locally preserves its recovery worktree', async () => {
  await assertRejects(
    unpublished.run,
    Error,
    'landed locally but was not pushed',
  )
  let state = unpublished.state()
  assertEquals(state.removed, false)
  assertEquals(state.out.at(-1), `worktree kept at ${state.tree}`)
})
