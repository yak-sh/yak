// The app vocabulary, held to two things: every example the guide teaches
// loads, and what a load implies is one app's tables — not the fleet's 83
// (V-33553).
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import { schema } from '@yaks/sqlite'
import { fields } from '@yaks/fts'
import ops from '../../src/store/schema.json' with { type: 'json' }
import { PAGES } from './guide.ts'
import {
  appDoc,
  appVocab,
  EXAMPLE,
  gitVocab,
  homed,
  livesIn,
  meant,
  numbered,
  PLATFORM_APART,
  platformVocab,
  RELATIONS,
  RESERVED,
} from './vocab.ts'
import type { PropSchema, VocabDoc } from '@yaks/vocab'

// A manifest in the one spelling, without every test saying `$defs` and
// `properties` around it. The columns are written as they are declared.
let says = (defs: Record<string, Record<string, PropSchema>>): VocabDoc => ({
  $defs: Object.fromEntries(
    Object.entries(defs).map(([name, props]) => [name, { properties: props }]),
  ),
})
let txt: PropSchema = { type: 'string' }
let num: PropSchema = { type: 'number' }

let read = (path: string) =>
  Deno.readTextFileSync(new URL(path, import.meta.url))

// Every balanced `{…}` in a text that parses as JSON. The guide is where the
// examples live — the format has no file of its own in this repo — so this is
// how the converter meets the ones people copy.
let braced = (text: string): unknown[] => {
  let out: unknown[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] != '{') continue
    let depth = 0
    for (let j = i; j < text.length; j++) {
      if (text[j] == '{') depth++
      else if (text[j] == '}' && !--depth) {
        try {
          out.push(JSON.parse(text.slice(i, j + 1)))
        } catch { /* prose that happened to hold a brace */ }
        break
      }
    }
  }
  return out
}

// A manifest in a page, by its own shape: a JSON Schema document.
let manifest = (v: unknown): v is VocabDoc =>
  !!v && typeof v == 'object' && !Array.isArray(v) &&
  !!(v as VocabDoc).$defs

let examples = (): [string, VocabDoc][] => {
  let sources: [string, string][] = [
    ['vocab.ts EXAMPLE', EXAMPLE],
    ['docs.md', read('./public/docs.md')],
    ...PAGES.map((
      p,
    ) =>
      [`docs/${p.slug}.md`, read(`./public/docs/${p.slug}.md`)] as [
        string,
        string,
      ]
    ),
  ]
  return sources.flatMap(([where, text]) =>
    braced(text).filter(manifest).map((m) => [where, m] as [string, VocabDoc])
  )
}

Deno.test('every example vocab.json in the repo loads', () => {
  let found = examples()
  // The guide is full of them; finding almost none means the extractor broke,
  // not that the examples went away.
  assert(found.length >= 15, `only ${found.length} examples found`)
  for (let [where, m] of found) {
    let v = appVocab(m)
    for (let [name, schema] of Object.entries(m.$defs ?? {})) {
      // A rule is a declaration and not a component: it has a match where a
      // component has columns, and no table is raised for it.
      if (schema.rule) continue
      assertEquals(
        v.comp(name)?.writable.sort(),
        Object.keys(schema.properties ?? {}).sort(),
        where,
      )
    }
  }
})

// A component an app declares is a kind sorting before `doc` without saying
// so: its own word is the most specific thing said about a row, and that is
// what earns it its two tools (kinds.ts).
Deno.test("an app's own word is a kind before doc", () => {
  let v = appVocab(says({ recipe: { serves: num } }))
  assertEquals(v.kindOf({ doc: 1, recipe: 1 }), 'recipe')
  // Unless the manifest says otherwise.
  assertEquals(
    appVocab({
      $defs: {
        note: {
          component: true,
          type: 'object',
          kind: false,
        },
      },
    }).kinds
      .includes('note'),
    false,
  )
})

// There is one spelling. A manifest of bare component names is not a shorter
// way to say a document — it is refused, in the shape that works.
Deno.test('a manifest that is not a document is refused', () => {
  let why = assertThrows(
    () => appDoc('{"recipe": {"serves": "number"}}'),
    Error,
  ).message
  assertStringIncludes(why, 'vocab.json: recipe — a manifest is a JSON Schema')
  assertStringIncludes(why, '"$defs"')
  assertStringIncludes(why, 'guide')
  // Nothing declared is not a refusal: an app may have no words of its own.
  assertEquals(Object.keys(appDoc('').$defs ?? {}), [])
  assertEquals(Object.keys(appDoc('{}').$defs ?? {}), [])
  assertEquals(Object.keys(appDoc(undefined).$defs ?? {}), [])
})

