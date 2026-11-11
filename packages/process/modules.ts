// The module graph Deno resolves from a set of roots, at the process
// boundary: `deno info`, run in a tree under that tree's own config.
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { command } from './command.ts'
import { cwd as here, execPath } from './system.ts'

/** A module graph, as `deno info --json` says one. */
export type Info = {
  modules: {
    specifier: string
    local?: string
    kind?: string
    mediaType?: string
    npmPackage?: string
    dependencies?: {
      specifier?: string
      code?: { specifier?: string }
      type?: { specifier?: string }
      isDynamic?: boolean
    }[]
  }[]
  redirects: Record<string, string>
  npmPackages?: Record<string, {
    name: string
    dependencies: string[]
    localPath: string
  }>
}

// A root as the entry imports it. A JSON module wants its attribute: without
// it Deno lists the file as an error with no local path, the same entry as
// where the graph reaches it properly, so the file drops out of the graph.
let root = (url: string) =>
  `import ${JSON.stringify(url)}${
    /\.json$/.test(new URL(url).pathname) ? " with { type: 'json' }" : ''
  }`

/** The module graph reached from `roots` (URLs) in the tree at `cwd`, a
 * dynamic import of a literal specifier included, or undefined when deno
 * cannot say. Deno resolves it by the tree's lock, and writes what it
 * resolved anew (a module's `/// <reference types>`) to a copy, so the tree
 * is never written. */
export let modules = async (
  roots: string[],
  cwd: string = here(),
): Promise<Info | undefined> => {
  let dir = await mkdtemp(`${tmpdir()}/yaks-modules-`)
  try {
    let entry = `${dir}/entry.ts`
    await writeFile(
      entry,
      roots.map(root).join('\n'),
    )
    let lock = await copyFile(`${cwd}/deno.lock`, `${dir}/deno.lock`)
      .then(() => `--lock=${dir}/deno.lock`, () => '--no-lock')
    let out = await command(execPath(), {
      args: ['info', '--json', lock, entry],
      cwd,
      stdout: 'piped',
      stderr: 'null',
    }).output()
    return out.success
      ? JSON.parse(new TextDecoder().decode(out.stdout))
      : undefined
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
