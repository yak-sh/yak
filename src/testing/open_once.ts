// One migrated open in a fresh process. Concurrency tests start many copies at
// once to prove SQLite serializes the idempotent migration transaction.
import { open } from '../db.ts'

let db = open(Deno.args[0])
db.prepare('select count(*) from entity').get()
db.close()
