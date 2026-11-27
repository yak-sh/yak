// The component declarations alone, exported as `@yaks/tools/vocab`. Nothing
// here imports the runner, so a browser tab that only needs to read and write
// these components loads nothing else.
import { pick, type VocabDoc } from '@yaks/vocab/runtime'
import doc from './vocab.json' with { type: 'json' }
import manifest from './package.json' with { type: 'json' }
export const toolsDoc: VocabDoc = doc
/** Invocation records; compose with toolDoc or an existing tool declaration. */
export const callDoc: VocabDoc = pick(
  doc,
  Object.keys(doc.$defs).filter((name) => name != 'tool'),
)
export const toolDoc: VocabDoc = pick(doc, ['tool'])

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export const description: string = manifest.description

/** Every document this plugin declares. */
export const docs: VocabDoc[] = [toolsDoc]

export { executionDerived as derived } from './state.ts'
