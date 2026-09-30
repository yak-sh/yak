// The component and tool declarations, and only those: the module exported as
// `@yaks/sqlite/vocab`. This package declares no component — a store is not a
// domain, and nothing here is sent to a client. What it declares is two tools,
// the checks in ./tools.ts, because a tool is declared in a vocabulary and
// listed by the application the same way a component is: the file's own
// invariants are checked through the same mechanism every other package's are.
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }
import manifest from './deno.json' with { type: 'json' }

/** The tool declarations this plugin contributes. */
export let sqliteDoc: VocabDoc = doc

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [sqliteDoc]
