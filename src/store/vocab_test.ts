// An app's own components, from the manifest to a row and back: what
// vocab.json may say, what it may say NEXT (additive only), and one store
// speaking a word no other store knows. The workerd half — the same word
// through app_deploy and the Store object — is in do_test.ts.
Deno.env.set('DB_PATH', ':memory:')
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'

let { GUIDE, borrowed, dropOps, grow, homed, livesIn, parseVocab, vocabOps } =
  await import('./vocab.ts')
let { eager, mutate, plantVocab } = await import('../db.ts')
let { bareDb } = await import('../testdb.ts')
let { askOf, askRows, layered } = await import('../graph_query.ts')

type Db = ReturnType<typeof bareDb>

// The /query door, as every door on this graph spells it (server_runtime.ts's
// route, the CLI's local arm, the MCP tool): segments in, rows out, through the
// one askOf → askRows → layered pipeline. It reads the store's OWN vocabulary,
// which is the whole point here — a filter naming a word this handle planted
// answers, and one naming a word it did not is refused in that store's words.
let query = async (db: Db, search: string) => {
  let ask = askOf(
    search.slice(1).split('&').filter(Boolean).map(decodeURIComponent),
  )
  return layered(db, await askRows(db, ask), ask)
}

// The migrated template is built once at load, the way db_test.ts does it:
// that one-time cost is setup, not what the per-test budget measures.
bareDb()

let recipes = { recipe: { title: 'text', serves: 'number' } }

Deno.test('vocab.json: a component per key, a typed column per entry', () => {
  assertEquals(parseVocab('{"recipe":{"title":"text","serves":"number"}}'), {
    recipe: { title: 'text', serves: 'number' },
  })
  // A facet with no columns is a word too.
  assertEquals(parseVocab({ cookbook: {} }), { cookbook: {} })
})

Deno.test('vocab.json: every refusal names the file', () => {
  let why = (source: unknown) =>
    assertThrows(() => parseVocab(source), Error).message
  assertEquals(why('not json').includes('vocab.json is not JSON'), true)
  assertEquals(why([1]).includes('vocab.json is an object'), true)
  // The platform's words are the platform's, in every store — and the WHOLE
  // manifest is checked, so probing for a free name is one deploy, not one
  // per collision (C-32624 item 1).
  assertStringIncludes(
    why({ doc: { x: 'text' } }),
    'vocab.json: doc is a word the platform already says',
  )
  let both = why({ doc: {}, recipe: {}, entry: {} })
  assertStringIncludes(both, 'doc, entry are words the platform already says')
  assertStringIncludes(both, GUIDE)
  assertEquals(why({ Recipe: {} }).includes('is not a component name'), true)
  assertEquals(why({ recipe: { serves: 'int' } }).includes('one of text'), true)
  assertEquals(
    why({ recipe: { entity: 'text' } }).includes('is not a column name'),
    true,
  )
})

Deno.test('vocab.json grows: a column arrives, none leaves or retypes', () => {
  let was = parseVocab(recipes)
  // A later manifest that adds a column keeps the ones already written.
  assertEquals(grow(was, { recipe: { notes: 'text' } }).vocab, {
    recipe: { title: 'text', serves: 'number', notes: 'text' },
  })
  // And one that drops a column keeps it declared: its rows are still there.
  assertEquals(grow(was, { recipe: { title: 'text' } }).vocab, was)
  // A rename is an arrival beside a survivor, and the answer says both, so
  // it is not silent (C-32652 item 4).
  let moved = grow(was, { recipe: { title: 'text', portions: 'number' } })
  assertEquals(moved.added, ['recipe.portions'])
  assertEquals(moved.kept, ['recipe.serves'])
  // A manifest that changed nothing says neither.
  assertEquals(grow(was, was).added, [])
  assertEquals(grow(was, was).kept, [])
  assertThrows(
    () => grow(was, { recipe: { serves: 'text' } }),
    Error,
    'a column keeps the type',
  )
})

Deno.test('vocab.json: an empty component the manifest drops goes', () => {
  let was = parseVocab({ ...recipes, jot: { text: 'text' } })
  // The word a manifest stopped saying, with nothing written under it: gone,
  // table and all. The store answers how many rows a word holds.
  let next = parseVocab(recipes)
  let out = grow(was, next, (name) => name == 'jot' ? 0 : 1)
  assertEquals(out.dropped, ['jot'])
  assertEquals(out.vocab, next)
  assertEquals(dropOps(out.dropped).map((o) => o.sql), [
    'drop table if exists "jot"',
  ])
  // One that holds rows stays declared: the data is the record of its shape.
  assertEquals(grow(was, next, () => 1).dropped, [])
  assertEquals(grow(was, next).vocab, was)
})

Deno.test('vocab.json: the DDL is a create plus one guarded add per column', () => {
  let ops = vocabOps(parseVocab(recipes))
  assertEquals(ops.length, 3)
  assertEquals(ops[0].kind, 'exec')
  assertEquals(ops[0].sql.includes('create table if not exists "recipe"'), true)
  assertEquals(ops[0].sql.includes('"serves" real'), true)
  assertEquals(ops.slice(1).map((o) => o.kind), ['addColumn', 'addColumn'])
})

