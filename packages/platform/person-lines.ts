/**
 * The lines the directory answers as reads of the signed-in person, live on
 * its `/person/ws` (graph.ts): the sidebar's (./side-rows.ts), their account
 * and friends (./account-rows.ts), and the Updates waiting on them
 * (./update-waiting.ts).
 *
 * @module
 */
import { sideLine } from './side-rows.ts'
import { accountLine } from './account-rows.ts'
import { UPDATE_WAITING } from './update-waiting.ts'

/** Whether the directory answers `line` as a read of the person. */
export let personLine = (line: string): boolean =>
  line == UPDATE_WAITING || sideLine(line) || accountLine(line)
