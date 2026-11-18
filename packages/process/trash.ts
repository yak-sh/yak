// Recoverable filesystem removal at the host boundary. Each record keeps its
// original path and bytes; callers decide when data enters trash, never when
// time alone destroys it. Temporary source directories use durable trash too.
import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

let missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code == 'ENOENT'

let transfer = async (from: string, to: string) => {
  try {
    await fs.rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code != 'EXDEV') throw error
    await fs.cp(from, to, {
      recursive: true,
      preserveTimestamps: true,
      dereference: false,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
    })
    await fs.rm(from, { recursive: true })
  }
}

/** Move a file or directory into private trash. Missing sources do nothing.
 * `root` defaults to `~/.yak/trash/files`; a persistent store can keep its own
 * trash beside its data. The returned record holds `source.json` and `data`. */
export let trash = async (
  path: string,
  root: string = join(homedir(), '.yak/trash/files'),
): Promise<string | undefined> => {
  path = resolve(path)
  try {
    await fs.lstat(path)
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
  let record = join(root, crypto.randomUUID())
  await fs.mkdir(record, { recursive: true, mode: 0o700 })
  await fs.writeFile(
    join(record, 'source.json'),
    JSON.stringify({ path, at: Date.now() }) + '\n',
    { mode: 0o600, flag: 'wx' },
  )
  let to = join(record, 'data')
  try {
    await transfer(path, to)
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
  return record
}

/** Restore a record, retaining a free name when its original path is taken.
 * The answer is the restored path, so a caller can say where it went. */
export let restore = async (record: string): Promise<string> => {
  let source = JSON.parse(
    await fs.readFile(join(record, 'source.json'), 'utf8'),
  ) as { path: string }
  let to = source.path
  try {
    await fs.lstat(to)
    to += `.restored-${crypto.randomUUID()}`
  } catch (error) {
    if (!missing(error)) throw error
  }
  await fs.mkdir(dirname(to), { recursive: true })
  await transfer(join(record, 'data'), to)
  await fs.writeFile(
    join(record, 'restored.json'),
    JSON.stringify({ path: to }) + '\n',
    { mode: 0o600 },
  )
  return to
}
