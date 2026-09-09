// The package as a graph plugin: the vocabulary, and nothing else.
//
// There is no hook here on purpose. Everything this package decides is decided
// by a host that can see pids — whether a process is alive is not a fact about
// a batch, and a rule that pretended otherwise would be guessing. The graph
// holds what was observed; ./run.ts is what observes.

import type { Plugin } from '@yaks/graph'
import { processDoc } from './comp.ts'

/**
 * The process plugin: `process{pid, command, cwd}` and `exit{code}`.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { processDoc, processes } from '@yaks/process'
 *
 * let vocab = loadVocab([processDoc, mine])
 * // let g = graph({ storage, vocab, plugins: [processes()] })
 * ```
 *
 * Output rides `content{body, source}` from @yaks/session, so a host that
 * streams a process's stdout loads that document too.
 */
export let processes = (): Plugin => ({
  name: '@yaks/process',
  vocab: [processDoc],
})
