/// <reference lib="deno.ns" />
import { equal, test, throws } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { filter, matcher, rows } from './match.ts'
import { net } from './net.ts'
import { keyOf } from './read.ts'

let vocab = loadVocab({
  $defs: {
    document: {
      component: true,
      properties: {
        bytes: { type: 'string', contentEncoding: 'base64' },
      },
    },
  },
})
let bytes = new Uint8Array([0, 255, 128])
let all = [
  { entity: { eid: 'one' }, document: { bytes } },
  { entity: { eid: 'two' }, document: { bytes: bytes.slice() } },
  { entity: { eid: 'empty' }, document: { bytes: new Uint8Array() } },
  { entity: { eid: 'absent' }, document: {} },
]

test('binary matching compares decoded content and preserves absence', () => {
  equal(matcher('.document.bytes=AP+A', vocab)(all).map((b) => b.entity.eid), [
    'one',
    'two',
  ])
  equal(matcher('.document.bytes!=AP+A', vocab)(all).map((b) => b.entity.eid), [
    'empty',
    'absent',
  ])
  equal(
    matcher('.document.bytes=AA==,AP+A', vocab)(all).map((b) => b.entity.eid),
    ['one', 'two'],
  )
  equal(matcher('.document.bytes!', vocab)(all).map((b) => b.entity.eid), [
    'one',
    'two',
    'empty',
  ])
})

test('binary matching refuses invalid base64 and unsupported text comparisons', async () => {
  for (
    let query of [
      '.document.bytes=oops?',
      '.document.bytes>AA==',
      '.document.bytes~=AA==',
      '.document.bytes=AA==..AQ==',
    ]
  ) {
    await throws(() => filter(query, vocab))
  }
})

test('binary projection sorting and aggregates retain bytes and group by content', () => {
  equal(rows('.document .distinct=document.bytes', vocab)(all), [
    { value: new Uint8Array() },
    { value: bytes },
  ])
  equal(rows('.document .tally=document.bytes', vocab)(all), [
    { value: new Uint8Array(), n: 1 },
    { value: bytes, n: 2 },
  ])
  equal(
    matcher('.document .order=document.bytes', vocab)(all).map((b) =>
      b.entity.eid
    ),
    ['absent', 'empty', 'two', 'one'],
  )
})

test('binary values route watched queries by content', () => {
  let watching = net<string>(vocab)
  equal(watching.add('bytes', '.document.bytes=AP+A'), true)
  equal(watching.route(all[0]), ['bytes'])
  equal(watching.route(all[1]), ['bytes'])
  equal(watching.route(all[2]), [])
  equal(keyOf(bytes), keyOf(bytes.slice()))
})

test('binary ordering compares unsigned bytes rather than decimal text', () => {
  let documents = [2, 10, 128, 255].reverse().map((byte) => ({
    entity: { eid: String(byte) },
    document: { bytes: new Uint8Array([byte]) },
  }))
  equal(
    matcher('.document .order=document.bytes', vocab)(documents).map((b) =>
      b.entity.eid
    ),
    ['2', '10', '128', '255'],
  )
})
