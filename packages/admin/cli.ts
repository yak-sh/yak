// The terminal's account selector is an input to admin operations. This
// binding belongs to the CLI facet, independently of any tool's schema.
import type { CliFacet } from '@yaks/cli/host'
import { toolsIn } from '@yaks/vocab/tools'
import { adminDoc } from './vocab.ts'

export let globals: CliFacet['globals'] = Object.fromEntries(
  toolsIn(adminDoc).filter((t) =>
    Object.hasOwn(t.inputSchema?.properties ?? {}, 'as')
  ).map((t) => [
    t.name!,
    ['as'],
  ]),
)
