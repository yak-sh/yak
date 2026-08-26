// One connect() attempt in its own process — the shape of the supervisor's
// crash-loop retry (T-22262). Prints OK or THREW; the handle is released by
// process exit, exactly as production's refuse path is.
import { connect } from '../db.ts'

try {
  let db = connect(Deno.args[0])
  db.close()
  console.log('OK')
} catch {
  console.log('THREW')
}
