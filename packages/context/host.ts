import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
import { type Snapshot, snapshot } from './mod.ts'
/** Global first, then root-to-leaf directory guidance. Missing files are fine;
 * permission/read errors are not. No mtimes affect instruction precedence. */
export let instructionFiles = async (
  cwd: string,
  home: string | undefined = system.env.get('HOME'),
): Promise<Snapshot[]> => {
  let directory = await io.realPath(cwd)
  let paths = home ? [home + '/.agents/AGENTS.md'] : []
  let ancestors: string[] = []
  for (;;) {
    ancestors.unshift(
      directory == '/' ? '/AGENTS.md' : directory + '/AGENTS.md',
    )
    if (directory == '/') break
    directory = directory.slice(0, directory.lastIndexOf('/')) || '/'
  }
  paths.push(...ancestors)
  let seen = new Set<string>()
  let out: Snapshot[] = []
  for (let path of paths) {
    let source: string
    try {
      source = await io.realPath(path)
    } catch (e) {
      if (io.isNotFound(e)) continue
      throw e
    }
    if (seen.has(source)) continue
    seen.add(source)
    let body = await io.readTextFile(source)
    out.push(await snapshot(body, source))
  }
  return out
}
