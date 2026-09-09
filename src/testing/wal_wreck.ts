// Test fixture process: leave committed WAL frames behind as if a writer died.
import { DatabaseSync } from '../store/sqlite.ts'

let db = new DatabaseSync(Deno.args[0])
let ins = db.prepare('insert into t (v) values (?)')
for (let i = 0; i < 2000; i++) ins.run('y'.repeat(150))
db.exec('pragma wal_checkpoint(FULL)')
for (let i = 0; i < 800; i++) ins.run('z'.repeat(200))
Deno.kill(Deno.pid, 'SIGKILL')
