// The Operator's settings are its persona's, in its own graph: it changes
// them itself when asked, its people change them on its page, and its name
// is copied to the directory, which reads it without the store (T-151515).
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { short } from '@yaks/id'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { held, personaFor, setting } from './operator-persona.ts'
import { handleChannels, receive } from './operator-channels.ts'

let owner = crypto.randomUUID()
let { env } = platform('operator-settings', { DEEPGRAM_API_KEY: 'a-key' })
let dir = directoryOf(env.STORE)
let space = (await dir.at(
  await dir.mint(owner, 'home', 'Home', {
    'x-yak-person': owner,
    'x-yak-role': 'owner',
  }),
))!
let persona = personaFor(space.eid)
// The name it is asked to take: never the one the space was given.
let renamed = space.operator == 'Hazel' ? 'Wren' : 'Hazel'
let store = operatorMemory()
let asked: Request[] = []
let say = (text: string): Item[] => [{ kind: 'assistant', text }]
// The scripted Operator: asked for a new name and voice, it writes them on
// its persona, as its instructions say.
let script = (req: Request): Item[] => {
  let last = req.items.at(-1)!
  if (last.kind == 'result') {
    return say(`I am ${renamed} now, speaking as Pandora.`)
  }
  let text = last.kind == 'user' ? last.text : ''
  return text.includes(renamed)
    ? [{
      kind: 'call',
      id: crypto.randomUUID(),
      name: 'graph_apply',
      args: JSON.stringify({
        self: true,
        bundles: [{
          entity: { eid: persona },
          operator: { name: renamed, voice: 'aura-2-pandora-en' },
        }],
      }),
    }]
    : say('Noted.')
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
      cost: 0.001,
    })
  }),
)
let sent: string[] = []
handleChannels(operator, env, {
  text: (_: unknown, answer: { text: string }) => {
    sent.push(answer.text)
    return Promise.resolve({})
  },
})
let texted = async (words: string) => {
  await receive(store, {
    space: space.eid,
    person: owner,
    channel: 'text',
    address: '+12695550142',
  }, words)
  await drain(store)
}
await texted(`Call yourself ${renamed}, and speak in Pandora.`)
let [own] = await store.g.get([persona])

test('asked, the Operator renames itself and changes its voice by writing its own persona', async () => {
  assertStringIncludes(
    String(asked[0].instructions),
    `operator{name, voice, voice_speed, voice_model, voice_backend} on your persona ${
      short(persona)
    }`,
  )
  assertStringIncludes(String(asked[0].instructions), 'aura-2-pandora-en (')
  assertEquals((own.operator as Comp).name, renamed)
  assertEquals((own.operator as Comp).voice, 'aura-2-pandora-en')
  assertEquals(sent.at(-1), `I am ${renamed} now, speaking as Pandora.`)
  // The directory's copy of its name follows, for what reads it there.
  assertEquals((await dir.at(space.eid))!.operator, renamed)
})

test('its page writes the same persona, as the person asked', async () => {
  assertEquals(
    await setting(store.g, space, owner, { voice_speed: 'brisk' }),
    { name: renamed, voice: 'aura-2-pandora-en', voice_speed: 'brisk' },
  )
  let [row] = await store.g.get([persona])
  assertEquals((row.updated as Comp).by, owner)
})

test("a space's directory settings are copied onto its persona once, never over its own", async () => {
  let fresh = operatorMemory()
  let old = { ...space, voice: 'aura-2-draco-en', cache_retention: 3600 }
  let first = await held(fresh.g.storage, old)
  assertEquals(first.copy.map((b) => b.operator), [{
    name: space.operator,
    voice: 'aura-2-draco-en',
    cache_retention: 3600,
  }])
  await fresh.g.apply(first.copy, { trusted: true })
  let again = await held(fresh.g.storage, { ...old, voice: 'aura-2-luna-en' })
  assertEquals(again.copy, [])
  assertEquals(again.space.voice, 'aura-2-draco-en')
  assertEquals(again.space.cache_retention, 3600)
})
