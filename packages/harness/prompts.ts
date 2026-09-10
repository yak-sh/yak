/** Host-only admission of instruction files. Reads are snapshots, not live links. */
import type { Bundle } from '@yaks/graph'

export let promptEntry = (
  session: string,
  seq: number,
  body: string,
  source: string,
  scope = 'shared',
  revision?: string,
): Bundle => ({
  entity: { eid: crypto.randomUUID() },
  entry: { session, seq },
  prompt: { scope, source, ...revision ? { revision } : {} },
  content: { body },
})

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
  let out: { body: string; source: string; revision: string }[] = []
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
    let hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(body),
    )
    let revision = Array.from(
      new Uint8Array(hash),
      (n) => n.toString(16).padStart(2, '0'),
    ).join('')
    out.push({ body, source, revision })
  }
  return out
}
