/** The studio's page script: the studio (studio/run.ts), run in this
 * browser's document with its draft desk. */
import { recovery } from './recovery.ts'
import { run } from './studio/run.ts'

await run({
  document,
  location,
  history,
  fetch,
  FormData,
  addEventListener,
  recovery,
})
