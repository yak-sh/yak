import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Comp } from '@yaks/graph'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { drain } from './operator-store.ts'
import { operating } from './operator.ts'
import {
  handleChannels,
  receive,
  type Request as Intake,
  rootOf,
} from './operator-channels.ts'

// The Operator finds what it was told after it has left its context: its own
// conversations, forks and memories are in its own store, read with the same
// search, graph and memory tools the fleet uses (T-137793).
let owner = crypto.randomUUID()
let { env } = platform('operator-self')
let dir = directoryOf(env.STORE)
let id = await dir.mint(owner, 'home', 'Home', {
  'x-yak-person': owner,
  'x-yak-role': 'owner',
})
let space = (await dir.at(id))!
let store = operatorMemory()
let root = rootOf(space.eid, owner)
let asked: Request[] = []
let named = new Map<string, string>()
let say = (text: string): Item[] => [{ kind: 'assistant', text }]
let call = (name: string, args: object): Item[] => {
  let id = crypto.randomUUID()
  named.set(id, name)
  return [{ kind: 'call', id, name, args: JSON.stringify(args) }]
}
let ALVAREZ = /Dr Alvarez on Main Street/
// The scripted Operator: the conversation forks for every question, and a
// fork reads its own store for what it is asked about.
let script = (req: Request): Item[] => {
  let last = req.items.at(-1)!
  let fork = JSON.stringify(req.items).includes('fork of the')
  if (last.kind == 'result') {
    let tool = named.get(last.id)
    if (tool == 'fork') return say('On it.')
    if (tool == 'search') {
      // A hit is a line: the row's id, what it is, and the words around the
      // match.
      let hit = last.output.split('\n').find((l) =>
        l.includes('· entry') && /Dr Alvarez/.test(l)
      )
      return hit
        ? call('memory_save', {
          on: hit.split(' ')[0],
          context: 'who their dentist is',
        })
        : say('Nothing about a dentist.')
    }
    if (tool == 'memory_save') {
      return say('Their dentist is Dr Alvarez on Main Street.')
    }
    if (tool == 'memory_recall') {
      return say(
        ALVAREZ.test(last.output)
          ? 'Kept: their dentist is Dr Alvarez on Main Street.'
          : 'Nothing kept about a dentist.',
      )
    }
  }
  let text = last.kind == 'user' ? last.text : ''
  if (fork && /Find/.test(text)) {
    return call('search', { words: 'dentist', self: true })
  }
  if (fork && /Recall/.test(text)) {
    return call('memory_recall', { said: 'dentist' })
  }
  if (/Their dentist is Dr Alvarez/.test(text)) {
    return say('Your dentist is Dr Alvarez on Main Street.')
  }
  if (/Kept: their dentist/.test(text)) {
    return say('You told me: Dr Alvarez on Main Street.')
  }
  if (/Who is my dentist/.test(text)) {
    return call('fork', { prompt: 'Find who their dentist is.' })
  }
  if (/remember about my dentist/.test(text)) {
    return call('fork', { prompt: 'Recall what is kept about their dentist.' })
  }
  return say('Noted.')
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
  text: (_: Intake, answer: { text: string }) => {
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
// Everything said so far settles into a summary, as a long conversation's
// compaction leaves it (@yaks/session compact.ts): the model is shown the
// summary from here on, and not the words.
let settle = async () => {
  let entries = await store.g.read(`.entry.session=${root} .order=entry.seq`)
  let through = entries.at(-1)!
  await store.g.apply([{
    entity: { eid: crypto.randomUUID() },
    entry: { session: root },
    checkpoint: {
      through: through.entity.eid,
      seq: (through.entry as Comp).seq,
      tasks: {},
    },
    notice: {},
    content: { body: 'They said hello and talked about the weather.' },
  }], { trusted: true })
}

await texted('My dentist is Dr Alvarez on Main Street.')
await settle()
let before = asked.length
await texted('Who is my dentist?')
let found = asked.slice(before)
await settle()
before = asked.length
await texted('What do you remember about my dentist?')
let recalled = asked.slice(before)
let marks = await store.g.get(
  (await store.g.read('.memory')).map((b) => b.entity.eid),
)

test('words that have left the context are found in its own store, from a fork', () => {
  let [first] = found
  assertEquals(ALVAREZ.test(JSON.stringify(first.items)), false)
  let self = (name: string) =>
    'self' in (first.tools.find((t) => t.name == name)?.parameters
      .properties as object)
  assertEquals(['search', 'graph_query', 'graph_show'].map(self), [
    true,
    true,
    true,
  ])
  assertEquals(sent.slice(1, 3), [
    'On it.',
    'Your dentist is Dr Alvarez on Main Street.',
  ])
})

test('what it was told is kept as a memory on the entry it was said in, and recalled after it left the context again', () => {
  assertEquals(marks.length, 1)
  assertStringIncludes(
    String((marks[0].content as Comp).body),
    'Dr Alvarez on Main Street',
  )
  assertEquals((marks[0].entry as Comp).session, root)
  assertEquals(
    recalled.slice(0, 2).some((r) => ALVAREZ.test(JSON.stringify(r.items))),
    false,
  )
  assertEquals(
    sent.at(-1),
    'You told me: Dr Alvarez on Main Street.',
  )
})

test('its persona carries its name', async () => {
  let [persona] = await store.g.get([space.eid])
  assertEquals(
    (persona.doc as Comp).title,
    `${space.operator}, the Operator of home`,
  )
})
