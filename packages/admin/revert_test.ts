// Revert accepts graph-backed main and explicitly publishes the accepted
// commit. Both the caller checkout and its upstream here are scratch repos.
import { docDoc } from '@yaks/doc'
import { assertRejects } from '@std/assert'
import { equal, ok, test } from '@yaks/testing'
import { repositoryEid } from '@yaks/git/host'
import { refAt } from '../git/refs.ts'
import { fixture, git, testMachine } from '../git/testing.ts'
import { revert } from './revert.ts'

test('revert accepts through the graph and pushes before watching deployment', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'admin-revert-' })
  let root = dir + '/checkout'
  let remote = dir + '/origin.git'
  let { g, bytes } = fixture({ docs: [docDoc] })
  let machine = testMachine()
  let notes: string[] = []
  try {
    await Deno.mkdir(root)
    await git(dir, 'init', '-q', '--bare', remote)
    await git(root, 'init', '-q', '-b', 'main')
    await git(root, 'config', 'user.name', 'Revert test')
    await git(root, 'config', 'user.email', 'revert@example.test')
    await Deno.writeTextFile(root + '/.gitignore', '.claude/\n')
    await Deno.writeTextFile(
      root + '/deno.json',
      JSON.stringify({ tasks: { check: 'deno eval ""' } }),
    )
    await git(root, 'add', '.')
    await git(root, 'commit', '-qm', 'base')
    await Deno.writeTextFile(root + '/broken.txt', 'bad change\n')
    await git(root, 'add', 'broken.txt')
    await git(root, 'commit', '-qm', 'broken change')
    let target = await git(root, 'rev-parse', 'HEAD')
    await git(root, 'remote', 'add', 'origin', remote)
    await git(root, 'push', '-qu', 'origin', 'main')
    let app = repositoryEid(await Deno.realPath(root + '/.git'))
    let published = ''
    // Stop at the external deployment door. No Wrangler credentials, network,
    // live graph, or live checkout are used by this regression.
    await assertRejects(
      () =>
        revert(
          g,
          bytes,
          machine,
          root,
          target,
          (line) => {
            if (line.startsWith('pushed ')) {
              published = line.split(' ')[1].replace(/;$/, '')
              throw new Error('deployment watch reached')
            }
          },
          (line) => notes.push(line),
          new AbortController().signal,
        ),
      Error,
      'deployment watch reached',
    )
    ok(published && published != target)
    equal(await refAt(g, app, 'refs/heads/main'), published)
    equal((await g.get([published], ['gitobj']))[0]?.gitobj != null, true)
    equal(await git(remote, 'rev-parse', 'refs/heads/main'), published)
    equal(await git(root, 'rev-parse', 'main'), published)
    equal(await git(root, 'ls-tree', 'HEAD', 'broken.txt'), '')
    let tree = notes.find((line) => line.startsWith('revert worktree: '))!
      .slice('revert worktree: '.length)
    equal(await git(tree, 'rev-parse', 'HEAD'), published)
    ok(notes.includes('worktree kept at ' + tree))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
