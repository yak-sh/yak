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
import type { Stmt } from '@yaks/sql'
import { fields } from '@yaks/fts'
import { PAGES } from './guide.ts'
import {
  appDoc,
  appVocab,
  EXAMPLE,
  gitVocab,
  grew,
  homed,
  livesIn,
  meant,
  numbered,
  PLATFORM_APART,
  platformVocab,
  RELATIONS,
  RESERVED,
  unsaid,
} from './vocab.ts'
import type { PropSchema, VocabDoc } from '@yaks/vocab'
import { parseTools } from './lib/tools.ts'

// A manifest in the one form, without every test saying `$defs` and
// `properties` around it. The properties are written as they are declared.
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
    // A command is a declaration too, and deploys against the words beside it.
    parseTools(m, v.comps, where)
    for (let [name, schema] of Object.entries(m.$defs ?? {})) {
      // A rule or a command is a declaration and not a component: it has a
      // match or a template where a component has properties, and no table is
      // raised for it.
      if (schema.rule || schema.tool) continue
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

// There is one form. A manifest of bare component names is not a shorter
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
// (@yaks/yaml, M-34605). The two formats of the file are the same manifest;
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
    () => unsaid(appDoc(says({ doc: { headline: txt } }))),
    Error,
    'doc is a word the platform already says',
  )
  // Every collision at once, so probing for a free name is one deploy and not
  // one a name (C-32624 item 1).
  assertThrows(
    () =>
      unsaid(appDoc(says({ comment: {}, email: { at: txt }, jotting: {} }))),
    Error,
    'comment, email are words the platform already says',
  )
  // A word the store already declares stays the app's, and a stored manifest
  // is read whatever the list has become since.
  let held = appDoc(says({ gallery: {} }))
  assertEquals(Object.keys(unsaid(held, held).$defs ?? {}), ['gallery'])
  assertThrows(() => unsaid(held), Error, 'gallery is a word')
  // The list is every platform vocabulary's: an app's store, the directory,
  // and the git object store.
  for (let word of ['member', 'edge', 'space', 'commit']) {
    assertEquals(RESERVED.includes(word), true, word)
  }
})

let tablesOf = (stmts: Stmt[]) =>
  stmts.flatMap((s) => s.t == 'create table' ? [s.name] : []).sort()

// Each index a schema declares, as `unique name table column…`.
let indexes = (stmts: Stmt[]) =>
  stmts.flatMap((s) =>
    s.t == 'create index'
      ? [[
        s.unique ? 'unique' : 'index',
        s.name,
        s.on,
        ...s.cols.map((c) => c.t == 'col' ? c.name : c.t),
      ].join(' ')]
      : []
  )

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
      // @yaks/hook — a webhook a service sent through one of the space's
      // connections (connections.ts)
      'hook',
      // @yaks/session and @yaks/model — a transcript a model answers in the
      // app's own store (models.ts, D-40545), and the catalogue it asks
      'session',
      'entry',
      'ask',
      'using',
      'notice',
      'stop',
      'attempt',
      'cancel',
      'dispatch',
      'provider',
      'model',
      'serves',
      'usage',
      'questions',
      'answer',
      // the app's own
      'recipe',
      'cooked',
    ].sort(),
  )
  // Search is installed by the app, not by the storage vocabulary.
  assert(!sql.some((s) => s.t == 'create virtual table'))
})

Deno.test('the directory and an app spell one word apart: member.role', () => {
  // The platform's roster is its access ladder, read space-wide (apps.ts
  // `reads`/`edits`, tools.ts `inSpace`); @yaks/member keeps belonging apart
  // from access, which it expresses as a grant or the app's mode. So the two
  // stores mean two things by one property, and the MCP door types it nowhere
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
  let platform = indexes(schema(platformVocab()))
  for (
    let want of [
      'space_slug space slug',
      'app_space_slug app space slug',
      'app_store app store',
      'member_space_person member space person',
      'hostname_name hostname name',
      'deploy_app_version deploy app version',
      'published_name published name',
    ]
  ) assert(platform.includes(`unique ${want}`), `no ${want}`)
  // An app's own store declares none of them — they are the directory's words.
  // Its uniques are identities (a tool's, a model's and a provider's name) and
  // an entry's place in its transcript.
  assertEquals(
    indexes(schema(appVocab())).filter((i) => i.startsWith('unique')),
    [
      'unique entry_session_seq entry session seq',
      'unique model_name model name',
      'unique provider_name provider name',
      'unique tool_name tool name',
    ],
  )
  // And an address is no longer one of them (T-34657): `former` is history, so
  // two apps may hold one address a year apart. Which app answers at an address
  // now is the tools' word, not an index's.
  assert(!platform.some((i) => i.split(' ')[2] == 'former'))
})

Deno.test('none of the fleet vocabulary comes with it', () => {
  let mine = new Set(tablesOf(schema(appVocab())))
  // What must not come with it is the fleet's own working life: its canvas,
  // its memories, and the claims its agents hold. A transcript does come, for
  // the app's own models to answer in (D-40545).
  for (
    let word of ['canvas', 'persona', 'memory', 'claim', 'log']
  ) {
    assert(!mine.has(word), `an app's store still plants ${word}`)
  }
})

// A property of an app's own says whether its words are searched, the same way
// @yaks/doc says it of `title` and `body` — the keyword rides the JSON Schema
// document into the loaded vocabulary, which is what @yaks/fts cuts its index
// from (graph.ts `searchable`).
Deno.test('a searched property of an app reaches the index fields', () => {
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
// not plant it again — it uses it where it lives, and a property it brings
// grows the home's table. What travels is the property's schema, so the
// keywords a borrowed property declares reach the store that plants it
// (T-37546).
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

  // A property the home has never seen grows the HOME's table, keywords and
  // all.
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

  // And the one refusal: the same property, two types, named with both and
  // with the app the word lives in.
  let why = assertThrows(
    () => homed(appDoc(says({ book: { pages: txt } })), homes),
    Error,
  ).message
  assertStringIncludes(why, 'book.pages is text here and number in')
  assertStringIncludes(why, 'reading-list, where book lives')
})

// The `search` keyword is the property's, and a property the platform refuses
// to index says so at the deploy, in @yaks/vocab's own words.
Deno.test('a word the manifest stopped naming leaves once it holds nothing', () => {
  let was = says({ recipe: { title: txt, serves: num, notes: txt }, jot: {} })
  let next = says({ recipe: { serves: num } })
  // `recipe.notes` still has values; `recipe.title` and `jot` hold nothing.
  let held = (name: string, prop?: string) =>
    name == 'recipe' && (!prop || prop == 'notes') ? 3 : 0
  let r = grew(was, next, held)
  assertEquals(r.dropped, ['jot', 'recipe.title'])
  assertEquals(r.kept, ['recipe.notes'])
  assertEquals(Object.keys(r.doc.$defs!.recipe.properties!), [
    'serves',
    'notes',
  ])
  // Asked nothing, a store keeps every word: nothing may leave unseen.
  assertEquals(grew(was, next).dropped, [])
})

Deno.test('a searched property that holds no prose is refused', () => {
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
  // A word the platform said after the store declared it is still the store's:
  // what it holds is read as it is (vocab.ts `unsaid`).
  assertEquals(
    Object.keys(meant(says({ gallery: {} })).$defs ?? {}),
    ['gallery'],
  )
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
// did: `memory_recall` orders by `.order=-entity.num`, which is a property or
// it is a refused filter — so the one place the plugin is loaded is the
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