// YAML is the warm path, and a vocab.json keeps working because YAML reads it
// (@yaks/yaml, M-34605). The two spellings of the file are the same manifest;
// which one an app wrote is what a refusal has to name.
Deno.test('a manifest may be written as YAML', () => {
  let yml = appDoc(
    '$defs:\n  recipe:\n    properties:\n      serves:\n        type: number\n',
    'vocab.yml',
  )
  assertEquals(yml, appDoc(says({ recipe: { serves: num } })))
})

Deno.test('a broken manifest is refused in its own file name', () => {
  assertThrows(
    () => appDoc('recipe:\n - a\n  b: c\n', 'vocab.yml'),
    Error,
    'vocab.yml is not YAML',
  )
  assertThrows(
    () => appDoc('[]', 'vocab.yml'),
    Error,
    'vocab.yml is an object',
  )
})

Deno.test('a manifest is refused in the words that fix it', () => {
  assertThrows(() => appDoc('{'), Error, 'vocab.json is not JSON')
  assertThrows(() => appDoc('[]'), Error, 'vocab.json is an object')
  assertThrows(
    () => appDoc(says({ doc: { headline: txt } })),
    Error,
    'doc is a word the platform already says',
  )
  // Every collision at once, so probing for a free name is one deploy and not
  // one a name (C-32624 item 1).
  assertThrows(
    () => appDoc(says({ card: {}, entry: { at: txt }, jotting: {} })),
    Error,
    'card, entry are words the platform already says',
  )
  assertEquals(RESERVED.includes('member'), true)
  assertEquals(RESERVED.includes('edge'), true)
})

let tablesOf = (sql: string[]) =>
  sql.flatMap((s) =>
    [...s.matchAll(/create table if not exists "?(\w+)"?/g)].map((m) => m[1])
  ).sort()

// What the load implies: one app's schema. The fleet's store plants 83 tables
// into every customer's Durable Object today; this is the whole of what a
// store needs instead.
Deno.test('the loaded vocabulary implies core + member + edge + the app', () => {
  let sql = schema(appVocab(says({ recipe: { serves: num }, cooked: {} })))
  assertEquals(
    tablesOf(sql),
    [
      // the spine @yaks/sqlite raises for every layout, and the store's own
      // key/value beside it
      'entity',
      'entity_sequence',
      'tombstone',
      'server_meta',
      // core and derived component-set descriptors
      'archetype',
      'retired',
      'doc',
      'person',
      'created',
      'updated',
      // @yaks/member
      'member',
      'grant',
      'access',
      // @yaks/edge — the link, and the twelve verbs it may wear
      'edge',
      ...RELATIONS,
      // @yaks/key — the carrier of a value an entity answers to, and the one
      // kind of it every store speaks: a name (@yaks/alias)
      'key',
      'alias',
      // what the platform says in every app's store: the breaks it noted, the
      // marks a served or fixed item wears, and the two rows an upload makes
      'exception',
      'error',
      'archived',
      'notified',
      'opened',
      'quarantined',
      'blob',
      'image',
      'attachment',
      // and the words the guide gives an app to reach for rather than invent
      'task',
      'filed',
      'completed',
      'cancelled',
      'project',
      'comment',
      // what a shop sells: the platform's word, because the platform's own
      // checkout door reads a price off it (sell.ts), and what it sold, which
      // the platform's own Connect webhook writes
      'product',
      'order',
      'favorite',
      'web',
      // @yaks/mail — the app's own mailbox: the letter, the address, the ask
      // to send it and the two ends of what became of it
      'mail',
      'email',
      'deliver',
      'delivered',
      'bounced',
      // @yaks/wake — a schedule any entity may wear, fired by the object's own
      // alarm (D-37562)
      'wake',
      'fired',
      // @yaks/tools — an invocation, which is how work is asked for here and
      // (wearing a wake) how it is asked for later
      'call',
      'result',
      'execution',
      'tool',
      'content',
      'output',
      // the app's own
      'recipe',
      'cooked',
    ].sort(),
  )
  // Search is installed by the app, not by the storage vocabulary.
  assert(
    !sql.some((s) => s.includes('using fts5')),
  )
})

