import { snapshot, type Snapshot } from './mod.ts'
/** Global first, then root-to-leaf directory guidance. Missing files are fine;
 * permission/read errors are not. No mtimes affect instruction precedence. */
export let instructionFiles = async (
  cwd: string,
  home = Deno.env.get('HOME'),
) => {
  let directory = await Deno.realPath(cwd)
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
      source = await Deno.realPath(path)
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) continue
      throw e
    }
    if (seen.has(source)) continue
    seen.add(source)
    let body = await Deno.readTextFile(source)
    out.push(await snapshot(body, source))
  }
  return out
}
