// Recoverable filesystem removal at the host boundary. Each record keeps its
// original path and bytes; callers decide when data enters trash, never when
// time alone destroys it. Temporary source directories use durable trash too.
import * as fs from 'node:fs/promises'
import { constants } from 'node:fs'
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

let copy = async (from: string, to: string, mode: number) => {
  await using input = await fs.open(from, 'r')
  await using output = await fs.open(to, 'wx', mode)
  let buffer = new Uint8Array(64 * 1024)
  for (;;) {
    let { bytesRead } = await input.read(buffer)
    if (!bytesRead) break
    for (let at = 0; at < bytesRead;) {
      let { bytesWritten } = await output.write(buffer, at, bytesRead - at)
      at += bytesWritten
    }
  }
}

// Each destination is claimed by an exclusive filesystem operation. A name
// becoming occupied between attempts cannot be overwritten by restoration.
let recover = async (from: string, to: string) => {
  let info = await fs.lstat(from)
  if (info.isSymbolicLink()) await fs.symlink(await fs.readlink(from), to)
  else if (info.isDirectory()) {
    await fs.mkdir(to, { mode: info.mode })
    await fs.cp(from, to, {
      recursive: true,
      preserveTimestamps: true,
      dereference: false,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
      mode: constants.COPYFILE_EXCL,
    })
  } else await copy(from, to, info.mode)
  await fs.rm(from, { recursive: true })
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
  await fs.mkdir(dirname(to), { recursive: true })
  for (;;) {
    try {
      await recover(join(record, 'data'), to)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code != 'EEXIST') throw error
      to = `${source.path}.restored-${crypto.randomUUID()}`
    }
  }
  await fs.writeFile(
    join(record, 'restored.json'),
    JSON.stringify({ path: to }) + '\n',
    { mode: 0o600 },
  )
  return to
}
