// The Operator's settings are its persona's, in its own graph: it changes
// them itself when asked, its people change them on its page, and its name
// is copied to the directory, which reads it without the store (T-151515).
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { short } from '@yaks/id'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import { BASE, held, personaFor, setting } from './operator-persona.ts'
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
// The scripted Operator: asked for a new name and voice, it opens the Read on
// its settings, then writes them on its persona, as that Read says.
let call = (name: string, args: object): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let opened = ''
let script = (req: Request): Item[] => {
  let last = req.items.at(-1)!
  let results = req.items.filter((i) => i.kind == 'result')
  if (results.length == 1 && last.kind == 'result') {
    opened = last.output
    return call('graph_apply', {
      self: true,
      bundles: [{
        entity: { eid: persona },
        doc: { title: renamed },
        speech: { voice: 'aura-2-pandora-en' },
      }],
    })
  }
  if (last.kind == 'result') {
    return say(`I am ${renamed} now, speaking as Pandora.`)
  }
  let text = last.kind == 'user' ? last.text : ''
  return text.includes(renamed)
    ? call('read_open', { read: 'Your name and voice' })
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
  chat: (_: unknown, answer: { text: string }) => {
    sent.push(answer.text)
    return Promise.resolve({})
  },
})
let chatted = async (words: string) => {
  await receive(store, {
    space: space.eid,
    person: owner,
    channel: 'chat',
  }, words)
  await drain(store)
}
await chatted(`Call yourself ${renamed}, and speak in Pandora.`)
let [own] = await store.g.get([persona])

test('asked, the Operator opens its settings Read, then renames itself and changes its voice by writing its own persona', async () => {
  assertStringIncludes(String(asked[0].instructions), 'Your name and voice: ')
  assertEquals(
    String(asked[0].instructions).includes('aura-2-pandora-en'),
    false,
  )
  assertStringIncludes(
    opened,
    `on your persona ${
      short(persona)
    } in your own graph: your name is its doc{title}, and how you speak on a call its speech{voice, pace, model, backend}`,
  )
  assertStringIncludes(opened, 'aura-2-pandora-en (')
  assertEquals((own.doc as Comp).title, renamed)
  assertEquals((own.speech as Comp).voice, 'aura-2-pandora-en')
  assertEquals(sent.at(-1), `I am ${renamed} now, speaking as Pandora.`)
  // The directory's copy of its name follows, for what reads it there.
  assertEquals((await dir.at(space.eid))!.operator, renamed)
})

test('its page writes the same persona, as the person asked', async () => {
  assertEquals(
    await setting(store.g, space, owner, { voice_speed: 'brisk' }),
    {
      name: renamed,
      voice: 'aura-2-pandora-en',
      voice_speed: 'brisk',
      voice_model: null,
      voice_backend: null,
      cache_retention: null,
    },
  )
  let [row] = await store.g.get([persona])
  assertEquals(row.speech, { voice: 'aura-2-pandora-en', pace: 'brisk' })
  assertEquals((row.updated as Comp).by, owner)
})

// The persona as the store holds it: its settings and nothing else.
let kept = (b: Bundle) => ({
  doc: b.doc,
  speech: b.speech,
  cache: b.cache,
  operator: b.operator,
})

test("a space's directory settings are copied onto its persona once, never over its own", async () => {
  let fresh = operatorMemory()
  let old = { ...space, voice: 'aura-2-draco-en', cache_retention: 3600 }
  let first = await held(fresh.g.storage, old)
  assertEquals(first.copy.map(kept), [{
    doc: { title: space.operator },
    speech: { voice: 'aura-2-draco-en' },
    cache: { retention: 3600 },
    operator: undefined,
  }])
  await fresh.g.apply(first.copy, { trusted: true })
  let again = await held(fresh.g.storage, { ...old, voice: 'aura-2-luna-en' })
  assertEquals(again.copy, [])
  assertEquals(again.space.voice, 'aura-2-draco-en')
  assertEquals(again.space.cache_retention, 3600)
})

test('a persona holding the retired operator{} moves onto its title, speech{} and cache{}, once', async () => {
  let fresh = operatorMemory()
  await fresh.g.apply([{
    entity: { eid: persona },
    doc: { title: `Kit, the Operator of ${space.slug}` },
    persona: { base: BASE, home: space.eid },
    operator: { name: 'Kit', voice_speed: 'relaxed', cache_retention: 600 },
  }], { trusted: true })
  let first = await held(fresh.g.storage, space)
  assertEquals(first.space.operator, 'Kit')
  await fresh.g.apply(first.copy, { trusted: true })
  let [row] = await fresh.g.get([persona])
  assertEquals(kept(row), {
    doc: { title: 'Kit' },
    speech: { pace: 'relaxed' },
    cache: { retention: 600 },
    operator: undefined,
  })
  assertEquals((await held(fresh.g.storage, space)).copy, [])
})
