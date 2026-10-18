/** Large fixed-corpus command waits: 50,000 tasks and 1,000 2-KiB transcript
 * entries in an isolated SQLite graph, through CLI process and MCP HTTP doors.
 * No live database dependency. See operation-commands.ts for full inventory.
 */
export {
  measureScale as measure,
  OPERATION_SCALE,
} from './operation-commands.ts'
import { measureScale } from './operation-commands.ts'
if (import.meta.main) console.log(JSON.stringify(await measureScale(Deno.args)))
