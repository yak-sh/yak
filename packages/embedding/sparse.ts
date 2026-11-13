// A selective shared-file search reads only its admitted codes, then the
// ordinary reader scores the best few from their float vectors. Reading every
// admitted float instead touched thousands of scattered pages on the box.
import {
  among,
  and,
  col,
  eq,
  exists,
  lit,
  not,
  type Raw,
  select,
  type Statements,
  table,
} from '@yaks/sql'
import { CODE } from './ddl.ts'
import { scored, type Vector } from './score.ts'

/** The best `limit` admitted codes, when every stored vector has its codes. */
export let sparse = (
  db: Statements,
  query: Float32Array,
  within: Raw,
  limit: number,
): number[] => {
  let rows = db.query(select({
    cols: [col('owner', 'c'), col('code', 'c')],
    from: table(CODE, 'c'),
    where: and(
      among(col('owner', 'c'), within),
      not(exists(select({
        cols: [lit(1)],
        from: table('tombstone', 't'),
        where: eq(col('entity', 't'), col('owner', 'c')),
      }))),
    ),
  }))
  let vectors = function* (): Generator<Vector> {
    for (let row of rows) {
      let bytes = row.code as Uint8Array
      yield {
        owner: Number(row.owner),
        vector: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      }
    }
  }
  return scored(query, vectors(), { limit, floor: -1 }).map((hit) => hit.owner)
}
