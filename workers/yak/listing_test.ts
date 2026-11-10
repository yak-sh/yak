// One rule for a listing, at the one seam both doors read (listing.ts): the
// tools' graph_query and the page's `/api/query` used to answer the same
// filter line differently (C-32574 item 5).
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { asking, listing, mentions, named } from './listing.ts'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { mem } from '../../packages/sqlite/testing.ts'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools'
import { personal } from '@yaks/member'
import { ram } from '@yaks/ram'

let rows = (body: string) => JSON.parse(body) as Record<string, unknown>[]

let privateVocab = loadVocab({
  $defs: {
    person: { component: true },
    doc: { component: true, properties: { title: { type: 'string' } } },
    preference: { component: true, properties: { color: { type: 'string' } } },
  },
})
let privateRows = graph({ vocab: privateVocab, storage: ram(privateVocab) })
let policies = { preference: 'entity' }
privateRows.use(personal(privateVocab, policies))
privateRows.apply([
  {
    entity: { eid: 'owner' },
    person: {},
    doc: { title: 'Owner' },
    preference: { color: 'secret' },
  },
  { entity: { eid: 'saved' }, doc: { title: 'Saved' } },
], { trusted: true })
for (
  let q of [
    '.preference',
    '.preference.color=secret',
    '.preference&.count',
    '.preference&.fields=preference.color',
  ]
) {
  test(`a listing selects a person's own aspect through ${q}`, () => {
    let line = asking(q, ['person'], policies)
    let read = q.includes('.count') ? privateRows.rows : privateRows.read
    let own = read(line, { person: 'owner' }) as unknown[]
    assertEquals(
      q.includes('.count') ? own[0] : own.length,
      q.includes('.count') ? { value: '', n: 1 } : 1,
    )
    for (let person of ['other', null]) {
      let foreign = read(line, { person }) as unknown[]
      assertEquals(
        q.includes('.count') ? foreign[0] : foreign.length,
        q.includes('.count') ? { value: '', n: 0 } : 0,
      )
    }
  })
}
test('ordinary document listings and counts still omit platform people with personal aspects', () => {
  assertEquals(
    (privateRows.read(asking('.doc', ['person'], policies), {
      person: 'owner',
    }) as { entity: { eid: string } }[]).map((b) => b.entity.eid),
    ['saved'],
  )
  assertEquals(
    privateRows.rows(asking('.doc&.count', ['person'], policies), {
      person: 'owner',
    }),
    [{ value: '', n: 1 }],
  )
})

test('a listing carries what a person saved, not the stamps', () => {
  let body = JSON.stringify([
    {
      kind: 'book',
      entity: { eid: 'a', num: 1 },
      doc: { title: 'Dune' },
      created: { by: 'jeff', at: 'now' },
      updated: { at: 'now' },
    },
    // A row that is nothing but bookkeeping is not a row a person saved.
    { kind: 'entity', entity: { eid: 'b', num: 2 }, created: { by: null } },
  ])
  assertEquals(rows(listing(body, '.book')), [
    { kind: 'book', entity: { eid: 'a', num: 1 }, doc: { title: 'Dune' } },
  ])
  // Naming a stamp asks for it back, and asks it back for every row.
  assertEquals(rows(listing(body, '.book&.created')).length, 2)
  assertEquals(rows(listing(body, '.created.by=jeff'))[0].created, {
    by: 'jeff',
    at: 'now',
  })
})

// The kernel's own rows (a break, a refusal) are left out of an app's
// question, so a listing, its count and its search agree; a line naming one,
// a transcript's entry or an address asks for it back.
let kernelVocab = loadVocab([toolsDoc, {
  $defs: {
    doc: { component: true, properties: { title: { type: 'string' } } },
    entry: { component: true, properties: { session: { type: 'string' } } },
    created: { component: true, properties: { at: { type: 'string' } } },
  },
}])
let kernelDb = storage(mem(), kernelVocab)
kernelDb.install()
let kernelRows = graph({ vocab: kernelVocab, storage: kernelDb })
let refused = {
  entry: { session: 'heal' },
  refusal: { code: 'limit' },
  content: { body: 'Budget exhausted' },
}
let created = { at: 'now' }
await kernelRows.apply([
  { entity: { eid: 'saved' }, created, doc: { title: 'Saved' } },
  { entity: { eid: 'broke' }, created, exception: { value: 'boom' } },
  { entity: { eid: 'refused' }, created, ...refused },
  {
    entity: { eid: 'both' },
    created,
    ...refused,
    exception: { value: 'boom' },
  },
], { trusted: true })
let KERNEL_WORDS = ['exception', 'refusal']
for (
  let [line, eids] of [
    ['.created', ['saved']],
    ['.doc', ['saved']],
    ['(.doc|.content)', ['saved']],
    ['.content', []],
    ['.exception', ['broke']],
    ['.refusal', ['refused']],
    ['.entry.session=heal&*', ['refused']],
    ['.entity.eid=both&*', ['both']],
  ] as const
) {
  test(`a listing of ${line} holds the kernel's rows it asked for`, async () => {
    let read = await kernelRows.read(asking(line, KERNEL_WORDS))
    assertEquals(read.map((b) => b.entity.eid).sort(), [...eids].sort())
  })
}
test("a listing's count counts the rows it lists", async () => {
  assertEquals(
    await kernelRows.read(asking('(.doc|.content)&.count', KERNEL_WORDS)),
    await kernelRows.read('.doc&.count'),
  )
})

