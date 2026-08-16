// The git-anchor staleness audit, proven against a real (throwaway) repo: an
// anchor is STALE when a commit newer than its sha touched its paths, CLEAN
// when nothing has, and UNKNOWN when git can't vouch either way. anchorPaths
// is the pure split; freshness is the git seam — tested end-to-end because the
// whole point of the primitive is that git, not a mock, decides.
import { assertEquals } from '@std/assert'
import { anchorPaths, freshness } from './anchor.ts'

Deno.test('anchorPaths: splits on newline or comma, trims, drops empties', () => {
  assertEquals(anchorPaths('a.ts, b.ts'), ['a.ts', 'b.ts'])
  assertEquals(anchorPaths('a.ts\n b.ts \n'), ['a.ts', 'b.ts'])
  assertEquals(anchorPaths('a.ts,,\nb.ts'), ['a.ts', 'b.ts'])
  assertEquals(anchorPaths('   '), [])
  assertEquals(anchorPaths(null), [])
  assertEquals(anchorPaths(undefined), [])
})

let git = async (cwd: string, ...args: string[]) => {
  let { success, stdout, stderr } = await new Deno.Command('git', {
    args: [
      '-C',
      cwd,
      '-c',
      'user.email=t@t',
      '-c',
      'user.name=t',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  let out = new TextDecoder().decode(stdout).trim()
  if (!success) throw new Error(new TextDecoder().decode(stderr))
  return out
}

// A tiny repo: two files, so a later commit can move one path and leave the
// other still current. Returns the shas so a test can anchor at either point.
let repo = async (dir: string) => {
  await git(dir, 'init', '-q')
  await Deno.writeTextFile(`${dir}/a.ts`, 'v1\n')
  await Deno.writeTextFile(`${dir}/b.ts`, 'v1\n')
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-q', '-m', 'first')
  let first = await git(dir, 'rev-parse', 'HEAD')
  await Deno.writeTextFile(`${dir}/a.ts`, 'v2\n')
  await git(dir, 'commit', '-q', '-am', 'move a')
  let second = await git(dir, 'rev-parse', 'HEAD')
  return { first, second }
}

let withRepo = async (
  fn: (dir: string, shas: Awaited<ReturnType<typeof repo>>) => Promise<void>,
) => {
  let dir = await Deno.makeTempDir()
  try {
    await fn(dir, await repo(dir))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

Deno.test('freshness: STALE when a commit moved the path past the sha', async () => {
  await withRepo(async (dir, { first }) => {
    let f = await freshness(dir, { sha: first, paths: 'a.ts' })
    assertEquals(f.state, 'stale')
    if (f.state == 'stale') assertEquals(f.moved.length, 1)
  })
})

Deno.test('freshness: CLEAN when the anchored path has not moved since', async () => {
  await withRepo(async (dir, { first, second }) => {
    // b.ts was untouched by the second commit — still true as of `first`.
    let b = await freshness(dir, { sha: first, paths: 'b.ts' })
    assertEquals(b.state, 'clean')
    // a.ts anchored at HEAD (after its own move) is current too.
    let a = await freshness(dir, { sha: second, paths: 'a.ts' })
    assertEquals(a.state, 'clean')
  })
})

Deno.test('freshness: UNKNOWN when git cannot vouch (missing sha / no paths)', async () => {
  await withRepo(async (dir) => {
    let gone = await freshness(dir, { sha: 'deadbeef', paths: 'a.ts' })
    assertEquals(gone.state, 'unknown')
    assertEquals(
      (await freshness(dir, { sha: null, paths: 'a.ts' })).state,
      'unknown',
    )
    assertEquals(
      (await freshness(dir, { sha: 'HEAD', paths: '' })).state,
      'unknown',
    )
  })
})
