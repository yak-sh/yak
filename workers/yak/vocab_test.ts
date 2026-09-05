// The app vocabulary, held to three things: the short form every example in
// the guide is written in still converts, the two spellings load to the SAME
// vocabulary, and what the load implies is one app's tables — not the fleet's
// 83 (V-33553).
import { assert, assertEquals, assertThrows } from '@std/assert'
import { schema } from '@yaks/sqlite'
import { EXAMPLE as SHORT_EXAMPLE } from '../../src/store/vocab.ts'
import ops from '../../src/store/schema.json' with { type: 'json' }
import { PAGES } from './guide.ts'
import {
  appDoc,
  appVocab,
  platformVocab,
  RELATIONS,
  RESERVED,
  schemaOf,
} from './vocab.ts'

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

// A short-form manifest, by its own shape: components of typed columns.
let TYPES = ['text', 'number', 'bool', 'time', 'url']
let manifest = (v: unknown): v is Record<string, Record<string, string>> => {
  let cols = Object.values(v as Record<string, unknown>)
  return !!v && typeof v == 'object' && !Array.isArray(v) && cols.length > 0 &&
    cols.every((c) =>
      !!c && typeof c == 'object' && !Array.isArray(c) &&
      Object.values(c as Record<string, unknown>).every((t) =>
        typeof t == 'string' && TYPES.includes(t)
      )
    )
}

let examples = (): [string, Record<string, Record<string, string>>][] => {
  let sources: [string, string][] = [
    ['store/vocab.ts EXAMPLE', SHORT_EXAMPLE],
    ['guide.md', read('./public/guide.md')],
    ...PAGES.map((
      p,
    ) =>
      [`guide/${p.slug}.md`, read(`./public/guide/${p.slug}.md`)] as [
        string,
        string,
      ]
    ),
  ]
  return sources.flatMap(([where, text]) =>
    braced(text).filter(manifest).map((
      m,
    ) => [where, m] as [string, Record<string, Record<string, string>>])
  )
}

Deno.test('every example vocab.json in the repo converts and loads', () => {
  let found = examples()
  // The guide is full of them; finding almost none means the extractor broke,
  // not that the examples went away.
  assert(found.length >= 15, `only ${found.length} examples found`)
  for (let [where, m] of found) {
    let v = appVocab(m)
    for (let [name, cols] of Object.entries(m)) {
      assertEquals(
        v.comp(name)?.writable.sort(),
        Object.keys(cols).sort(),
        where,
      )
      for (let [col, type] of Object.entries(cols)) {
        assertEquals(
          v.column(name, col)?.scalar,
          type,
          `${where} ${name}.${col}`,
        )
      }
    }
  }
})

Deno.test('the five scalars each become their JSON Schema type', () => {
  assertEquals(
    schemaOf({ t: { a: 'text', b: 'number', c: 'bool', d: 'time', e: 'url' } })
      .$defs?.t.properties,
    {
      a: { type: 'string' },
      b: { type: 'number' },
      c: { type: 'boolean' },
      d: { type: 'string', format: 'date-time' },
      e: { type: 'string', format: 'uri' },
    },
  )
})

// The whole point of converting rather than refusing: an app deployed before
// JSON Schema and one written in it are the same store.
Deno.test('an old-format and a new-format app load to one vocabulary', () => {
  let old = appVocab('{"recipe": {"serves": "number", "source": "text"}}')
  let now = appVocab({
    $defs: {
      recipe: {
        type: 'object',
        kind: true,
        before: ['doc'],
        properties: {
          serves: { type: 'number' },
          source: { type: 'string' },
        },
      },
    },
  })
  let said = (v: typeof old) =>
    v.all.map((c) =>
      `${c}(${
        v.columns(c).map((p) =>
          `${p}:${v.column(c, p)!.scalar ?? v.column(c, p)!.category}`
        )
      })`
    ).join(' ')
  assertEquals(said(old), said(now))
  assertEquals(old.kinds, now.kinds)
  assertEquals(old.kindOf({ doc: 1, recipe: 1 }), 'recipe')
})

// A JSON Schema document is told from the short form by SHAPE, not by a flag.
Deno.test('the two spellings are told apart by shape', () => {
  assertEquals(Object.keys(appDoc('{"jot": {"note": "text"}}').$defs ?? {}), [
    'jot',
  ])
  assertEquals(appDoc({ $defs: { jot: { type: 'object' } } }).title, undefined)
  assertEquals(Object.keys(appDoc('').$defs ?? {}), [])
  assertEquals(Object.keys(appDoc(undefined).$defs ?? {}), [])
})

Deno.test('a manifest is refused in the words that fix it', () => {
  assertThrows(() => appDoc('{'), Error, 'vocab.json is not JSON')
  assertThrows(() => appDoc('[]'), Error, 'vocab.json is an object')
  assertThrows(
    () => appDoc('{"recipe": {"serves": "int"}}'),
    Error,
    'recipe.serves is "int" — one of text, number, bool, time, url',
  )
  assertThrows(
    () => appDoc('{"doc": {"headline": "text"}}'),
    Error,
    "'doc' is a word the platform already owns",
  )
  assertEquals(RESERVED.includes('member'), true)
  assertEquals(RESERVED.includes('edge'), true)
})

let tablesOf = (sql: string[]) =>
  sql.flatMap((s) =>
    [...s.matchAll(/create table if not exists "?(\w+)"?/g)].map((m) => m[1])
  ).sort()

// What the load IMPLIES: one app's schema. The fleet's store plants 83 tables
// into every customer's Durable Object today; this is the whole of what a
// store needs instead.
Deno.test('the loaded vocabulary implies core + member + edge + the app', () => {
  let sql = schema(appVocab('{"recipe": {"serves": "number"}, "cooked": {}}'))
  assertEquals(
    tablesOf(sql),
    [
      // the spine @yaks/sqlite raises for every layout
      'entity',
      'tombstone',
      // core
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
      // what the PLATFORM says in every app's store: the breaks it noted, the
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
      // the app's own
      'recipe',
      'cooked',
    ].sort(),
  )
  // and the prose index over `doc`, which is what search is
  assert(
    sql.some((s) => s.includes('create virtual table if not exists doc_fts')),
  )
})

Deno.test('the platform declares the uniques its races are decided by', () => {
  let sql = schema(platformVocab())
  for (
    let [name, cols] of [
      ['space_slug', '"space" ("slug")'],
      ['app_space_slug', '"app" ("space", "slug")'],
      ['alias_slug', '"alias" ("slug")'],
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
  assert(!schema(appVocab()).some((s) => s.includes('unique index')))
})

Deno.test('none of the fleet vocabulary comes with it', () => {
  let fleet = tablesOf(
    (ops as { sql?: string }[]).map((o) => o.sql ?? ''),
  )
  let mine = new Set(tablesOf(schema(appVocab())))
  assert(fleet.length > 50, `the fleet plants ${fleet.length} tables`)
  assert(mine.size < 40, `an app plants ${mine.size}`)
  for (let word of ['session', 'canvas', 'wake', 'persona', 'memory', 'task']) {
    assert(fleet.includes(word), `the fleet no longer plants ${word}`)
    assert(!mine.has(word), `an app's store still plants ${word}`)
  }
})
