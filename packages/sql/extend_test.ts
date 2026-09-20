// The extension seam: another package's clause compiler, registered through
// `compile`. These pin the whole contract — it can claim bare words, it can
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
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    shelf: {
      component: true,
      type: 'object',
      properties: { label: { type: 'string' } },
    },
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

Deno.test('an extension supplies text compilation', () => {
  let { sql, params } = compile(parse('poetry'), v, { extend: [shelves] })
  assert(!sql.includes('doc_fts'), sql)
  assertEquals(params, ['poetry'])
})

Deno.test('declining text without another handler is unsupported', () => {
  let quiet: Extension = { name: 'quiet', compile: { text: () => null } }
  assertThrows(
    () => compile(parse('poetry'), v, { extend: [quiet] }),
    Unsupported,
  )
  let { params } = compile(parse('poetry'), v, { extend: [quiet, shelves] })
  assertEquals(params, ['poetry'])
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

// A ranking extension is told what the REST of the line selects, so it ranks
// among those rows instead of cutting its answer before they are filtered.
Deno.test('an extension is handed the screen for the rest of the line', () => {
  let seen: (string | null)[] = []
  let ranker: Extension = {
    name: 'ranker',
    begin: (screen) => {
      let rest = screen()
      seen.push(rest && `${rest.sql} << ${rest.params.join(',')}`)
    },
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
  compile(parse('.near=b1&.title=Dune&.limit=2'), v, { extend: [ranker] })
  // its own clause and the window are gone; the filter that narrows is not
  assert(seen[0]?.includes('"doc"."title"'), `${seen[0]}`)
  assert(seen[0]?.endsWith('<< Dune'), `${seen[0]}`)
  assert(!seen[0]?.includes('limit'), `${seen[0]}`)
  // a line with nothing else on it has nothing to screen by
  compile(parse('.near=b1'), v, { extend: [ranker] })
  assertEquals(seen[1], null)
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
