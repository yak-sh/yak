// The repo seam against throwaway checkouts: every verb asked of a repo that
// can answer, and of one that cannot. The point is the CONTRACT a second
// adapter has to keep — a verb answers or refuses, and a refusal is a not-ok
// run carrying git's words, never a throw. Nothing here touches a live repo.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { git, gitRepo, gitSync } from './repo.ts'
import { slow } from './testing.ts'

let write = (path: string, body: string) => (
  Deno.writeTextFileSync(path, body), path
)

// A repo with two commits: `a.txt` twice, `b.txt` once, so a sha bounds a
// range and one path can move while the other stands still.
let repo = async () => {
  let dir = Deno.realPathSync(Deno.makeTempDirSync({ prefix: 'tasks-repo-' }))
  let r = gitRepo(dir)
  for (
    let args of [
      ['init', '-q', '-b', 'main'],
      ['config', 'user.email', 'test@example.com'],
      ['config', 'user.name', 'Test'],
      ['config', 'commit.gpgsign', 'false'],
    ]
  ) assert((await git(dir, args)).ok, args.join(' '))
  write(`${dir}/a.txt`, 'one\n')
  write(`${dir}/b.txt`, 'steady\n')
  assert((await git(dir, ['add', '.'])).ok)
  assert((await r.commitPaths(['a.txt', 'b.txt'], 'seed')).ok)
  let first = (await r.revAt()).out.trim()
  write(`${dir}/a.txt`, 'one\ntwo\n')
  assert((await r.commitPaths(['a.txt'], 'grow a')).ok)
  return { dir, repo: r, first }
}

let gone = (dir: string) => Deno.removeSync(dir, { recursive: true })

slow('a repo answers for its own history', async () => {
  let { dir, repo: r, first } = await repo()
  try {
    let head = await r.revAt()
    assert(head.ok)
    assertEquals(head.out.trim().length, 40)
    assert(!(await r.revAt('no-such-ref')).ok)

    assert((await r.catFile(first)).ok)
    assert(!(await r.catFile('0'.repeat(40))).ok)

    assertEquals((await r.readAt('HEAD', 'a.txt')).out, 'one\ntwo\n')
    assertEquals((await r.readAt(first, 'a.txt')).out, 'one\n')
    assert(!(await r.readAt('HEAD', 'nope.txt')).ok)

    // Only the path that moved is named, and only after the anchored sha.
    let moved = await r.logSince(first, ['a.txt'])
    assertEquals(moved.out.split('\n').filter(Boolean).length, 1)
    assertEquals((await r.logSince(first, ['b.txt'])).out.trim(), '')

    // Zero context: the header names the inserted line and nothing around it.
    assertStringIncludes((await r.diff(first, 'a.txt')).out, '@@ -1,0 +2 @@')
    assertEquals((await r.diff(first, 'b.txt')).out, '')
  } finally {
    gone(dir)
  }
})

slow('commitPaths takes its paths and nothing else', async () => {
  let { dir, repo: r } = await repo()
  try {
    write(`${dir}/a.txt`, 'mine\n')
    write(`${dir}/b.txt`, 'someone else mid-edit\n')
    assert((await r.commitPaths(['a.txt'], 'just a')).ok)
    assertEquals((await r.readAt('HEAD', 'a.txt')).out, 'mine\n')
    assertEquals((await r.readAt('HEAD', 'b.txt')).out, 'steady\n')
  } finally {
    gone(dir)
  }
})

slow('a branch counts itself against the upstream it has', async () => {
  let { dir, repo: r } = await repo()
  let bare = Deno.makeTempDirSync({ prefix: 'tasks-repo-bare-' })
  try {
    // No upstream is nothing to report — not a zero, which would read level.
    assertEquals(await r.upstreamCounts(), undefined)
    assert((await git(bare, ['init', '-q', '--bare', '-b', 'main'])).ok)
    assert((await git(dir, ['remote', 'add', 'origin', bare])).ok)
    assert((await r.push('origin', 'HEAD:main')).ok)
    assert((await git(dir, ['branch', '-u', 'origin/main'])).ok)
    assertEquals(await r.upstreamCounts(), { ahead: 0, behind: 0 })
    write(`${dir}/a.txt`, 'ahead\n')
    assert((await r.commitPaths(['a.txt'], 'ahead')).ok)
    assertEquals(await r.upstreamCounts(), { ahead: 1, behind: 0 })
  } finally {
    gone(dir)
    gone(bare)
  }
})

