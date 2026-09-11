// bin/jsr's pure seams: what a package name splits into, what the repo proves
// about a runtime, what the live row narrows to, and which fields moved. The
// HTTP doors are exercised through a stub fetch, so nothing here reaches the
// network; the workspace walk is Deno.readDir over real files and is left to
// the tool itself.
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  BLANK,
  compat,
  type Details,
  diff,
  type Fetch,
  fits,
  lines,
  mine,
  mint,
  plan,
  read,
  REPO,
  show,
  split,
  want,
  write,
} from './jsr.ts'

// A fetch that answers from a table and records what it was asked.
let stub = (answer: (url: string, init?: RequestInit) => Response) => {
  let calls: { url: string; method: string; body: unknown }[] = []
  let get: Fetch = (input, init) => {
    let url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return Promise.resolve(answer(url, init))
  }
  return { get, calls }
}

let json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

Deno.test('split: a scoped name is a scope and a package', () => {
  assertEquals(split('@yaks/graph'), { scope: 'yaks', pkg: 'graph' })
  assertEquals(split('@yaks/durable-object'), {
    scope: 'yaks',
    pkg: 'durable-object',
  })
  for (let bad of ['yaks/graph', '@yaks', '@yaks/Graph', '@yaks/a/b', '']) {
    assertThrows(() => split(bad), Error, 'not a JSR package name')
  }
})

Deno.test('fits: JSR caps a description at one line of 250', () => {
  assertEquals([fits(''), fits('x'.repeat(250))], [true, true])
  assertEquals([fits('x'.repeat(251)), fits('two\nlines')], [false, false])
})

Deno.test('compat: only what a platform config proves, plus Deno', () => {
  assertEquals(compat({ browser: false, workers: false }), { deno: true })
  assertEquals(compat({ browser: true, workers: false }), {
    deno: true,
    browser: true,
  })
  assertEquals(compat({ browser: true, workers: true }), {
    deno: true,
    browser: true,
    workerd: true,
  })
})

Deno.test('want: the description rides from deno.json, the repo is the repo', () => {
  assertEquals(
    want({ name: '@yaks/graph', description: 'the core' }, {
      browser: true,
      workers: false,
    }),
    {
      description: 'the core',
      githubRepository: REPO,
      runtimeCompat: { deno: true, browser: true },
    },
  )
})

Deno.test('want: a package with no description asks for none, not a gap', () => {
  assertEquals(
    want({ name: '@yaks/query' }, { browser: false, workers: false })
      .description,
    '',
  )
})

Deno.test('want: an over-long description names its package, not a 400', () => {
  assertThrows(
    () =>
      want({ name: '@yaks/graph', description: 'x'.repeat(251) }, {
        browser: false,
        workers: false,
      }),
    Error,
    '@yaks/graph: description must be one line',
  )
})

Deno.test('mine: the live row keeps only the fields this repo owns', () => {
  assertEquals(
    mine({
      scope: 'yaks',
      name: 'graph',
      description: 'the core',
      githubRepository: {
        id: 42,
        owner: 'yak-sh',
        name: 'yak',
        createdAt: '2026-09-05T00:00:00Z',
      },
      runtimeCompat: { deno: true, node: null },
      score: 82,
      versionCount: 1,
    }),
    {
      description: 'the core',
      githubRepository: { owner: 'yak-sh', name: 'yak' },
      runtimeCompat: { deno: true },
    },
  )
})

Deno.test('mine: an untouched page narrows to blank', () => {
  assertEquals(
    mine({ description: '', githubRepository: null, runtimeCompat: {} }),
    BLANK,
  )
})

Deno.test('diff: one edit per field that moved, key order and nulls aside', () => {
  let page: Details = {
    description: 'the core',
    githubRepository: { name: 'yak', owner: 'yak-sh' },
    runtimeCompat: { browser: true, deno: true },
  }
  let same: Details = {
    description: 'the core',
    githubRepository: { owner: 'yak-sh', name: 'yak' },
    runtimeCompat: { deno: true, browser: true },
  }
  assertEquals(diff(same, page), [])
  assertEquals(diff({ ...same, description: 'moved' }, page), [
    { field: 'description', value: 'moved' },
  ])
  assertEquals(diff(same, BLANK), [
    { field: 'description', value: 'the core' },
    { field: 'githubRepository', value: same.githubRepository },
    { field: 'runtimeCompat', value: same.runtimeCompat },
  ])
})