// One store's whole round trip in one test: the words it does and does not
// know, the row, the filter, the death. Every step costs a graph walk, so they
// share one handle rather than paying for four.
Deno.test('a store speaks its own word: write it, filter it, lose it', async () => {
  let db = bareDb()
  // A store with a vocabulary door and nothing declared refuses, and teaches.
  plantVocab(db, {})
  let why = assertThrows(
    () =>
      mutate(db, {
        entities: [{ entity: { eid: '$r' }, recipe: { serves: 4 } }],
      }),
    Error,
  ).message
  assertEquals(why.startsWith('unknown component: recipe'), true)
  assertEquals(why.includes('vocab.json'), true)
  assertEquals(why.includes(GUIDE), true)
  // And the QUERY door teaches the same act — never another graph's ids.
  let asked = await query(db, '?.recipe!').then(() => '').catch((e) =>
    (e as Error).message
  )
  assertEquals(asked.startsWith('unknown prop: .recipe'), true)
  assertEquals(asked.includes('vocab.json'), true)
  assertEquals(asked.includes(GUIDE), true)
  assertEquals(/P-\d|T-\d/.test(asked), false)

  plantVocab(db, parseVocab(recipes))
  let out = mutate(db, {
    entities: [{
      entity: { eid: '$r' },
      doc: { title: 'pancakes' },
      recipe: { title: 'Pancakes', serves: 4 },
    }],
  })
  let eid = out.aliases.$r
  assertEquals(
    out.changes.some((c) => c.name == 'recipe' && c.eid == eid),
    true,
  )
  // Graph-out carries it, and the filter grammar reaches it qualified.
  assertEquals(eager(db, eid).recipe, { eid, title: 'Pancakes', serves: 4 })
  let rows = await query(db, '?.recipe.serves=4') as {
    entity: { eid: string }
    kind: string
  }[]
  assertEquals(rows.map((r) => r.entity.eid), [eid])
  assertEquals((await query(db, '?.recipe.serves=9') as unknown[]).length, 0)
  // A row wearing the store's own word says that word: `recipe` is the most
  // specific thing about it, where `doc` is the title it also carries.
  assertEquals(rows[0].kind, 'recipe')
  // A word the store DOES know, asked wrong: the refusal names the columns
  // this store declared, with their types, at both doors — the app's own
  // vocabulary teaches its shape the way the platform's does (C-32675 item 3).
  assertEquals(
    assertThrows(
      () => mutate(db, [{ eid, name: 'recipe', comp: { minutes: 20 } }]),
      Error,
    ).message,
    'unknown column: recipe.minutes — recipe has title (text), ' +
      'serves (number)',
  )
  assertEquals(
    await query(db, '?.recipe.minutes=20').then(() => '').catch((e) =>
      (e as Error).message
    ),
    'no such prop: .recipe.minutes — recipe has title (text), serves (number)',
  )
  // And the row dies with its entity, like every other component's.
  mutate(db, [{ eid, name: 'entity', comp: null }])
  assertEquals(eager(db, eid).recipe, undefined)
})

// Every listing is creation-ordered, whichever lane answers it: a filter on an
// app's own component declines to the JS matcher (sql.ts `known` reads the
// platform vocabulary), and that lane used to hand back the candidate scan's
// order — no order at all — where `.doc!` came off the spine (C-32574 item 3).
Deno.test('a store lists its own word in creation order', async () => {
  let db = bareDb()
  plantVocab(db, parseVocab(recipes))
  let titles = ['Pancakes', 'Waffles', 'Crepes', 'Grits']
  for (let title of titles) {
    mutate(db, {
      entities: [{
        entity: { eid: crypto.randomUUID() },
        doc: { title },
        recipe: { title, serves: 2 },
      }],
    })
  }
  let listed = async (q: string) =>
    ((await query(db, q)) as { doc: { title: string } }[])
      .map((r) => r.doc.title)
  // A listing carries the components its filter NAMES, so a recipe listing
  // that wants the title asks for it (workers/yak/graph.ts).
  assertEquals(await listed('?.recipe!&.doc?'), titles)
  assertEquals(await listed('?.doc!'), titles)
  // A window is the NEWEST page of that same order.
  assertEquals(await listed('?.recipe!&.doc?&limit=2'), titles.slice(-2))
})

// One word, one home (T-32728): the second app in a space to name a word does
// not plant it again — it uses it where it lives.
Deno.test('vocab.json: a word the space already has is a use, not a home', () => {
  let shelf = parseVocab({ book: { title: 'text', pages: 'number' } })
  let homes = { book: { at: 'reading-list', cols: shelf.book } }
  let out = homed(
    parseVocab({ book: { title: 'text' }, loan: { to: 'text' } }),
    homes,
  )
  // The word this app is the first to say stays its own; the shared one does
  // not, and the answer says where it lives.
  assertEquals(out.mine, { loan: { to: 'text' } })
  assertEquals(out.uses, { book: 'reading-list' })
  assertEquals(out.grows, {})
  assertEquals(livesIn(out.uses), [
    'book lives in reading-list; this app reads and writes it there',
  ])
  // A use enters a tools.json check as a bare word: the columns are the
  // home's to say.
  assertEquals(borrowed(out.uses), { book: {} })

  // A column the home has never seen grows the HOME's table.
  assertEquals(
    homed(parseVocab({ book: { isbn: 'text' } }), homes).grows,
    { 'reading-list': { book: { isbn: 'text' } } },
  )

  // And the one refusal: the same column, two types, named with both and
  // with the app the word lives in.
  let why = assertThrows(
    () => homed(parseVocab({ book: { pages: 'text' } }), homes),
    Error,
  ).message
  assertStringIncludes(why, 'book.pages is text here and number in')
  assertStringIncludes(why, 'reading-list, where book lives')
})
