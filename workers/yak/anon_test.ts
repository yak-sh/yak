/// <reference lib="deno.ns" />
// Who a stranger is served (anon.ts): which tools say they need nobody, and
// which app a signed-out read is scoped to. The list is pinned on purpose — a
// tool that grows `noauth` lands here in a diff, which is the whole point of
// declaring it.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { anonymous, opened, openly, READS, SCOPE } from './anon.ts'
import { about } from './preauth.ts'
import type { Ctx } from './tools.ts'
import { TOOLS } from './tools.ts'

// The platform's own tools a caller who has not signed in may call. The
// generic tier's reads are beside them (READS), and everything else meets the
// challenge.
let OPEN = [
  'about',
  'app_published',
  'feedback',
  // The gallery: the apps their owners asked us to show, which is a public
  // page whether or not anybody has signed in (gallery.ts, T-34478).
  'gallery_search',
  'guide',
]

Deno.test('the tools that need nobody are the pinned ones', () => {
  assertEquals(TOOLS.filter(openly).map((t) => t.name).sort(), OPEN)
  // Each says both schemes: it works with a token and without one, which is
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

// The one place this door promises an argument in prose (T-37617). `about` is
// what an agent reads before anything else, and it says the generic reads take
// a space and a slug — true here, where the pair is the call's whole scope, and
// not signed in, where there is a reach to read and `.in=` narrows it. An
// assistant read it signed in, went looking for an app argument the schema does
// not have, and asked how to target one app (E#868fa3f25c answer 5). So the
// sentence and the schema are held together: the paragraph is the signed-out
// one, it names every read that takes the pair and every argument in it, and it
// says what the other door does instead.
Deno.test('about promises the app pair exactly where a schema declares it', () => {
  let said = about().text.split('\n\n').find((p) => p.includes('graph_query'))
  assert(said, 'about says nothing about the generic reads')
  assert(said.startsWith('Signed out'), said.slice(0, 60))
  for (let arg of Object.keys(SCOPE)) assertStringIncludes(said, arg)
  for (let name of READS) assertStringIncludes(said, name)
  // And the signed-in answer, in the same paragraph, because that is where the
  // question gets asked: no argument, and the rider that narrows a line.
  assertStringIncludes(said, '.in=<space>/<app>')
})