slow('a worktree is cut from the repo and given back to it', async () => {
  let { dir, repo: r } = await repo()
  let tree = `${dir}-tree`
  try {
    assert((await r.worktreeCreate(tree, 'session/S-7', 'main')).ok)
    assertEquals(
      (await gitRepo(tree).readAt('HEAD', 'a.txt')).out,
      'one\ntwo\n',
    )
    // The same path twice is a refusal with git's reason, not a throw.
    let again = await r.worktreeCreate(tree, 'session/S-8', 'main')
    assert(!again.ok)
    assertStringIncludes(again.err, tree)
    assert((await r.worktreeRemove(tree)).ok)
    assert(!(await gitRepo(tree).revAt()).ok)
  } finally {
    gone(dir)
  }
})

Deno.test('worktree creation reuses an orphaned short session branch without resetting it', async () => {
  let { dir, repo: r } = await repo()
  let tree = `${dir}-tree`, branch = 'session/3f9a1c2e7b'
  try {
    assert((await r.worktreeCreate(tree, branch, 'main')).ok)
    write(`${tree}/a.txt`, 'unmerged session work\n')
    assert((await gitRepo(tree).commitPaths(['a.txt'], 'session work')).ok)
    let head = (await gitRepo(tree).revAt()).out
    assert((await r.worktreeRemove(tree)).ok)
    assert((await r.worktreeCreate(tree, branch, 'main')).ok)
    assertEquals((await gitRepo(tree).revAt()).out, head)
    // A branch checked out elsewhere still refuses: no --force, no reset.
    assert(!(await r.worktreeCreate(`${tree}-other`, branch, 'main')).ok)
    assert((await r.worktreeRemove(tree)).ok)
  } finally {
    gone(dir)
  }
})

slow('a directory that is no repo refuses, and never throws', async () => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-repo-bare-' })
  try {
    let r = gitRepo(dir)
    assert(!(await r.revAt()).ok)
    assertEquals(await r.upstreamCounts(), undefined)
    // A cwd that does not exist is a spawn failure, which is still a run.
    let missing = await git(`${dir}/gone`, ['rev-parse', 'HEAD'])
    assertEquals(missing.ok, false)
    assertEquals(missing.code, -1)
    assert(missing.err)
    // The sync twin answers exactly as the async one does.
    assertEquals(gitSync(dir, ['rev-parse', 'HEAD']).ok, false)
    assertEquals(gitSync(`${dir}/gone`, ['rev-parse', 'HEAD']).code, -1)
  } finally {
    gone(dir)
  }
})

Deno.test('both git runners resolve PATH and convert a missing executable', async () => {
  let dir = Deno.makeTempDirSync({ prefix: 'tasks-git-path-' })
  let path = Deno.env.get('PATH')
  try {
    // A private PATH proves neither runner hardcodes the host's /usr/bin/git.
    Deno.writeTextFileSync(`${dir}/git`, '#!/bin/sh\nprintf "from PATH\\n"\n')
    Deno.chmodSync(`${dir}/git`, 0o755)
    Deno.env.set('PATH', dir)
    for (
      let r of [await git(dir, ['--version']), gitSync(dir, ['--version'])]
    ) {
      assert(r.ok)
      assertEquals(r.out, 'from PATH\n')
    }
    Deno.removeSync(`${dir}/git`)
    for (
      let r of [await git(dir, ['--version']), gitSync(dir, ['--version'])]
    ) {
      assertEquals(r.ok, false)
      assertEquals(r.code, -1)
      assertEquals(r.out, '')
      assertStringIncludes(r.err, `git --version in ${dir}`)
      assertStringIncludes(r.err, 'Failed to spawn')
    }
  } finally {
    if (path === undefined) Deno.env.delete('PATH')
    else Deno.env.set('PATH', path)
    gone(dir)
  }
})
