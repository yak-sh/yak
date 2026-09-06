/// <reference lib="deno.ns" />
// Who a stranger is served (anon.ts): which tools say they need nobody, and
// which app a signed-out read is scoped to. The list is PINNED on purpose — a
// tool that grows `noauth` lands here in a diff, which is the whole point of
// declaring it.
import { assertEquals, assertRejects } from '@std/assert'
import { anonymous, opened, openly, READS } from './anon.ts'
import type { Ctx } from './tools.ts'
import { TOOLS } from './tools.ts'

// The platform's own tools a caller who has not signed in may call. The
// generic tier's reads are beside them (READS), and everything else meets the
// challenge.
let OPEN = ['about', 'app_published', 'feedback', 'guide']

Deno.test('the tools that need nobody are the pinned ones', () => {
  assertEquals(TOOLS.filter(openly).map((t) => t.name).sort(), OPEN)
  // Each says BOTH schemes: it works with a token and without one, which is
  // what a host reads to offer the sign-in beside an open tool.
  for (let t of TOOLS.filter(openly)) {
    assertEquals(t.security, [
      { type: 'noauth' },
      { type: 'oauth2', scopes: ['graph'] },
    ], t.name)
  }
  for (let name of [...OPEN, ...READS]) assertEquals(anonymous(name), true)
  for (let name of ['app_list', 'graph_apply', 'app_new', 'nope']) {
    assertEquals(anonymous(name), false, name)
  }
})

// A directory of one space with three apps, as much of it as `opened` asks.
let ada = { eid: 's1', slug: 'ada' }
let apps: Record<string, Record<string, unknown>> = {
  runs: { eid: 'a1', slug: 'runs', access: 'public' },
  votes: { eid: 'a2', slug: 'votes', access: 'open' },
  diary: { eid: 'a3', slug: 'diary', access: 'private' },
  gone: { eid: 'a4', slug: 'gone', access: 'public', trashed: '2026-09-01' },
}

let ctx = {
  person: '',
  dir: {
    space: (slug: string) => Promise.resolve(slug == 'ada' ? ada : null),
    app: (_space: unknown, slug: string) => Promise.resolve(apps[slug] ?? null),
  },
} as unknown as Ctx

Deno.test('a read signed out is scoped to one app anybody can read', async () => {
  for (let app of ['runs', 'votes']) {
    let [one] = await opened(ctx, { space: 'ada', app })
    assertEquals([one.space.slug, one.app.slug], ['ada', app])
    // Nobody, all the way down: the store is asked with no vouch at all, and
    // decides again for itself (graph.ts `authenticating`).
    assertEquals(one.who, { person: null, role: null })
  }
})

Deno.test('signed out, a private app is refused by name', async () => {
  await assertRejects(
    () => opened(ctx, { space: 'ada', app: 'diary' }),
    Error,
    'ada/diary is private',
  )
})

Deno.test('signed out, an app that is not there says so', async () => {
  for (let app of ['nope', 'gone']) {
    await assertRejects(
      () => opened(ctx, { space: 'ada', app }),
      Error,
      `no app ada/${app}`,
    )
  }
  await assertRejects(
    () => opened(ctx, { space: 'nobody', app: 'runs' }),
    Error,
    'no app nobody/runs',
  )
})

Deno.test('a read that names no app says it is needed signed out', async () => {
  for (let args of [{}, { app: 'runs' }, { space: 'ada' }, { app: '  ' }]) {
    await assertRejects(
      () => opened(ctx, args),
      Error,
      'signed out, a read answers for ONE app',
    )
  }
})
