// The plugins' declarations, plus the components a tool call is recorded in
// where no plugin declared them. Declaring one component twice is an error
// (@yaks/vocab), and rightly — two definitions of one component is not
// something to guess about — so what is added here is only the difference,
// never a second copy.
import { description as toolsAbout, toolsDoc } from '@yaks/tools/vocab'
import { docs as machineDocs } from '@yaks/machine/vocab'
import { docs as fileDocs } from '@yaks/file/vocab'
import { gitDoc } from '@yaks/git/vocab'
import type { VocabDoc } from '@yaks/vocab/runtime'

/** Select definitions without changing their schemas or document metadata.
 * Every name must exist: a misspelled selection must not silently lose words. */
export let selected = (
  docs: VocabDoc[],
  names: string[] | undefined,
  plugin: string,
): VocabDoc[] => {
  if (!names) return docs
  let known = new Set(docs.flatMap((d) => Object.keys(d.$defs ?? {})))
  for (let name of names) {
    if (!known.has(name)) {
      throw new Error(`${plugin} declares no word '${name}'`)
    }
  }
  let wanted = new Set(names)
  return docs.map((d) => ({
    ...d,
    $defs: Object.fromEntries(
      Object.entries(d.$defs ?? {}).filter(([name]) => wanted.has(name)),
    ),
  })).filter((d) => Object.keys(d.$defs).length)
}

/** A graph's own component declarations replace the plugins' declarations
 * and extensions of those components. Its extensions still add to plugins. */
export let beneath = (docs: VocabDoc[], own: VocabDoc[]): VocabDoc[] => {
  let mine = new Set(
    own.flatMap((d) =>
      Object.entries(d.$defs ?? {}).filter(([, s]) =>
        s.component === true && s.extends !== true
      ).map(([name]) => name)
    ),
  )
  let replaced = new Set<string>()
  return docs.map((d) => ({
    ...d,
    $defs: Object.fromEntries(
      Object.entries(d.$defs ?? {}).filter(([name, s]) => {
        if (!mine.has(name) || s.component !== true) return true
        // A shadow cannot conceal two plugins declaring the same component.
        // The vocabulary loader checks every declaration we retain.
        if (s.extends !== true) {
          if (replaced.has(name)) {
            throw new Error(`component '${name}' is declared twice`)
          }
          replaced.add(name)
        }
        return false
      }),
    ),
  })).filter((d) => Object.keys(d.$defs).length)
}

export let docsOf = (docs: VocabDoc[]): VocabDoc[] => {
  let supplied = new Set(docs.flatMap((d) => Object.keys(d.$defs ?? {})))
  // Hosts lend machines and the files on them; their durable records and commit
  // references are host words, even when no plugin separately contributes
  // these vocabulary facets.
  let intrinsic = [...machineDocs, ...fileDocs, gitDoc].map((doc) => ({
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
