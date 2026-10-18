// A read-only connection can rank through a previously built native index,
// including writes its build has not seen, without writing metadata on close.
import { equal, ok, test } from '@yaks/testing'
import { Buffer } from 'node:buffer'
import { insert } from '@yaks/sql'
import { open } from '@yaks/sqlite/db'
import { statements } from '@yaks/sqlite'
import { SPINE, TOMBSTONE } from '../sqlite/testing.ts'
import { schema, TABLE } from './ddl.ts'
import { candidates, install, prepare } from './native.ts'
import { nearest } from './near.ts'
import { pack, unit } from './vector.ts'

let dir = Deno.makeTempDirSync({ prefix: 'embedding-reader-' })
let path = `${dir}/yak.db`
let writer = open(path), db = statements(writer)
for (let s of [SPINE, TOMBSTONE, ...schema()]) db.query(s)
writer.query({ t: 'pragma', name: 'synchronous', value: 'off' })
let ids = Array.from({ length: 300 }, (_, i) => i + 1)
let model = 'reader', query = Float32Array.of(1, 1, 0, 0)
let put = (owner: number, vec: Float32Array) => ({
  owner,
  model,
  hash: '',
  vec: pack(unit(vec)),
})
db.query(insert('entity', ...ids.map((id) => ({ id, eid: `v-${id}` }))))
db.query(insert(
  TABLE,
  ...ids.map((id) => put(id, Float32Array.of(1, id / 300, 0, 0))),
))
install(db)
prepare(db)
// One exact, dirty neighbour was never in the codes.
db.query(insert('entity', { id: 301, eid: 'fresh' }))
db.query(insert(TABLE, put(301, query)))
let reader = open(path, { readOnly: true }), read = statements(reader)
let search = () => nearest(read, query, { model, limit: 2, without: 'v-300' })
// Loading a connection's codes is setup; measure its normal read.
equal(search().map((n) => n.entity), ['fresh', 'v-299'])
writer.close()
let contents = () =>
  [path, `${path}-wal`].map((p) => Buffer.from(Deno.readFileSync(p).buffer))
let before = contents()

test('a read-only search uses native scans and includes newly written vectors', () => {
  let pool = ok(candidates(read, query, { model, need: 2 }))
  ok(pool.includes(300) && pool.includes(301))
  ok(pool.length < ids.length, `read ${pool.length} candidates`)
})

test('a native reader closes without changing database or WAL bytes', () => {
  try {
    reader.close()
    // Compare every byte in native code rather than walking typed-array keys.
    contents().forEach((bytes, i) => ok(bytes.equals(before[i])))
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
