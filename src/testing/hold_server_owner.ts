// Process fixture: acquire the same pre-open lock as server.ts without ever
// importing SQLite, announce it, then hold until stdin closes or yields a byte.
import {
  acquireServerOwnership,
  ownerGraphPath,
  releaseServerOwnership,
} from '../server_ownership.ts'

acquireServerOwnership(ownerGraphPath())
console.log('owned-before-import')
await Deno.stdin.read(new Uint8Array(1))
releaseServerOwnership()
