// Deno keeps separate incremental programs for workspace compiler options.
// An empty root inside each configured member gives every group a stable
// first URL without reproducing Deno's option inheritance or type resolution.
import { join } from 'node:path'

export let ANCHOR = '.typecheck-anchor.ts'

/** Members declaring compiler options, in the workspace's stable order. */
export let anchors = async (root: string): Promise<string[]> => {
  let config = JSON.parse(await Deno.readTextFile(join(root, 'deno.json')))
  let members: string[] = config.workspace ?? []
  return (await Promise.all(members.map(async (member) => {
    let path = join(root, member, 'deno.json')
    let options = JSON.parse(await Deno.readTextFile(path)).compilerOptions
    return options ? [join(member, ANCHOR)] : []
  }))).flat()
}
