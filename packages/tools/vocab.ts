// The component declarations alone, exported as `@yaks/tools/vocab`. Nothing
// here imports the runner, so a browser tab that only needs to read and write
// these components loads nothing else.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }
const { tool, ...calls } = doc.$defs
/** Invocation records; compose with toolDoc or an existing tool declaration. */
export const callDoc: VocabDoc = { $defs: calls }
export const toolDoc: VocabDoc = { $defs: { tool } }
export const toolsDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export const description: string = manifest.description

/** Every document this plugin declares. */
export const docs: VocabDoc[] = [toolsDoc]