Deno.test('the directory and an app spell one word apart: member.role', () => {
  // The platform's roster is its access ladder, read space-wide (apps.ts
  // `reads`/`edits`, tools.ts `inSpace`); @yaks/member keeps belonging apart
  // from access, which it spells as a grant or the app's mode. So the two
  // stores mean two things by one column, and the MCP door types it nowhere
  // rather than as either (agent.ts `spoken`, T-34273).
  assertEquals(PLATFORM_APART, ['member.role'])
  assertEquals(platformVocab().prop('member', 'role')?.values, [
    'owner',
    'editor',
    'viewer',
  ])
  assertEquals(appVocab().prop('member', 'role')?.values, ['owner', 'member'])
})

Deno.test('the platform declares the uniques its races are decided by', () => {
  let sql = schema(platformVocab())
  for (
    let [name, cols] of [
      ['space_slug', '"space" ("slug")'],
      ['app_space_slug', '"app" ("space", "slug")'],
      ['app_store', '"app" ("store")'],
      ['member_space_person', '"member" ("space", "person")'],
      ['hostname_name', '"hostname" ("name")'],
      ['deploy_app_version', '"deploy" ("app", "version")'],
      ['published_name', '"published" ("name")'],
    ]
  ) {
    assert(
      sql.includes(
        `create unique index if not exists ${name} on ${cols}`,
      ),
      `no ${name}`,
    )
  }
  // An app's own store declares none of them — they are the directory's words.
  // Its one unique is a tool's name, which is the tool's identity.
  assertEquals(
    schema(appVocab()).filter((s) => s.includes('unique index')),
    ['create unique index if not exists tool_name on "tool" ("name")'],
  )
  // And an address is no longer one of them (T-34657): `former` is history, so
  // two apps may hold one address a year apart. Which app answers at an address
  // now is the tools' word, not an index's.
  assert(!sql.some((s) => s.includes('on "former"')))
})

Deno.test('none of the fleet vocabulary comes with it', () => {
  let fleet = tablesOf(
    (ops as { sql?: string }[]).map((o) => o.sql ?? ''),
  )
  let mine = new Set(tablesOf(schema(appVocab())))
  assert(fleet.length > 50, `the fleet plants ${fleet.length} tables`)
  // Fewer than the fleet's, by a wide margin, and the margin is the point:
  // every word here is one an app can use. The last eight are the schedule
  // and the invocation (D-37562, T-37605) — asking for something, and asking
  // for it later.
  assert(mine.size < 65, `an app plants ${mine.size}`)
  // The words an app shares with the fleet are the ones the guide gives it to
  // reach for — `task` and its marks among them. What must not come with it is
  // the fleet's own working life: its sessions, its canvas, its memories.
  for (
    let word of ['session', 'canvas', 'persona', 'memory', 'claim']
  ) {
    assert(fleet.includes(word), `the fleet no longer plants ${word}`)
    assert(!mine.has(word), `an app's store still plants ${word}`)
  }
})

// A column of an app's own says whether its words are searched, the same way
// @yaks/doc says it of `title` and `body` — the keyword rides the JSON Schema
// spelling into the loaded vocabulary, which is what @yaks/fts cuts its index
// from (graph.ts `searchable`).
Deno.test('a searched column of an app reaches the index fields', () => {
  let v = appVocab({
    $defs: {
      memo: {
        component: true,
        type: 'object',
        properties: {
          note: { type: 'string', search: true },
          aside: { type: 'string' },
        },
      },
    },
  })
  assertEquals(
    fields(v).filter((f) => f.comp == 'memo'),
    [{ comp: 'memo', prop: 'note' }],
  )
  // And the platform's own words are declared, not assumed.
  assertEquals(fields(v).filter((f) => f.comp == 'doc'), [
    { comp: 'doc', prop: 'title' },
    { comp: 'doc', prop: 'body' },
  ])
})

