/// <reference lib="deno.ns" />
// The seam itself (plugin.ts): a fixture plugin composed the way a real one
// is, and every slot's contribution seen arriving. Nothing here knows a
// domain — the domains have their own tests that go through the HOST list
// (memory_test.ts, views_test.ts) — so this is the contract on its own, and
// what it pins is the two things a host relies on: order is the list's, and a
// slot nobody filled contributes nothing.
import { assert, assertEquals } from '@std/assert'
import type { Effects as Registry } from '@yaks/effects'
import type { Rule } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import {
  answered,
  type Arrived,
  type Asked,
  effected,
  pagesOf,
  type Plugin,
  routed,
  rulesOf,
  type Stored,
  toolsOf,
  type Visit,
  vocabOf,
  wakesOf,
  watched,
} from './plugin.ts'

let doc = { $id: 'https://example.test/fixture', $defs: {} } as VocabDoc

let row = (name: string) => ({
  name,
  title: 'A fixture',
  description: 'what a fixture does',
  input: { type: 'object' as const, properties: {} },
  run: async () => await Promise.resolve({ text: name }),
})

// A rule, as a plugin declares one. What it MEANS is @yaks/graph's (its own
// rules_test.ts); what is pinned here is that the list carries it.
let rule = (name: string): Rule => ({
  name,
  phase: 'stamp',
  match: '.entity, +!fixture, *fixture',
})

let asked = (path: string) =>
  ({
    env: {} as Env,
    req: new Request('https://one.yaks.app/app/api' + path),
    path,
    space: { slug: 'one' } as Space,
    app: { slug: 'app' } as App,
    who: { person: 'p', role: 'owner' },
    refuse: () => new Response(null, { status: 403 }),
    json: (status: number) => new Response(null, { status }),
  }) as Asked

let fixture: Plugin = {
  name: 'fixture',
  vocab: [doc],
  tools: [row('fixture_one')],
  pages: [{
    slug: 'fixture',
    title: 'A fixture page',
    description: 'the page a fixture registers',
    brief: 'a fixture',
  }],
  answers: [(at) => at.path == '/fixture' ? new Response('counted') : null],
  routes: [
    (at) =>
      at.path.startsWith('/fixture.git/')
        ? new Response(at.space ?? 'apex')
        : null,
  ],
  watch: (v) => seen.push(v),
  rules: [rule('fixture/one')],
  effects: [(on, at) => {
    // The gate a real one has (outbox.ts): an app's store, never the
    // platform's own.
    if (at.meta || !at.app) return
    registered.push(`${at.app} ${at.mail() ?? ''}`)
    on.created('fixture', () => {})
  }],
  wakes: [{ entity: { eid: 'fixture' }, wake: { every: '@daily' } }],
}

let seen: Visit[] = []
let registered: string[] = []

// A registry, as much of one as a registration can tell (@yaks/effects owns
// what a handler MEANS — its own registry_test.ts): what was registered, on
// what component.
let registry = () => {
  let on: string[] = []
  let fx = {
    created: (comp: string) => (on.push(comp), fx),
    changed: (comp: string) => (on.push(comp), fx),
    removed: (comp: string) => (on.push(comp), fx),
  } as unknown as Registry
  return { fx, on }
}

let stored = (at: Partial<Stored> = {}): Stored => ({
  env: {},
  meta: false,
  app: 'an-app',
  mail: () => 'one.app@yaks.app',
  ...at,
})

// A plugin that fills nothing: the host must be able to hold it.
let quiet: Plugin = { name: 'quiet' }

Deno.test('a plugin contributes its words, its rows, its pages and its rules', () => {
  let list = [fixture, quiet]
  assertEquals(vocabOf(list), [doc])
  assertEquals(toolsOf(list).map((t) => t.name), ['fixture_one'])
  assertEquals(pagesOf(list).map((p) => p.slug), ['fixture'])
  assertEquals(rulesOf(list).map((r) => r.name), ['fixture/one'])
  assertEquals(wakesOf(list), fixture.wakes)
  // Nothing at all is the empty contribution, not a failure.
  assertEquals(vocabOf([quiet]).length, 0)
  assertEquals(toolsOf([quiet]).length, 0)
  assertEquals(pagesOf([quiet]).length, 0)
  assertEquals(rulesOf([quiet]).length, 0)
  assertEquals(wakesOf([quiet]).length, 0)
})

Deno.test('a plugin answers its own door and passes on every other', async () => {
  let list = [fixture, quiet]
  let said = await answered(list, asked('/fixture'))
  assertEquals(await said?.text(), 'counted')
  // A path no plugin claims is null, so the host goes on to its own doors.
  assertEquals(await answered(list, asked('/stats')), null)
  assertEquals(await answered([quiet], asked('/fixture')), null)
})

let arrived = (path: string, space: string | null = 'one'): Arrived => ({
  env: {} as Env,
  req: new Request(`https://${space ?? 'www'}.yaks.app${path}`),
  path,
  space,
})

Deno.test('a plugin answers a root door, and knows which root it is', async () => {
  let list = [fixture, quiet]
  // The whole path on the hostname, so a door claims what no app slug can.
  assertEquals(
    await (await routed(list, arrived('/fixture.git/info/refs')))?.text(),
    'one',
  )
  assertEquals(
    await (await routed(list, arrived('/fixture.git/info/refs', null)))?.text(),
    'apex',
  )
  // A path no plugin claims falls through to the kernel's own table.
  assertEquals(await routed(list, arrived('/fixture')), null)
  assertEquals(await routed([quiet], arrived('/fixture.git/info/refs')), null)
})

Deno.test('a plugin registers its effects on the store it is handed', () => {
  registered = []
  let { fx, on } = registry()
  effected([fixture, quiet], fx, stored())
  assertEquals(on, ['fixture'])
  assertEquals(registered, ['an-app one.app@yaks.app'])
  // The store says what it is, and a plugin decides for itself: the
  // platform's own store and one that holds no app yet register nothing.
  registered = []
  let bare = registry()
  effected([fixture], bare.fx, stored({ meta: true }))
  effected([fixture], bare.fx, stored({ app: null }))
  assertEquals(bare.on, [])
  assertEquals(registered, [])
})

Deno.test('order is the list order', async () => {
  let second: Plugin = {
    name: 'second',
    tools: [row('second_one')],
    answers: [() => new Response('second')],
  }
  assertEquals(toolsOf([fixture, second]).map((t) => t.name), [
    'fixture_one',
    'second_one',
  ])
  assertEquals(toolsOf([second, fixture]).map((t) => t.name), [
    'second_one',
    'fixture_one',
  ])
  // Both would answer `/fixture`; the earlier plugin does.
  assertEquals(
    await (await answered([second, fixture], asked('/fixture')))
      ?.text(),
    'second',
  )
})

Deno.test('a served page reaches every watcher, and a throw stops nobody', () => {
  seen = []
  let angry: Plugin = {
    name: 'angry',
    watch: () => {
      throw new Error('a counter fell over')
    },
  }
  let v: Visit = {
    env: {} as Env,
    req: new Request('https://one.yaks.app/app/'),
    res: new Response('<!doctype html>'),
    at: { app: 'e', space: 'one', slug: 'app' },
  }
  watched([angry, fixture, quiet], v)
  assertEquals(seen.length, 1)
  assert(seen[0] === v)
})
