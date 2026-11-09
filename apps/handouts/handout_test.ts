import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { forWhom, gist, kind, newest, page, size, teams } from './handout.js'

type Row = { entity: { eid: string } }
let ids = (rows: Row[]) => rows.map((r) => r.entity.eid)

let row = (eid: string, audience: string, at: string, team = '') => ({
  entity: { eid },
  handout: { audience, team },
  updated: { at },
})

test('the shelf reads newest first and narrows to one audience', () => {
  let rows = [
    row('old', 'Parents', '2026-09-01T00:00:00Z', 'Basketball'),
    row('new', 'Athletes', '2026-10-30T00:00:00Z'),
    row('mid', 'Parents', '2026-10-01T00:00:00Z', 'Volleyball'),
  ]
  assertEquals(ids(newest(rows)), ['new', 'mid', 'old'])
  assertEquals(ids(forWhom(rows, 'Parents')), [
    'old',
    'mid',
  ])
  assertEquals(forWhom(rows, '').length, 3)
  assertEquals(teams(rows), ['Basketball', 'Volleyball'])
})

test('a file says its kind and size the way a download button does', () => {
  assertEquals([size(0), size(900), size(2048), size(3_250_000)], [
    '',
    '900 bytes',
    '2 KB',
    '3.1 MB',
  ])
  assertEquals([
    kind('application/pdf'),
    kind('image/png'),
    kind('application/zip', 'roster.xlsx'),
  ], ['PDF', 'Image', 'XLSX'])
})

test('typed text becomes paragraphs, headings and lists, and nothing runs', () => {
  assertEquals(
    page(
      '## Before\nBring water.\nArrive early.\n\n- Shoes\n- Ball\n\n1. Call\n2. Wait\nThen <b>go</b>',
    ).replace(/ class="[^"]*"/g, ''),
    '<h3>Before</h3><p>Bring water.<br>Arrive early.</p>' +
      '<ul><li>Shoes</li><li>Ball</li></ul>' +
      '<ol><li>Call</li><li>Wait</li></ol><p>Then &lt;b&gt;go&lt;/b&gt;</p>',
  )
  assertEquals(
    gist('## Head\n- item\nThe first plain line.\nMore.'),
    'The first plain line.',
  )
})