// One word, one home (T-32728): the second app in a space to name a word does
// not plant it again — it uses it where it lives, and a column it brings grows
// the home's table. What travels is the column's schema, so the keywords a
// borrowed column declares reach the store that plants it (T-37546).
Deno.test('a word the space already has is a use, not a home', () => {
  let shelf = appDoc(says({ book: { title: txt, pages: num } }))
  let homes = {
    book: { at: 'reading-list', props: shelf.$defs!.book.properties! },
  }
  let out = homed(
    appDoc(says({ book: { title: txt }, loan: { to: txt } })),
    homes,
  )
  // The word this app is the first to say stays its own; the shared one does
  // not, and the answer says where it lives.
  assertEquals(Object.keys(out.mine.$defs ?? {}), ['loan'])
  assertEquals(out.uses, { book: 'reading-list' })
  assertEquals(out.grows, {})
  assertEquals(livesIn(out.uses), [
    'book lives in reading-list; this app reads and writes it there',
  ])

  // A column the home has never seen grows the HOME's table, keywords and all.
  assertEquals(
    homed(
      appDoc({
        $defs: {
          book: {
            component: true,
            type: 'object',
            properties: { blurb: { type: 'string', search: true } },
          },
        },
      }),
      homes,
    ).grows,
    { 'reading-list': { book: { blurb: { type: 'string', search: true } } } },
  )

  // And the one refusal: the same column, two types, named with both and
  // with the app the word lives in.
  let why = assertThrows(
    () => homed(appDoc(says({ book: { pages: txt } })), homes),
    Error,
  ).message
  assertStringIncludes(why, 'book.pages is text here and number in')
  assertStringIncludes(why, 'reading-list, where book lives')
})

// The `search` keyword is the column's, and a column the platform refuses to
// index says so at the deploy, in @yaks/vocab's own words.
Deno.test('a searched column that holds no prose is refused', () => {
  assertThrows(
    () =>
      appDoc({
        $defs: {
          recipe: {
            component: true,
            type: 'object',
            properties: { serves: { type: 'number', search: true } },
          },
        },
      }),
    Error,
    'recipe.serves is searched but holds no prose',
  )
})

// What a store keeps is the document (graph.ts `#vocabDoor`), and what it
// answers is that document, keywords and all.
Deno.test('a store answers the document it means', () => {
  assertEquals(
    meant({
      $defs: {
        recipe: {
          component: true,
          type: 'object',
          properties: { note: { type: 'string', search: true } },
        },
      },
    }).$defs?.recipe.properties,
    { note: { type: 'string', search: true } },
  )
  // An answer nothing can read is an app with no words of its own, never a
  // failed request: a deploy is where a manifest is refused.
  assertEquals(meant('{'), {})
  assertEquals(meant({ recipe: { serves: 'number' } }), {})
  assertEquals(meant(says({ doc: { headline: txt } })), {})
})

// An app's manifest never says `component: true`: its $defs entries are its
// components, that is the whole of what the file is for, and @yaks/vocab's
// marker (T-37551) is put on here. So a store that accepted a manifest before
// the marker existed reads back as the same words it accepted.
Deno.test('a manifest wears the component marker without saying it', () => {
  let doc = appDoc(
    '{"$defs": {"recipe": {"properties": {"serves": ' +
      '{"type": "number"}}}}}',
  )
  assertEquals(doc.$defs?.recipe.component, true)
  assertEquals(appVocab(doc).all.includes('recipe'), true)
  // The same for one read back out of a store, which is where a manifest
  // written before the marker actually comes from.
  assertEquals(
    meant({ $defs: { recipe: { properties: { serves: { type: 'number' } } } } })
      .$defs?.recipe.component,
    true,
  )
})

// Numbers are @yaks/id's, and an app never opted in (T-37831). The directory
// did: `memory_recall` orders by `.order=-entity.num`, which is a column or it
// is a refused filter — so the one place the plugin is loaded is the
// platform's own two stores.
Deno.test("an app has no numbers; the platform's own stores do", () => {
  let app = appVocab(says({ recipe: { serves: num } }))
  assertEquals(app.prop('entity', 'num'), undefined)
  assert(!numbered(app))
  // And a prefix an app declares is a word nothing here reads, dropped on load
  // like any unregistered keyword.
  let letters = appVocab(says({ book: { title: txt } }))
  assertEquals(letters.comp('book')?.keywords.prefix, undefined)

  assert(numbered(platformVocab()), 'the directory numbers its own')
  assert(numbered(gitVocab()), 'the object store numbers its own')
})
