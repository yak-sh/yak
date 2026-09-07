/// <reference lib="deno.ns" />
// The seam itself (plugin.ts): a fixture plugin composed the way a real one
// is, and every slot's contribution seen arriving. Nothing here knows a
// domain — the domains have their own tests that go through the HOST list
// (memory_test.ts, views_test.ts) — so this is the contract on its own, and
// what it pins is the two things a host relies on: order is the list's, and a
// slot nobody filled contributes nothing.
import { assert, assertEquals } from '@std/assert'
import type { Rule } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import type { App, Space } from './directory.ts'
import type { Env } from './env.ts'
import {
  answered,
  type Asked,
  pagesOf,
  type Plugin,
  rulesOf,
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
  watch: (v) => seen.push(v),
  rules: [rule('fixture/one')],
  wakes: [{ entity: { eid: 'fixture' }, wake: { every: '@daily' } }],
}

let seen: Visit[] = []

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
