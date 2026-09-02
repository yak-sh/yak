// Process fixture: hold SQLite's migration writer slot from another process so
// a guarded server can be observed deterministically inside migrate().
import { DatabaseSync } from '../store/sqlite.ts'

let db = new DatabaseSync(Deno.args[0])
db.exec('pragma busy_timeout=30000; begin immediate')
console.log('sqlite-writer-held')
await Deno.stdin.read(new Uint8Array(1))
db.exec('rollback')
db.close()