Deno.test('plan: no page on JSR is measured against a blank one', () => {
  let pkg = {
    name: '@yaks/x',
    dir: 'packages/x',
    want: { ...BLANK, description: 'a thing' },
  }
  assertEquals(plan(pkg, null), {
    name: '@yaks/x',
    have: null,
    edits: [{ field: 'description', value: 'a thing' }],
  })
})

Deno.test('show: a value as a human reads it', () => {
  assertEquals(show('hi'), '"hi"')
  assertEquals([show(''), show(null), show({})], ['none', 'none', 'none'])
  assertEquals(show({ owner: 'yak-sh', name: 'yak' }), 'yak-sh/yak')
  assertEquals(show({ deno: true, browser: true }), 'deno, browser')
})

Deno.test('lines: a headline, then the fields that move', () => {
  assertEquals(lines({ name: '@yaks/x', have: BLANK, edits: [] }), [
    'ok   @yaks/x',
  ])
  assertEquals(
    lines({
      name: '@yaks/x',
      have: BLANK,
      edits: [{ field: 'description', value: 'a thing' }],
    }),
    ['set  @yaks/x', '       description: none -> "a thing"'],
  )
  assertEquals(
    lines({ name: '@yaks/x', have: null, edits: [] })[0],
    'new  @yaks/x',
  )
})

Deno.test('read: a page comes back narrowed, a 404 comes back null', async () => {
  let { get, calls } = stub((url) =>
    url.endsWith('/graph')
      ? json({ description: 'the core', runtimeCompat: { deno: true } })
      : json({ code: 'packageNotFound' }, 404)
  )
  assertEquals(await read(get, '@yaks/graph'), {
    description: 'the core',
    githubRepository: null,
    runtimeCompat: { deno: true },
  })
  assertEquals(await read(get, '@yaks/nope'), null)
  assertEquals(calls[0].url, 'https://api.jsr.io/scopes/yaks/packages/graph')
})

Deno.test('read: any other status is the error, with what JSR said', async () => {
  let { get } = stub(() => new Response('down', { status: 500 }))
  await assertRejects(
    () => read(get, '@yaks/graph'),
    Error,
    'GET @yaks/graph: 500 down',
  )
})

Deno.test('write: one PATCH carrying exactly one field', async () => {
  let { get, calls } = stub(() => new Response(null, { status: 200 }))
  await write(get, 'jsrw_tok', '@yaks/graph', {
    field: 'runtimeCompat',
    value: { deno: true },
  })
  assertEquals(calls, [{
    url: 'https://api.jsr.io/scopes/yaks/packages/graph',
    method: 'PATCH',
    body: { runtimeCompat: { deno: true } },
  }])
})

Deno.test('write: a refusal names the package and the field', async () => {
  let { get } = stub(() => new Response('too long', { status: 400 }))
  await assertRejects(
    () =>
      write(get, 'jsrw_tok', '@yaks/graph', {
        field: 'description',
        value: 'x',
      }),
    Error,
    'PATCH @yaks/graph description: 400 too long',
  )
})

Deno.test('mint: POST to the scope, the bare package name as the body', async () => {
  let { get, calls } = stub(() => new Response(null, { status: 200 }))
  await mint(get, 'jsrw_tok', '@yaks/graph')
  assertEquals(calls, [{
    url: 'https://api.jsr.io/scopes/yaks/packages',
    method: 'POST',
    body: { package: 'graph' },
  }])
})

Deno.test('mint: the weekly creation limit surfaces as JSR worded it', async () => {
  let { get } = stub(() =>
    new Response('weekly package creation limit exceeded', { status: 400 })
  )
  await assertRejects(
    () => mint(get, 'jsrw_tok', '@yaks/graph'),
    Error,
    'POST @yaks/graph: 400 weekly package creation limit exceeded',
  )
})
