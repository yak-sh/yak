// A search asks only the stores whose lexicon could match its words: a store
// is asked until its whole lexicon is read under the fields it indexes, and a
// write's words reach the Lexicon behind it.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { until } from '@yaks/testing'
import { connector, fresh, seed, unique } from './probe.ts'
import { type Entry, type Lexicon, lexicon, LIMIT } from './lexicon.ts'

let memory = () => {
  let held = new Map<string, unknown>()
  return {
    held: held as Map<string, Entry>,
    get: <T>(key: string) => Promise.resolve(held.get(key) as T | undefined),
    put: (key: string, value: unknown) =>
      Promise.resolve(void held.set(key, value)),
    delete: (key: string) => Promise.resolve(held.delete(key)),
  }
}

let asking = (l: Lexicon, fields = 'doc.title') => (words: string) =>
  l.admit([{ store: 'a', fields }, { store: 'b', fields }], words)

test('a lexicon is whole once read, kept by every grow, under its fields', async () => {
  let l = lexicon(memory())
  let ask = asking(l)
  assertEquals(await ask('soup'), ['a', 'b'])
  assertEquals(await l.grow('a', 'doc.title', ['soup']), false)
  assertEquals(await ask('bread'), ['a', 'b'])
  await l.put('a', 'doc.title', ['brea'])
  assertEquals(await ask('soup'), ['a', 'b'])
  assertEquals(await ask('bread'), ['a', 'b'])
  assertEquals(await ask('cake'), ['b'])
  assertEquals(await l.grow('a', 'doc.title', ['cake']), true)
  assertEquals(await ask('cake'), ['a', 'b'])
  assertEquals(await asking(l, 'doc.body')('wizard'), ['a', 'b'])
  assertEquals(await l.grow('a', 'doc.body', ['wiza']), false)
  assertEquals(await ask('soup'), ['a', 'b'])
  await l.forget('a')
  assertEquals(await ask('wizard'), ['a', 'b'])
})

test('a lexicon past its limit admits every word', async () => {
  let l = lexicon(memory())
  let many = Array.from({ length: LIMIT + 1 }, (_, i) => i.toString(36))
  await l.put('a', 'doc.title', many)
  assertEquals(await l.admit([{ store: 'a', fields: 'doc.title' }], 'x'), [
    'a',
  ])
})

test('a search asks only the stores that could match', async () => {
  let kept = memory()
  let asked: string[][] = []
  let k = await fresh({}, (env) => {
    let one = lexicon(kept)
    env.LEXICON = {
      idFromName: (name) => name,
      get: () => ({
        ...one,
        admit: async (stores, words) => {
          let out = await one.admit(stores, words)
          asked.push(out)
          return out
        },
      }),
    }
  })
  try {
    let space = unique('lexicon')
    let { cookie } = await seed(k, [{ slug: space, apps: ['soups', 'breads'] }])
    let agent = connector(k, cookie)
    let write = (app: string, title: string) =>
      agent.tool('graph_apply', {
        app,
        entities: [{ entity: { eid: '$new' }, doc: { title } }],
      })
    let found = async (text: string) =>
      (JSON.parse(await agent.tool('search', { text })) as {
        doc: { title: string }
      }[]).map((r) => r.doc.title).sort()
    await write('soups', 'Tomato soup')
    await write('breads', 'Rye bread')
    let whole = () =>
      [...kept.held].filter(([store, e]) => store.startsWith(space) && e.whole)
        .length == 2
    await until(whole, { timeout: 10_000, label: 'both lexicons read' })
    let mine = () =>
      asked.at(-1)!.filter((s) => s.startsWith(space)).map((s) =>
        s.split('/')[1].split('.')[0]
      )
    assertEquals(await found('tomato'), ['Tomato soup'])
    assertEquals(mine(), ['soups'])
    assertEquals(await found('pumpernickel'), [])
    assertEquals(mine(), [])
    await write('breads', 'Pumpernickel')
    assertEquals(
      await until(async () => (await found('pumpernickel')).length > 0),
      true,
    )
    assertEquals(mine(), ['breads'])
    // Words of the query grammar are asked of every store.
    assertEquals(await found('.doc.title~=Rye'), ['Rye bread'])
  } finally {
    await k.stop()
  }
})
