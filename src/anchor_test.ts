// The git-anchor staleness audit, proven against a real (throwaway) repo: an
// anchor is STALE when a commit newer than its sha touched its paths, CLEAN
// when nothing has, and UNKNOWN when git can't vouch either way. anchorPaths
// is the pure split; freshness is the git seam — tested end-to-end because the
// whole point of the primitive is that git, not a mock, decides.
import { assertEquals } from '@std/assert'
import {
  advance,
  anchorPaths,
  freshness,
  hunks,
  locate,
  resolve,
} from './anchor.ts'
import { slow } from './testing.ts'

Deno.test('anchorPaths: splits on newline or comma, trims, drops empties', () => {
  assertEquals(anchorPaths('a.ts, b.ts'), ['a.ts', 'b.ts'])
  assertEquals(anchorPaths('a.ts\n b.ts \n'), ['a.ts', 'b.ts'])
  assertEquals(anchorPaths('a.ts,,\nb.ts'), ['a.ts', 'b.ts'])
  assertEquals(anchorPaths('   '), [])
  assertEquals(anchorPaths(null), [])
  assertEquals(anchorPaths(undefined), [])
})

// ---- The exact tiers' pure seams: diffs and file content as strings, no git.

Deno.test('hunks: parses -a,b +c,d headers, counts default to 1', () => {
  assertEquals(hunks('@@ -5,2 +5,3 @@ ctx\n-x\n+y\n+z'), [
    { oldStart: 5, oldCount: 2, newCount: 3 },
  ])
  assertEquals(hunks('@@ -5 +5 @@'), [{
    oldStart: 5,
    oldCount: 1,
    newCount: 1,
  }])
  assertEquals(hunks('@@ -3,0 +4,2 @@'), [
    { oldStart: 3, oldCount: 0, newCount: 2 },
  ])
  assertEquals(hunks('no hunks here'), [])
})

// One advance case per line: the diff's hunk headers, the anchored range,
// the expected grade.
let moved = (start: number, end: number) => ({ state: 'moved', start, end })
let advances: [string, number, number, unknown][] = [
  ['', 5, 8, { state: 'fresh' }],
  ['@@ -20,2 +20,2 @@', 5, 8, { state: 'fresh' }], // below: untouched
  ['@@ -1,2 +1,4 @@', 5, 8, moved(7, 10)], // grew above: shifted down
  ['@@ -1,3 +1 @@', 5, 8, moved(3, 6)], // shrank above: shifted up
  ['@@ -4,0 +5,2 @@', 5, 8, moved(7, 10)], // inserted just above
  ['@@ -8,0 +9,3 @@', 5, 8, { state: 'fresh' }], // inserted just below
  ['@@ -6,0 +7 @@', 5, 8, { state: 'broken' }], // inserted inside
  ['@@ -6 +6,2 @@', 5, 8, { state: 'broken' }], // edited inside
  ['@@ -4,3 +4,3 @@', 5, 8, { state: 'broken' }], // edit straddles the start
  ['@@ -8,2 +8 @@', 5, 8, { state: 'broken' }], // edit straddles the end
  ['@@ -1,2 +1,3 @@\n@@ -10,2 +11 @@', 5, 8, moved(6, 9)], // both sides
  ['@@ -3 +3 @@', 3, 3, { state: 'broken' }], // the whole one-line region
]
Deno.test('advance: shifts a range past hunks, breaks on any touch', () => {
  for (let [diff, start, end, want] of advances) {
    assertEquals(advance(diff, start, end), want, `${diff} [${start},${end}]`)
  }
})

let file = 'let a = 1\nlet b = 2\nlet c = 3\nlet b = 2\n'
Deno.test('locate: exact match first, nearest to the anchored start', () => {
  assertEquals(locate(file, 'let b = 2\nlet c = 3', 2), {
    start: 2,
    end: 3,
    exact: true,
  })
  // Two exact matches — `near` disambiguates each way.
  assertEquals(locate(file, 'let b = 2', 1)?.start, 2)
  assertEquals(locate(file, 'let b = 2', 9)?.start, 4)
})

