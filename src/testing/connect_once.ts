// One connect() attempt in its own process. A corrupt-WAL regression uses a
// fresh process so SQLite releases every handle without a close-time
// checkpoint obscuring the files the test compares.
import { connect } from '../db.ts'

try {
  let db = connect(Deno.args[0])
  db.close()
  console.log('OK')
} catch (e) {
  console.log(`THREW ${e}`)
}