// A page's own ask carries the screen, so a `.count` counts what the list
// beside it lists — a person the store minted wears a `doc` title now, and
// would otherwise be one more recipe (T-32627).
test("the platform's rows are left out of the question too", () => {
  let words = ['error', 'person']
  assertEquals(asking('?.doc', words), '?.doc&!error&!person')
  // and out of every alternative, not just the last
  assertEquals(asking('?.a|.b', words), '?(.a|.b)&!error&!person')
  // Naming one asks for it, and an address asks for its row whatever it is.
  assertEquals(asking('?.person', words), '?.person&!error')
  assertEquals(asking('?id=abc'), '?id=abc')
  // An empty ask selects nothing; a screen would not change that.
  assertEquals(asking('?'), '?')
})

// Storage rows hold only their own component, so a line asking for another
// never reaches them and pays no lookup to screen them (T-124491).
test('storage is screened only from a line that names no component', () => {
  let words = ['archetype', 'effect']
  assertEquals(asking('.recipe', words), '.recipe')
  assertEquals(asking('.a|.b', words), '.a|.b')
  assertEquals(asking('!recipe', words), '!recipe&!archetype&!effect')
  assertEquals(asking('.a|!b', words), '(.a|!b)&!archetype&!effect')
  assertEquals(asking('*', words), '*&!archetype&!effect')
})

test('a saved aspect cannot be a lens step, while a stamp can', () => {
  let words = ['_lens']
  assertEquals(asking('.recipe', words), '.recipe')
  assertEquals(asking('.created', words).includes('!_lens'), true)
  assertEquals(asking('.recipe|.created', words).includes('!_lens'), true)
})

test('a saved aspect cannot describe the vocabulary, while a doc or edge can', () => {
  let words = ['_comp', '_effect', '_before']
  let screens = (line: string) => {
    let asked = asking(line, words)
    return words.map((w) => asked.includes(`!${w}`))
  }
  assertEquals(screens('.recipe'), [false, false, false])
  assertEquals(screens('.recipe .doc'), [false, false, false])
  assertEquals(screens('.doc'), [true, true, true])
  assertEquals(screens('.edge.from=x'), [true, true, true])
  assertEquals(screens('.recipe|.doc'), [true, true, true])
  assertEquals(screens('.created'), [true, true, true])
})

test('what is not a row listing passes through as it came', () => {
  assertEquals(listing('{"count":3}', '.count'), '{"count":3}')
  assertEquals(listing('not json at all', '.doc'), 'not json at all')
})

test('listings read projection directives through the query grammar', () => {
  let row = { entity: { eid: 'saved' }, created: { at: 'now' } }
  let body = JSON.stringify([row])
  for (
    let line of [
      '.doc .fields=entity.eid,created.at~ .limit=1',
      '?.doc&.fields=entity.eid,created.at~&.limit=1',
      '(.doc .fields=entity.eid,created.at~)',
      '.doc|.fields="entity.eid,created.at~"',
    ]
  ) {
    assertEquals(rows(listing(body, line)), [row])
  }
  assertEquals(rows(listing(body, '"a&.fields=entity.eid"')), [])
})

// Outputs speak human: a reference to somebody the store knows carries their
// name, so a view's one query draws a byline (C-32730 item 5).
test('a reference to a person answers with a name', () => {
  let rows = [
    {
      kind: 'jog',
      entity: { eid: 'a', num: 1 },
      jog: { miles: 5, with: 'ada', note: 'ada' },
      created: { by: 'ada', via: 'a-session' },
    },
    // A reference to something that is not a person, and a row with none.
    { kind: 'jog', entity: { eid: 'b', num: 2 }, created: { by: 'nobody' } },
  ]
  let ref = (comp: string, prop: string) =>
    (comp == 'created' && (prop == 'by' || prop == 'via')) ||
    (comp == 'jog' && prop == 'with')
  let seen = mentions(rows, ref)
  assertEquals(seen.eids.sort(), ['a-session', 'ada', 'nobody'])
  // Who the store knows among them is its own word; Ada is a person.
  let out = named(rows, { refs: seen.refs, names: { ada: 'Ada' } })
  assertEquals(out[0].created, {
    by: { eid: 'ada', name: 'Ada' },
    via: 'a-session',
  })
  // Any property that references them, not just the stamp, and only one
  // that references: a note that says her eid is a note.
  assertEquals(out[0].jog, {
    miles: 5,
    with: { eid: 'ada', name: 'Ada' },
    note: 'ada',
  })
  // A stranger keeps the eid the store has always answered with.
  assertEquals(out[1].created, { by: 'nobody' })
  // Nobody to name is the rows themselves, untouched.
  assertEquals(named(rows, { refs: seen.refs, names: {} }), rows)
})