Deno.test('locate: falls back to whitespace-insensitive, else null', () => {
  assertEquals(locate(file, '  let c   =  3', 1), {
    start: 3,
    end: 3,
    exact: false,
  })
  assertEquals(locate(file, 'let z = 9', 1), null)
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

// ---- resolve(): the tiers against a real repo — a ten-line file whose
// region shifts down two when a later commit prepends two lines.
let lines = Array.from({ length: 10 }, (_, i) => `l${i + 1}`).join('\n') + '\n'
let shifted = async (dir: string) => {
  await git(dir, 'init', '-q')
  await Deno.writeTextFile(`${dir}/f.ts`, lines)
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-q', '-m', 'first')
  let first = await git(dir, 'rev-parse', 'HEAD')
  await Deno.writeTextFile(`${dir}/f.ts`, 'top1\ntop2\n' + lines)
  await git(dir, 'commit', '-q', '-am', 'prepend')
  let second = await git(dir, 'rev-parse', 'HEAD')
  return { first, second }
}
let withShifted = async (
  fn: (dir: string, shas: { first: string; second: string }) => Promise<void>,
) => {
  let dir = await Deno.makeTempDir()
  try {
    await fn(dir, await shifted(dir))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

slow(
  'resolve: line tier — fresh, moved with the new range, broken',
  async () => {
    await withShifted(async (dir, { first, second }) => {
      let f = { paths: 'f.ts' }
      let moved = await resolve(dir, { ...f, sha: first, start: 5, end: 6 })
      assertEquals(moved, {
        state: 'moved',
        tier: 'line',
        location: { path: 'f.ts', start: 7, end: 8, head: second },
        bytes: 'l5\nl6',
      })
      let fresh = await resolve(dir, { ...f, sha: second, start: 7, end: 8 })
      assertEquals(fresh.state, 'fresh')
      if (fresh.state == 'fresh') assertEquals(fresh.bytes, 'l5\nl6')
      // A third commit edits l5 itself: the region was rewritten.
      await Deno.writeTextFile(
        `${dir}/f.ts`,
        ('top1\ntop2\n' + lines).replace('l5', 'l5x'),
      )
      await git(dir, 'commit', '-q', '-am', 'edit l5')
      let broken = await resolve(dir, { ...f, sha: first, start: 5, end: 6 })
      assertEquals(broken.state, 'broken')
      let gone = await resolve(dir, { ...f, sha: 'deadbeef', start: 5 })
      assertEquals(gone.state, 'broken')
    })
  },
)

slow(
  'resolve: hunk tier — relocated by text, fuzzy on whitespace',
  async () => {
    await withShifted(async (dir, { second }) => {
      let f = { paths: 'f.ts' }
      let moved = await resolve(dir, { ...f, hunk: 'l5\nl6', start: 5 })
      assertEquals(moved, {
        state: 'moved',
        tier: 'hunk',
        location: { path: 'f.ts', start: 7, end: 8, head: second },
        bytes: 'l5\nl6',
        exact: true,
      })
      // No anchored start: an exact match anywhere is the text found intact.
      let fresh = await resolve(dir, { ...f, hunk: 'l5\nl6' })
      assertEquals(fresh.state, 'fresh')
      let fuzzy = await resolve(dir, { ...f, hunk: '  l5\n l6 ', start: 5 })
      assertEquals(fuzzy.state, 'moved')
      if (fuzzy.state == 'moved') assertEquals(fuzzy.exact, false)
      let lost = await resolve(dir, { ...f, hunk: 'never was here' })
      assertEquals(lost.state, 'broken')
    })
  },
)

slow(
  'resolve: paths tier — freshness mapped in, moved names commits',
  async () => {
    await withShifted(async (dir, { first, second }) => {
      let moved = await resolve(dir, { paths: 'f.ts', sha: first })
      assertEquals(moved.state, 'moved')
      if (moved.state == 'moved') assertEquals(moved.commits?.length, 1)
      let fresh = await resolve(dir, { paths: 'f.ts', sha: second })
      assertEquals(fresh.state, 'fresh')
      assertEquals(
        (await resolve(dir, { paths: null, sha: first })).state,
        'broken',
      )
    })
  },
)

// ---- GET /anchor: the resolver door end-to-end — an anchored entity graded
// in its own repo context (walked entity → project → repo.path), and an
// unsaved anchor graded from explicit params. Boots the real server the
// precondition_test way: only under the heavy tier, on an ephemeral port.
let U = ''
if (Deno.env.get('TASKS_SLOW')) {
  Deno.env.set('DB_PATH', ':memory:')
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  await import('./server.ts')
  U = `127.0.0.1:${port}`
}
let alone = { sanitizeOps: false, sanitizeResources: false }

slow('GET /anchor: grades an entity in its project repo', alone, async () => {
  await withShifted(async (dir, { first }) => {
    let proj = crypto.randomUUID()
    let task = crypto.randomUUID()
    let posted = await fetch(`http://${U}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { eid: proj, name: 'doc', comp: { title: 'venture' } },
        { eid: proj, name: 'project', comp: {} },
        { eid: proj, name: 'repo', comp: { path: dir } },
        { eid: task, name: 'doc', comp: { title: 'anchored' } },
        { eid: task, name: 'task', comp: { project: proj } },
        {
          eid: task,
          name: 'anchor',
          comp: { paths: 'f.ts', sha: first, start: 5, end: 6 },
        },
      ]),
    })
    assertEquals(posted.status, 200)
    await posted.body?.cancel()
    let res = await fetch(`http://${U}/anchor?id=${task}`)
    assertEquals(res.status, 200)
    let got = await res.json()
    assertEquals(got.state, 'moved')
    assertEquals(got.tier, 'line')
    assertEquals(got.location.start, 7)
    assertEquals(got.bytes, 'l5\nl6')
    // No anchor to grade is the caller's news, not a server error.
    let bare = await fetch(`http://${U}/anchor?id=${proj}`)
    assertEquals(bare.status, 404)
    await bare.body?.cancel()
  })
})

slow('GET /anchor: grades explicit params in ?repo=', alone, async () => {
  await withShifted(async (dir) => {
    let q = `path=f.ts&hunk=${encodeURIComponent('l5\nl6')}&start=5` +
      `&repo=${encodeURIComponent(dir)}`
    let got = await (await fetch(`http://${U}/anchor?${q}`)).json()
    assertEquals(got.state, 'moved')
    assertEquals(got.tier, 'hunk')
    assertEquals(got.location, {
      path: 'f.ts',
      start: 7,
      end: 8,
      head: got.location.head,
    })
    let refused = await fetch(`http://${U}/anchor`)
    assertEquals(refused.status, 400)
    await refused.body?.cancel()
  })
})
