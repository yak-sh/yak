import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import type { Comp } from '@yaks/graph'
import type { Item, Request } from '@yaks/model'
import { ORACLE } from '@yaks/topic'
import { human } from '@yaks/id'
import { platform } from './directory-rows-probe.ts'
import { declared } from './directory-fixture.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { operating, operatorContext } from './operator.ts'
import { drain } from './operator-store.ts'
import { oracleContext, oracleMap } from './operator-oracles.ts'
import { prefixOf } from './files.ts'
import { conversationOf } from './operator-host.ts'
import { rootOf } from './operator-channels.ts'
import { KERNEL, meta } from './meta.ts'
import { link } from '@yaks/edge'

let owner = crypto.randomUUID()
let { env } = platform('operator-oracles')
let dir = directoryOf(env.STORE)
let id = await dir.mint(owner, 'home', 'Home', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let space = (await dir.at(id))!
await dir.apply({
  entities: [{
    entity: { eid: '$recipes' },
    app: { space: id, slug: 'recipes', version: 1, access: 'private' },
    doc: { title: 'Recipe box' },
  }],
}, { 'x-yak-person': owner, 'x-yak-role': 'owner' })
let app = (await dir.app(space, 'recipes'))!
await declared(env, space, app)
let notes = `${prefixOf(space, app)}/NOTES.md`
await env.BLOBS.put(
  notes,
  'Use grams. Include ingredient amounts in the instructions.',
)
let store = operatorMemory()
let asked: Request[] = []
let names = new Map<string, string>()
let call = (name: string, args: object): Item[] => {
  let id = crypto.randomUUID()
  names.set(id, name)
  return [{ kind: 'call', id, name, args: JSON.stringify(args) }]
}
let say = (text: string): Item[] => [{ kind: 'assistant', text }]
let script = (req: Request): Item[] => {
  let text = String(req.instructions)
  let oracle = text.includes(
    `# ${human(store.vocab)({ entity: { eid: ORACLE } })} Oracle`,
  )
  let fork = JSON.stringify(req.items).includes('fork of the')
  let last = req.items.at(-1)!
  let outcome = last.kind == 'user'
    ? last.text
    : last.kind == 'result'
    ? last.output
    : ''
  if (outcome.includes('recipe oracle says:')) {
    return say(
      fork
        ? 'Recipe answer: use grams and put amounts in instructions.'
        : 'Your recipes use grams, with amounts repeated in the instructions.',
    )
  }
  if (outcome.includes('Recipe answer:')) {
    return say(
      'Your recipes use grams, with amounts repeated in the instructions.',
    )
  }
  if (last.kind == 'result') {
    if (names.get(last.id) == 'graph_apply') {
      return say(
        'The recipe oracle says: use grams, with amounts in the instructions.',
      )
    }
    return say(
      fork
        ? 'Consulting the recipe oracle.'
        : 'Checking how your recipes are kept.',
    )
  }
  if (oracle) {
    return text.includes('Use grams.')
      ? call('graph_apply', {
        self: true,
        bundles: [{
          entity: { eid: app.eid },
          content: {
            body:
              'Recipes use grams; repeat ingredient amounts in instructions.',
          },
        }],
      })
      : say('No recipe notes found.')
  }
  if (fork && outcome.includes('Find how amounts')) {
    return call('spawn', {
      topic: app.eid,
      prompt: 'How should recipe amounts be written?',
    })
  }
  if (outcome.includes('How should I write recipe amounts?')) {
    return call('fork', {
      prompt: 'Find how amounts should be written in recipes; ask its oracle.',
    })
  }
  return say('Waiting for the oracle answer.')
}
let operator = operating(
  store,
  env,
  operatorModel((req) => {
    asked.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: script(req),
    })
  }),
)
let started = await operator.ask({ person: owner }, space, {
  say: 'How should I write recipe amounts?',
})
await drain(store)
let root = rootOf(space.eid, owner)
let [fork] = await store.g.read(`.spawned.parent=${root}`)
let [oracle] = await store.g.read(`.spawned.parent=${fork.entity.eid} *`)
let rootAsk = asked[0]
let forkAsk = asked.find((r) =>
  JSON.stringify(r.items).includes('fork of the')
)!
let oracleAsk = asked.find((r) =>
  String(r.instructions).includes(
    `# ${human(store.vocab)({ entity: { eid: ORACLE } })} Oracle`,
  )
)!
let [learned] = await store.g.get([app.eid])
let drawn = await conversationOf(store, '/at', started.session)

test('a conversation stays small while its fork obtains an answer from the app oracle', () => {
  assertStringIncludes(
    String(rootAsk.instructions),
    `${app.eid} app home/recipes: Recipe box`,
  )
  assertEquals(String(rootAsk.instructions).includes('Use grams.'), false)
  assertEquals(rootAsk.instructions, forkAsk.instructions)
  assertEquals(
    rootAsk.tools.map((t) => t.name),
    forkAsk.tools.map((t) => t.name),
  )
  assertEquals((oracle.session as Comp).persona, ORACLE)
  assertEquals((oracle.session as Comp).topic, app.eid)
  assertStringIncludes(String(oracleAsk.instructions), 'Use grams.')
  assertEquals(
    drawn.html.includes('Your recipes use grams, with amounts repeated'),
    true,
    JSON.stringify(asked.map((r) => r.items.at(-1))),
  )
  assertEquals(
    (learned.content as Comp).body,
    'Recipes use grams; repeat ingredient amounts in instructions.',
  )
})

let ctx = await operatorContext(env, { person: owner }, space)
await meta(env).apply([{
  entity: { eid: crypto.randomUUID() },
  memory: { space: id },
  doc: { body: 'Use metric units throughout this space.' },
}], KERNEL)
await env.BLOBS.put(notes, 'Use millilitres for liquids.')
await oracleMap(ctx, store.g)
let refreshed = await oracleContext(ctx, store.g, app.eid)
let hidden = crypto.randomUUID()
await store.g.apply([
  {
    entity: { eid: hidden },
    topic: { name: 'hidden app' },
    doc: { title: 'Secret app' },
  },
  link(space.eid, 'contains', hidden),
])
let spaceContext = await oracleContext(ctx, store.g, space.eid)

test('consulting again refreshes sources without replacing what the oracle learned', () => {
  assertStringIncludes(refreshed, 'Use millilitres for liquids.')
  assertStringIncludes(
    refreshed,
    'Recipes use grams; repeat ingredient amounts',
  )
  assertEquals(refreshed.includes('Use grams.'), false)
  assertStringIncludes(refreshed, 'Use metric units throughout this space.')
})

test('the space oracle knows its preferences and outlines only apps in reach', () => {
  assertStringIncludes(spaceContext, 'Use metric units throughout this space.')
  assertStringIncludes(spaceContext, 'home/recipes')
  assertEquals(spaceContext.includes('Secret app'), false)
})

test('an oracle can only open a topic within the current reach', async () => {
  await assertRejects(
    () => oracleContext(ctx, store.g, crypto.randomUUID()),
    Error,
    'outside your reach',
  )
})

// Stored instruction snapshots are what the conversation displays too.
let kept = await store.g.read(`.entry.session=${root} *`)
test('the system prompt saved beside the conversation is the one the model received', () => {
  let sending = kept.find((b) => b.ask)?.sending as Comp
  assertStringIncludes(
    String(sending.instructions),
    `${app.eid} app home/recipes`,
  )
  assertEquals(String(sending.instructions).includes('connector guide'), false)
})
