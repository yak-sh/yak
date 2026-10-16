import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { as, col, fn, select, table } from '@yaks/sql'
import { binaryCases, binaryVocab } from './binary_cases.ts'
import { storage } from './mod.ts'
import { mem } from './testing.ts'

binaryCases(() => {
  let s = storage(mem(), binaryVocab)
  s.install()
  return s
})

let driver = mem()
let s = storage(driver, binaryVocab)
s.install()
s.tx((tx) =>
  tx.patch([
    { entity: { eid: 'empty' }, document: { bytes: new Uint8Array() } },
    { entity: { eid: 'full' }, document: { bytes: Uint8Array.of(0, 255) } },
  ])
)
test('a declared binary property is stored as a SQLite BLOB, including zero bytes', () => {
  assertEquals(
    driver.query(select({
      cols: [
        as(fn('typeof', col('bytes')), 'type'),
        as(fn('length', col('bytes')), 'n'),
      ],
      from: table('document'),
    })),
    [{ type: 'blob', n: 0 }, { type: 'blob', n: 2 }],
  )
})
