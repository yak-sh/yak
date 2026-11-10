/// <reference lib="deno.ns" />
// Storage's byte contract, exercised unchanged by RAM and SQLite.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { Binding, Bundle, Match } from '@yaks/graph'
import { match, reads } from '@yaks/graph/declared'
import { loadVocab } from '@yaks/vocab'

export let binaryVocab = loadVocab({
  $defs: {
    document: {
      component: true,
      type: 'object',
      properties: {
        bytes: { type: 'string', contentEncoding: 'base64' },
        title: { type: 'string' },
      },
    },
  },
})

type Tx = {
  patch: (bundles: Bundle[]) => unknown
  get: (eids: string[]) => Bundle[]
  read: (query: string) => Bundle[]
  bindings: (
    matches: Match[],
    bundles: Bundle[],
    covers: string[],
  ) => Binding[][]
}
type Store = {
  get: (eids: string[]) => Bundle[]
  read: (query: string) => Bundle[]
  rows: (query: string) => Record<string, unknown>[]
  tx: <R>(body: (tx: Tx) => R) => R | Promise<Awaited<R>>
}
let bytes = (b: Bundle): Uint8Array | undefined =>
  (b.document as { bytes?: Uint8Array }).bytes
let put = async (
  s: Store,
  eid: string,
  value: Uint8Array | null,
) => (await s.tx((tx) =>
  tx.patch([{ entity: { eid }, document: { bytes: value } }])
))
let ids = (s: Store, query: string) => s.read(query).map((b) => b.entity.eid)

