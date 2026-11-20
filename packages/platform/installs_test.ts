// What an install copies, where it lands, what an update needs, and the
// sandbox an installed copy can be put in.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  bearerOf,
  copying,
  landing,
  next,
  pinned,
  reloads,
  SANDBOX,
  stored,
  taken,
  tokenOf,
  vetted,
  walled,
} from './installs.ts'

test('an install takes the files and their build, not the uploads', () => {
  assertEquals(
    Object.keys(taken({
      'index.html': 'a',
      'esbuild/app.js': 'b',
      'blobs/photo.png': 'c',
    })),
    ['index.html', 'esbuild/app.js'],
  )
})

test("a copy's draft becomes the publication", () => {
  let out = copying(
    { 'index.html': 'a', 'esbuild/app.js': 'b' },
    { 'index.html': 'old', 'gone.js': 'g', 'blobs/p.png': 'p' },
  )
  assertEquals(out.changes, [
    { path: 'index.html', sha: 'a' },
    { path: 'esbuild/app.js', sha: 'b' },
    { path: 'gone.js' },
  ])
  assertEquals([out.wrote, out.gone], [['index.html'], ['gone.js']])
})

test('a copy lands at its own slug, else its name, numbered', async () => {
  let at = (held: string[], as?: string) =>
    landing(
      'chores',
      'chore-chart',
      (s) => Promise.resolve(!held.includes(s)),
      as,
    )
  assertEquals(await at([]), 'chores')
  assertEquals(await at(['chores']), 'chore-chart')
  assertEquals(
    await at(['chores', 'chore-chart', 'chore-chart-2']),
    'chore-chart-3',
  )
  assertEquals(await at(['chores'], 'mine'), 'mine')
})

test('a copy is pinned to its version, and to its sample where it kept one', () => {
  let now = new Date('2026-11-15T00:00:00Z')
  let at = now.toISOString()
  let pin = { of: 'a', version: 3, sandboxed: null, trusted: at }
  assertEquals(pinned('a', 3, false, null, now), { installed: pin })
  assertEquals(pinned('a', 3, false, { seeded: 2 }, now), {
    installed: pin,
    seeded: { at, version: 2 },
  })
  assertEquals(pinned('a', 3, false, { seeded: null }, now).seeded?.version, 3)
  assertEquals(pinned('a', 3, true, null, now).installed, {
    of: 'a',
    version: 3,
    sandboxed: at,
    trusted: null,
  })
})

test('a copy runs out of the sandbox when it was reviewed or the space knows its maker', () => {
  let at = (kin: boolean) => ({ kin, members: new Set(['ann']) })
  let cases: [boolean, string | null, boolean, boolean][] = [
    [false, 'bob', false, false],
    [true, 'bob', false, true],
    [false, 'ann', false, true],
    [false, 'bob', true, true],
    [false, null, false, false],
  ]
  for (let [reviewed, author, kin, out] of cases) {
    assertEquals(vetted({ reviewed, author }, at(kin)), out)
  }
})

test("an unsandboxed copy's update takes the newest vetted release, a sandboxed one the newest", () => {
  let theirs = [1, 2, 3, 4].map((version) => ({ version, ok: version != 4 }))
  let at = (was: number, walled: boolean) =>
    next(theirs, was, 4, walled, (v) => v.ok)
  assertEquals([at(1, false), at(3, false), at(1, true)], [3, null, 4])
  assertEquals(next(theirs, 4, 2, false, (v) => v.ok), 2)
  assertEquals(next(theirs, 3, 4, false, (v) => v.ok), null)
})

test('an update reloads going back or across a release that says so', () => {
  let theirs = [{ version: 2 }, { version: 3, reload: 'required' as const }]
  assertEquals(
    [[1, 2], [2, 3], [3, 4], [3, 1]].map(([was, to]) =>
      reloads(theirs, was, to)
    ),
    [undefined, 'required', undefined, 'required'],
  )
})

test("a sandboxed app's answers are walled, its own policy kept", () => {
  let res = walled(
    new Response('hi', { headers: { 'content-security-policy': 'img-src *' } }),
  )
  assertEquals(
    res.headers.get('content-security-policy'),
    `img-src *, ${SANDBOX}`,
  )
  assertEquals(res.headers.get('referrer-policy'), 'no-referrer')
  let socket = { status: 101 } as Response
  assertEquals(walled(socket), socket)
})

test("a sandboxed page's token rides its path or its bearer", () => {
  assertEquals(tokenOf('/~abc/api/query'), { token: 'abc', rest: '/api/query' })
  assertEquals(tokenOf('/~abc'), { token: 'abc', rest: '/' })
  assertEquals(tokenOf('/api/query'), null)
  let asked = (authorization: string) =>
    bearerOf(new Request('https://x/', { headers: { authorization } }))
  assertEquals([asked('Bearer t1'), asked('Basic t1')], ['t1', null])
})

test("a sandboxed page's storage cannot close its own block", () => {
  let tags = stored('/notes/~t/', { k: '</script>' }, true)
  assertEquals(
    tags.includes('</script><script src="/notes/~t/api/storage.js">'),
    true,
  )
  assertEquals(tags.split('</script>').length, 3)
})
