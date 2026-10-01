// Local-only snapshot boundary, loaded lazily by the portable attachment.
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Refused } from '@yaks/graph'
let execute = promisify(execFile)
let safe = (path: string): boolean =>
  !/[\\:]/.test(path) &&
  [...path].every((char) =>
    char.charCodeAt(0) >= 32 && char.charCodeAt(0) != 127
  ) &&
  path.split('/').every((part) => part && part != '.' && part != '..')
let plain = async (path: string): Promise<Stats | undefined> => {
  try {
    let stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      throw new Refused(`Skill snapshot refuses symlink ${path}`)
    }
    return stat
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (error as NodeJS.ErrnoException).code != 'ENOENT'
    ) throw error
    return undefined
  }
}

export let localFiles = async (
  cwd: string,
): Promise<{ scope: string; files: Map<string, Uint8Array> }> => {
  // Complete filesystem overlay, including binary and nested supporting files.
  let root: string
  try {
    let { stdout } = await execute('git', ['rev-parse', '--show-toplevel'], {
      cwd,
    })
    root = await realpath(stdout.trim())
  } catch (error) {
    if (
      error instanceof Error && 'code' in error && typeof error.code == 'number'
    ) {
      return { scope: cwd, files: new Map() }
    }
    throw error
  }
  let files = new Map<string, Uint8Array>()
  if (!(await plain(`${root}/.claude`))?.isDirectory()) {
    return { scope: root, files }
  }
  if (!(await plain(`${root}/.claude/skills`))?.isDirectory()) {
    return { scope: root, files }
  }
  let walk = async (relative: string): Promise<void> => {
    for await (
      let entry of await readdir(`${root}/${relative}`, { withFileTypes: true })
    ) {
      let path = `${relative}/${entry.name}`
      if (!safe(path)) {
        throw new Refused(`Skill snapshot refuses unsafe path ${path}`)
      }
      let stat = await plain(`${root}/${path}`)
      if (!stat) {
        throw new Refused(`Skill snapshot changed while reading ${path}`)
      }
      if (stat.isDirectory()) await walk(path)
      else if (stat.isFile()) {
        if (stat.size > 16 * 1024 * 1024) {
          throw new Refused(`Skill resource exceeds 16 MiB: ${path}`)
        }
        files.set(path, await readFile(`${root}/${path}`))
      } else {throw new Refused(
          `Skill snapshot refuses non-regular file ${path}`,
        )}
    }
  }
  await walk('.claude/skills')
  return { scope: root, files }
}
