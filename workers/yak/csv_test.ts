/// <reference lib="deno.ns" />
// The spreadsheet mapping (csv.ts): where a header lands, what a cell coerces
// to, what an id column names the row, and every refusal that names the row and
// the header. The end-to-end proof — a CSV loaded into a store twice — is
// mcp_test.ts.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { type Sheet, sheet } from './csv.ts'

let city: Sheet = {
  as: 'city',
  cols: { name: 'text', country: 'text', pop: 'number', capital: 'bool' },
}

let bundles = (text: string, spec: Sheet = city) =>
  sheet('data/cities.csv', text, spec).map((s) => s.bundle)

let no = (text: string, spec: Sheet = city) =>
  assertThrows(() => bundles(text, spec), Error).message

Deno.test('a header is the same-named column, coerced to its type', () => {
  assertEquals(
    bundles('name,pop,capital\nOslo,709037,true\n'),
    [{
      entity: { eid: '$data/cities.csv:0' },
      city: { name: 'Oslo', pop: 709037, capital: true },
    }],
  )
})

Deno.test('an empty cell is unsaid, never null', () => {
  assertEquals(bundles('name,pop\nOslo,\n')[0], {
    entity: { eid: '$data/cities.csv:0' },
    city: { name: 'Oslo' },
  })
})

Deno.test('a bool is written either way round', () => {
  let said = (cell: string) =>
    (bundles(`name,capital\nOslo,${cell}\n`)[0].city as {
      capital: boolean
    }).capital
  for (let yes of ['true', 'YES', '1']) assertEquals(said(yes), true, yes)
  for (let nope of ['false', 'No', '0']) assertEquals(said(nope), false, nope)
})

Deno.test('map renames a header that does not match a column', () => {
  assertEquals(
    bundles('City,How many\nOslo,709037\n', {
      ...city,
      map: { City: 'name', 'How many': 'pop' },
    })[0],
    {
      entity: { eid: '$data/cities.csv:0' },
      city: { name: 'Oslo', pop: 709037 },
    },
  )
})

Deno.test('title and body land in doc, and the component wins the name', () => {
  assertEquals(bundles('title,body,name\nOslo,the capital,Oslo\n')[0], {
    entity: { eid: '$data/cities.csv:0' },
    city: { name: 'Oslo' },
    doc: { title: 'Oslo', body: 'the capital' },
  })
  // An app that declared `city.title` means THAT column, not the doc's.
  assertEquals(
    bundles('title\nOslo\n', { as: 'city', cols: { title: 'text' } })[0],
    { entity: { eid: '$data/cities.csv:0' }, city: { title: 'Oslo' } },
  )
})

Deno.test("an id column is the row's name, so a second load patches", () => {
  let named = {
    entity: { eid: '$data/cities.csv:0' },
    alias: { name: 'oslo' },
    city: { name: 'Oslo' },
  }
  assertEquals(
    bundles('id,name\noslo,Oslo\n').concat(bundles('alias,name\noslo,Oslo\n')),
    [named, named],
  )
  // An empty one is a row with no name of its own, minted for this batch.
  assertEquals(bundles('id,name\n,Oslo\n')[0], {
    entity: { eid: '$data/cities.csv:0' },
    city: { name: 'Oslo' },
  })
})

Deno.test('the rows keep the file and their order, for the blame', () => {
  assertEquals(
    sheet('data/cities.csv', 'name\nOslo\nBergen\n', city).map((s) => [
      s.file,
      s.index,
    ]),
    [['data/cities.csv', 0], ['data/cities.csv', 1]],
  )
})

Deno.test("quotes, CRLF and a spreadsheet's BOM are the parser's own", () => {
  assertEquals(
    bundles('﻿name,country\r\n"Washington, D.C.","the ""US"""\r\n')[0],
    {
      entity: { eid: '$data/cities.csv:0' },
      city: { name: 'Washington, D.C.', country: 'the "US"' },
    },
  )
})

Deno.test('a row that is only what it IS still wears the component', () => {
  assertEquals(bundles('title\nOslo\n')[0], {
    entity: { eid: '$data/cities.csv:0' },
    city: {},
    doc: { title: 'Oslo' },
  })
})

Deno.test('a CSV with no `as` says what it needs', () => {
  assertStringIncludes(
    assertThrows(() => sheet('data/cities.csv', 'name\nOslo\n'), Error).message,
    "say which component a row becomes — store_load(as: 'city')",
  )
})

Deno.test('a header naming nothing is refused, naming the header', () => {
  assertStringIncludes(no('name,pop,mayor\nOslo,1,Anne\n'), '"mayor"')
  assertStringIncludes(no('name,pop,mayor\nOslo,1,Anne\n'), 'city takes name')
  // A mapped one names both spellings, since neither is what the file says.
  assertStringIncludes(
    no('Mayor\nAnne\n', { ...city, map: { Mayor: 'mayor' } }),
    '"Mayor" maps to "mayor", which is not a column of city',
  )
  assertStringIncludes(no('name,\nOslo,x\n'), 'column 2 has no header')
})

Deno.test('a cell that will not coerce names the row and the header', () => {
  assertStringIncludes(
    no('name,pop\nOslo,709037\nBergen,many\n'),
    'data/cities.csv[1]: pop is "many", not a number',
  )
  assertStringIncludes(
    no('name,capital\nOslo,maybe\n'),
    'data/cities.csv[0]: capital is "maybe", not a bool',
  )
})

Deno.test('a row with more values than columns is refused', () => {
  assertStringIncludes(
    no('name\nOslo,709037\n'),
    'data/cities.csv[0] has 2 values for 1 header',
  )
})

Deno.test('an empty file, and one that is not a CSV at all', () => {
  assertStringIncludes(no(''), 'data/cities.csv is empty')
  assertStringIncludes(no('name\n"Oslo\n'), 'data/cities.csv is not a CSV')
})