export let binaryCases = async (make: () => Store): Promise<void> => {
  let roundtrip = make()
  let input = Uint8Array.of(99, 0, 255, 128, 42, 99).subarray(1, 5)
  await put(roundtrip, 'bytes', input)
  input.fill(17)
  test('binary storage copies the byte view, not its surrounding buffer', () => {
    assertEquals(
      bytes(roundtrip.get(['bytes'])[0]),
      Uint8Array.of(0, 255, 128, 42),
    )
    assertEquals(
      bytes(roundtrip.read('.document')[0]),
      Uint8Array.of(0, 255, 128, 42),
    )
    assertEquals(roundtrip.rows('.document .fields=document.bytes'), [
      { eid: 'bytes', 'document.bytes': Uint8Array.of(0, 255, 128, 42) },
    ])
  })

  let changed = make()
  await put(changed, 'bytes', Uint8Array.of(1, 2))
  test('binary patches replace the value and preserve it when omitted', async () => {
    await put(changed, 'bytes', Uint8Array.of(255, 0, 128))
    await changed.tx((tx) =>
      tx.patch([{
        entity: { eid: 'bytes' },
        document: { title: 'kept' },
      }])
    )
    assertEquals(bytes(changed.get(['bytes'])[0]), Uint8Array.of(255, 0, 128))
  })

  let cleared = make()
  await put(cleared, 'bytes', Uint8Array.of(0, 255))
  test('a null patch clears previously stored bytes', async () => {
    await put(cleared, 'bytes', null)
    assertEquals(bytes(cleared.get(['bytes'])[0]), undefined)
    assertEquals(ids(cleared, '.document.bytes'), [])
  })

  let empty = make()
  await put(empty, 'empty', new Uint8Array())
  await put(empty, 'null', null)
  await put(empty, 'full', Uint8Array.of(0, 255, 128))
  test('zero bytes remain a BLOB, distinct from a cleared property', () => {
    assertEquals(bytes(empty.get(['empty'])[0]), new Uint8Array())
    assertEquals(bytes(empty.get(['null'])[0]), undefined)
    assertEquals(ids(empty, '.document.bytes'), ['empty', 'full'])
    assertEquals(ids(empty, '!document.bytes'), ['empty', 'null'])
  })

  let filters = make()
  await put(filters, 'a', Uint8Array.of(0, 255, 128))
  await put(filters, 'b', Uint8Array.of(0, 255))
  await put(filters, 'c', Uint8Array.of(255))
  await put(filters, 'empty', new Uint8Array())
  await put(filters, 'null', null)
  for (
    let [operand, expected] of [
      ['AP+A', ['a']],
      ['AP8=', ['b']],
      ['AP8', ['b']],
      ['AP+A,/w==', ['a', 'c']],
    ] as const
  ) {
    test(`binary equality and lists compare ${operand} by bytes`, () => {
      assertEquals(ids(filters, `.document.bytes=${operand}`), [...expected])
    })
  }
  test('binary inequality compares base64 operands by bytes', () => {
    assertEquals(ids(filters, '.document.bytes!=AP8='), [
      'a',
      'c',
      'empty',
      'null',
    ])
  })
  for (let operand of ['%', 'A', 'AP9=', 'AP8===']) {
    test(`binary query operands refuse malformed base64 ${operand}`, () => {
      assertThrows(
        () => filters.read(`.document.bytes=${operand}`),
        Error,
        'base64',
      )
    })
  }
  for (
    let query of [
      '.document.bytes~=AP8=',
      '.document.bytes<AP8=',
      '.document.bytes=AA==..AQ==',
    ]
  ) {
    test(`binary query operands refuse text operation ${query}`, () => {
      assertThrows(() => filters.read(query), Error, 'cannot compile')
    })
  }

  let aggregates = make()
  await put(aggregates, 'a', Uint8Array.of(255))
  await put(aggregates, 'b', Uint8Array.of(0, 255))
  await put(aggregates, 'c', Uint8Array.of(0, 255))
  await put(aggregates, 'empty', new Uint8Array())
  await put(aggregates, 'null', null)
  test('binary ordering retains byte values and content identity', () => {
    assertEquals(ids(aggregates, '.document .order=document.bytes'), [
      'empty',
      'c',
      'b',
      'a',
      'null',
    ])
  })
  test('binary distinct retains byte values and content identity', () => {
    assertEquals(aggregates.rows('.document .distinct=document.bytes'), [
      { value: new Uint8Array() },
      { value: Uint8Array.of(0, 255) },
      { value: Uint8Array.of(255) },
    ])
  })
  test('binary tally retains byte values and content identity', () => {
    assertEquals(aggregates.rows('.document .tally=document.bytes'), [
      { value: new Uint8Array(), n: 1 },
      { value: Uint8Array.of(0, 255), n: 2 },
      { value: Uint8Array.of(255), n: 1 },
    ])
  })

  let isolated = make()
  await put(isolated, 'a', Uint8Array.of(0, 255))
  test('mutating bytes returned by get, read or projection cannot change storage', () => {
    bytes(isolated.get(['a'])[0])!.fill(1)
    bytes(isolated.read('.document')[0])!.fill(2)
    let row = isolated.rows('.document .fields=document.bytes')[0]
    ;(row['document.bytes'] as Uint8Array).fill(3)
    assertEquals(bytes(isolated.get(['a'])[0]), Uint8Array.of(0, 255))
  })

  let joins = make()
  await put(joins, 'a', Uint8Array.of(0, 255))
  await put(joins, 'b', Uint8Array.of(0, 255))
  await put(joins, 'c', Uint8Array.of(255, 0))
  let joined = match(
    '$left .document.bytes=$bytes; $right .document.bytes=$bytes',
  )
  test('rule joins compare independently held bytes by content', async () => {
    let [found] = await joins.tx((tx) =>
      tx.bindings([joined], [], reads(joined, binaryVocab))
    )
    assertEquals(found.map((b) => b.entities.join(':')).sort(), [
      'a:a',
      'a:b',
      'b:a',
      'b:b',
      'c:c',
    ])
    assertEquals(
      found.find((b) => b.entities[0] == 'a')?.vars.bytes,
      Uint8Array.of(0, 255),
    )
  })

  let visible = make()
  await put(visible, 'a', Uint8Array.of(0, 255))
  test('binary writes are visible in their transaction', async () => {
    await visible.tx((tx) => {
      tx.patch([{
        entity: { eid: 'a' },
        document: { bytes: Uint8Array.of(128) },
      }])
      assertEquals(bytes(tx.get(['a'])[0]), Uint8Array.of(128))
      assertEquals(bytes(tx.read('.document')[0]), Uint8Array.of(128))
    })
  })

  let rollback = make()
  await put(rollback, 'a', Uint8Array.of(0, 255))
  test('binary writes roll back on failure', async () => {
    await assertRejects(
      async () => (await rollback.tx((tx) => {
        tx.patch([{
          entity: { eid: 'a' },
          document: { bytes: Uint8Array.of(128) },
        }])
        throw new Error('rollback bytes')
      })),
      Error,
      'rollback bytes',
    )
    assertEquals(bytes(rollback.get(['a'])[0]), Uint8Array.of(0, 255))
  })
}
