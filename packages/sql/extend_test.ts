// The extension seam: another package's clause compiler, registered through
// `compile`. These pin the whole contract — it wins over the built-in, it can
// pull a table in, declining falls back, and claiming a directive stops it
// declining.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { parse } from '@yaks/query'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { compile, type Extension, raw, Unsupported } from './mod.ts'

// A tiny bookshop: a doc, and a shelf a book sits on.
let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    shelf: { type: 'object', properties: { label: { type: 'string' } } },
  },
}
let v = loadVocab(doc)

// Claims bare words: a search of the shelf labels instead of the index.
let shelves: Extension = {
  name: 'shelves',
  compile: {
    text: (c, site) =>
      c.kind == 'text'
        ? raw({
          sql: `${site.owner} in (select entity from "shelf" where label = ?)`,
          params: [c.value],
        })
        : null,
  },
}

Deno.test('an extension compiles a clause the binder would decline', () => {
  let near: Extension = {
    name: 'near',
    compile: {
      near: (c, site) =>
        c.kind == 'near'
          ? raw({
            sql: `${site.owner} in (select entity from "vec")`,
            params: [],
          })
          : null,
    },
  }
  assertThrows(() => compile(parse('.near=x'), v), Unsupported)
  let { sql } = compile(parse('.near=x'), v, { extend: [near] })
  assert(sql.includes('select entity from "vec"'), sql)
})

Deno.test('an extension wins over the built-in lowering', () => {
  let { sql, params } = compile(parse('poetry'), v, { extend: [shelves] })
  assert(!sql.includes('doc_fts'), sql)
  assertEquals(params, ['poetry'])
})

Deno.test('declining falls back to the built-in compilation', () => {
  let quiet: Extension = { name: 'quiet', compile: { text: () => null } }
  let { sql } = compile(parse('poetry'), v, { extend: [quiet] })
  assert(sql.includes('doc_fts match ?'), sql)
})

Deno.test('site.join pulls a component table into the statement', () => {
  let joins: Extension = {
    name: 'joins',
    compile: {
      text: (_, site) =>
        raw({ sql: `${site.join('shelf')} is not null`, params: [] }),
    },
  }
  let { sql } = compile(parse('poetry'), v, { extend: [joins] })
  assert(sql.includes('left join "shelf"'), sql)
  assert(sql.includes('"shelf"."entity" is not null'), sql)
})

Deno.test('an extension spells an order value that names no column', () => {
  let ranks: Extension = {
    name: 'ranks',
    compile: {},
    order: (value, site) =>
      value == 'similar' ? `case ${site.owner} when 7 then 0 else 1 end` : null,
  }
  // with nothing to claim it, `similar` routes to a column and names none
  assertThrows(() => compile(parse('.order=similar'), v))
  let { sql } = compile(parse('.order=similar'), v, { extend: [ranks] })
  assert(
    sql.endsWith(
      'order by case "entity"."id" when 7 then 0 else 1 end, ' +
        '"entity"."num" desc',
    ),
    sql,
  )
  // a leading '-' still reverses it, and a column value still routes to a column
  let down = compile(parse('.order=-similar'), v, { extend: [ranks] })
  assert(down.sql.includes('else 1 end desc'), down.sql)
  let col = compile(parse('.order=title'), v, { extend: [ranks] })
  assert(
    col.sql.endsWith('order by "doc"."title", "entity"."num" desc'),
    col.sql,
  )
})

Deno.test('a cursor pages within an extension ranking', () => {
  let ranks: Extension = {
    name: 'ranks',
    compile: {},
    order: (value, site) =>
      value == 'similar' ? `case ${site.owner} when 7 then 0 else 1 end` : null,
  }
  let { sql } = compile(parse('.order=similar&.after=3'), v, {
    extend: [ranks],
  })
  // the hook is asked a second time with the ANCHOR's owner id, so the cursor
  // is the anchor's own place in the ranking — no second seam, no new spelling
  assert(
    sql.includes(
      'case (select "__cur"."id" from "entity" as "__cur" ' +
        'where "__cur"."num" = 3) when 7 then 0 else 1 end',
    ),
    sql,
  )
})

Deno.test('extensions run in registration order, first answer wins', () => {
  let second: Extension = {
    name: 'second',
    compile: {
      text: () => raw({ sql: '1 = 2', params: [] }),
    },
  }
  let { params } = compile(parse('poetry'), v, { extend: [shelves, second] })
  assertEquals(params, ['poetry'])
})
