// The copy migrator must refuse different physical SQL, even when a general
// SQL formatter would erase the difference. Refusal is safer than guessing.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { matchingDdl } from './migrate-dispatch.ts'

test('dispatch copy schema comparison preserves SQL literal differences', () => {
  for (
    let [existing, declared] of [
      [
        "CREATE TABLE x (v TEXT DEFAULT 'a  b')",
        "CREATE TABLE x (v TEXT DEFAULT 'a b')",
      ],
      [
        "CREATE TABLE x (v TEXT DEFAULT 'a , b')",
        "CREATE TABLE x (v TEXT DEFAULT 'a,b')",
      ],
      [
        "CREATE TABLE x (v TEXT DEFAULT 'IF NOT EXISTS')",
        "CREATE TABLE x (v TEXT DEFAULT '')",
      ],
      [
        'CREATE TABLE x (v TEXT DEFAULT \'"quoted"\')',
        "CREATE TABLE x (v TEXT DEFAULT 'quoted')",
      ],
    ]
  ) {
    assertEquals(matchingDdl(existing, declared), false)
  }
  assertEquals(
    matchingDdl('CREATE TABLE x (v TEXT)', 'CREATE TABLE x (v TEXT)'),
    true,
  )
  assertEquals(
    matchingDdl('  CREATE TABLE x (v TEXT)\n', 'CREATE TABLE x (v TEXT)'),
    true,
  )
  assertEquals(
    matchingDdl(
      'CREATE TABLE IF NOT EXISTS x (v TEXT)',
      'CREATE TABLE x (v TEXT)',
    ),
    false,
  )
})
