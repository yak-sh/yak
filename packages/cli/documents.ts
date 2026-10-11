// The plugins' declarations, plus the components a tool call is recorded in
// where no plugin declared them. Declaring one component twice is an error
// (@yaks/vocab), and rightly — two definitions of one component is not
// something to guess about — so what is added here is only the difference,
// never a second copy.
import { description as toolsAbout, toolsDoc } from '@yaks/tools/vocab'
import { docs as machineDocs } from '@yaks/machine/vocab'
import { gitDoc } from '@yaks/git/vocab'
import type { VocabDoc } from '@yaks/vocab/runtime'

export let docsOf = (docs: VocabDoc[]): VocabDoc[] => {
  let supplied = new Set(docs.flatMap((d) => Object.keys(d.$defs ?? {})))
  // Hosts lend machines; their durable records and commit references are host words,
  // even when no plugin separately contributes these vocabulary facets.
  let intrinsic = [...machineDocs, gitDoc].map((doc) => ({
    ...doc,
    $defs: Object.fromEntries(
      Object.entries(doc.$defs ?? {}).filter(([name]) => !supplied.has(name)),
    ),
  }))
  docs = [...intrinsic.filter((doc) => Object.keys(doc.$defs).length), ...docs]
  let taken = new Set(docs.flatMap((d) => Object.keys(d.$defs ?? {})))
  let $defs = Object.fromEntries(
    Object.entries(toolsDoc.$defs ?? {}).filter(([name]) => !taken.has(name)),
  )
  return Object.keys($defs).length
    ? [{
      title: 'invocation',
      package: '@yaks/tools',
      description: toolsAbout,
      $defs,
    }, ...docs]
    : docs
}
