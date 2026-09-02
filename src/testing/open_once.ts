import { open } from '../store/sqlite.ts'
// One migrated open in a fresh process. Concurrency tests start many copies at
// once to prove SQLite serializes the idempotent migration transaction.

let db = open(Deno.args[0])
db.prepare('select count(*) from entity').get()
db.close()
