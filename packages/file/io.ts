/** The host filesystem, shared by packages without exposing its runtime. */
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
export { homedir } from 'node:os'
import { join, sep } from 'node:path'
import process from 'node:process'
export {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
export { fileURLToPath, pathToFileURL } from 'node:url'

export type Path = string | URL
export type MkdirOptions = { recursive?: boolean; mode?: number }
export type WriteFileOptions = {
  append?: boolean
  create?: boolean
  createNew?: boolean
  mode?: number
  signal?: AbortSignal
}
export type OpenOptions = {
  read?: boolean
  write?: boolean
  append?: boolean
  truncate?: boolean
  create?: boolean
  createNew?: boolean
  mode?: number
}
export type DirEntry = {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
}
export type FileInfo =
  & Pick<
    fs.Stats,
    | 'dev'
    | 'ino'
    | 'mode'
    | 'nlink'
    | 'uid'
    | 'gid'
    | 'rdev'
    | 'size'
    | 'blksize'
    | 'blocks'
    | 'atime'
    | 'mtime'
    | 'ctime'
    | 'birthtime'
  >
  & {
    isFile: boolean
    isDirectory: boolean
    isSymlink: boolean
  }

type Failure = {
  new (message?: string): Error
  [Symbol.hasInstance]: (error: unknown) => boolean
}
let fault = (name: string, codes: string[]): Failure =>
  class extends Error {
    constructor(message?: string) {
      super(message)
      this.name = name
    }
    static override [Symbol.hasInstance](error: unknown): boolean {
      let e = error as { code?: string; name?: string } | undefined
      return !!e && (codes.includes(e.code ?? '') || e.name == name)
    }
  }
export let errors: Record<
  'NotFound' | 'NotADirectory' | 'AlreadyExists' | 'PermissionDenied',
  Failure
> = {
  NotFound: fault('NotFound', ['ENOENT', 'ESRCH']),
  NotADirectory: fault('NotADirectory', ['ENOTDIR']),
  AlreadyExists: fault('AlreadyExists', ['EEXIST']),
  PermissionDenied: fault('PermissionDenied', ['EACCES', 'EPERM']),
}
export let isNotADirectory = (error: unknown): boolean =>
  error instanceof errors.NotADirectory
export let isNotFound = (error: unknown): boolean =>
  error instanceof errors.NotFound
export let isAlreadyExists = (error: unknown): boolean =>
  error instanceof errors.AlreadyExists
export let isPermissionDenied = (error: unknown): boolean =>
  error instanceof errors.PermissionDenied

let readers = new Set<(path: Path) => void>()
/** Observe filesystem inputs read by this process; returns an unsubscribe. */
export let watchReads = (read: (path: Path) => void): () => void => {
  readers.add(read)
  return () => {
    readers.delete(read)
  }
}
let reading = <T extends Path>(path: T): T => {
  for (let read of readers) read(path)
  return path
}
let info = (s: fs.Stats): FileInfo => ({
  ...s,
  atime: s.atime,
  mtime: s.mtime,
  ctime: s.ctime,
  birthtime: s.birthtime,
  isFile: s.isFile(),
  isDirectory: s.isDirectory(),
  isSymlink: s.isSymbolicLink(),
})
let entry = (e: fs.Dirent): DirEntry => ({
  name: e.name,
  isFile: e.isFile(),
  isDirectory: e.isDirectory(),
  isSymlink: e.isSymbolicLink(),
})
let flags = (o: OpenOptions = {}): number =>
  (o.read && (o.write || o.append)
    ? fs.constants.O_RDWR
    : o.write || o.append
    ? fs.constants.O_WRONLY
    : fs.constants.O_RDONLY) |
  (o.create || o.createNew ? fs.constants.O_CREAT : 0) |
  (o.createNew ? fs.constants.O_EXCL : 0) |
  (o.truncate ? fs.constants.O_TRUNC : 0) |
  (o.append ? fs.constants.O_APPEND : 0)
let writing = (o: WriteFileOptions = {}): OpenOptions => ({
  ...o,
  write: true,
  create: o.create !== false,
  truncate: !o.append,
})

export let readTextFile = (path: Path): Promise<string> =>
  fsp.readFile(reading(path), 'utf8')
export let readTextFileSync = (path: Path): string =>
  fs.readFileSync(reading(path), 'utf8')
export let readFile = async (path: Path): Promise<Uint8Array> =>
  new Uint8Array(await fsp.readFile(reading(path)))
export let readFileSync = (path: Path): Uint8Array =>
  new Uint8Array(fs.readFileSync(reading(path)))
export let writeTextFile = async (
  path: Path,
  data: string,
  o: WriteFileOptions = {},
): Promise<void> => {
  await fsp.writeFile(path, data, {
    flag: flags(writing(o)),
    mode: o.mode,
    signal: o.signal,
  })
}
export let writeTextFileSync = (
  path: Path,
  data: string,
  o: WriteFileOptions = {},
): void => {
  let fd = fs.openSync(path, flags(writing(o)), o.mode)
  try {
    fs.writeFileSync(fd, data)
  } finally {
    fs.closeSync(fd)
  }
}
export let writeFile = async (
  path: Path,
  data: Uint8Array,
  o: WriteFileOptions = {},
): Promise<void> => {
  await fsp.writeFile(path, data, {
    flag: flags(writing(o)),
    mode: o.mode,
    signal: o.signal,
  })
}
export let writeFileSync = (
  path: Path,
  data: Uint8Array,
  o: WriteFileOptions = {},
): void => {
  let fd = fs.openSync(path, flags(writing(o)), o.mode)
  try {
    fs.writeFileSync(fd, data)
  } finally {
    fs.closeSync(fd)
  }
}
export let mkdir = async (path: Path, o: MkdirOptions = {}): Promise<void> => {
  await fsp.mkdir(path, o)
}
export let mkdirSync = (path: Path, o: MkdirOptions = {}): void => {
  fs.mkdirSync(path, o)
}
export let remove = async (
  path: Path,
  o: { recursive?: boolean } = {},
): Promise<void> => {
  if (o.recursive) await fsp.rm(path, { recursive: true })
  else if ((await fsp.lstat(path)).isDirectory()) await fsp.rmdir(path)
  else await fsp.unlink(path)
}
export let removeSync = (path: Path, o: { recursive?: boolean } = {}): void => {
  if (o.recursive) fs.rmSync(path, { recursive: true })
  else if (fs.lstatSync(path).isDirectory()) fs.rmdirSync(path)
  else fs.unlinkSync(path)
}
export let stat = async (path: Path): Promise<FileInfo> =>
  info(await fsp.stat(reading(path)))
export let statSync = (path: Path): FileInfo => info(fs.statSync(reading(path)))
export let lstat = async (path: Path): Promise<FileInfo> =>
  info(await fsp.lstat(reading(path)))
export let lstatSync = (path: Path): FileInfo =>
  info(fs.lstatSync(reading(path)))
export let readDir = async function* (path: Path): AsyncGenerator<DirEntry> {
  for (let e of await fsp.readdir(reading(path), { withFileTypes: true })) {
    yield entry(e)
  }
}
export let readDirSync = (path: Path): Iterable<DirEntry> =>
  fs.readdirSync(reading(path), { withFileTypes: true }).map(entry)
/** The bytes of the filesystem holding a path: its size, those in use, and
 * those free to a writer without privilege. */
export type Space = { size: number; used: number; free: number }
export let space = async (path: Path): Promise<Space> => {
  let { bsize, blocks, bfree, bavail } = await fsp.statfs(reading(path))
  return {
    size: blocks * bsize,
    used: (blocks - bfree) * bsize,
    free: bavail * bsize,
  }
}
export let realPath = (path: Path): Promise<string> =>
  fsp.realpath(reading(path))
export let realPathSync = (path: Path): string => fs.realpathSync(reading(path))
export let readLink = (path: Path): Promise<string> =>
  fsp.readlink(reading(path))
export let readLinkSync = (path: Path): string => fs.readlinkSync(reading(path))
export let rename: typeof fsp.rename = fsp.rename
export let renameSync: typeof fs.renameSync = fs.renameSync
export let copyFile = (from: Path, to: Path): Promise<void> =>
  fsp.copyFile(reading(from), to)
export let copyFileSync = (from: Path, to: Path): void =>
  fs.copyFileSync(reading(from), to)
export let chmod: typeof fsp.chmod = fsp.chmod
export let chmodSync: typeof fs.chmodSync = fs.chmodSync
export let utime: typeof fsp.utimes = fsp.utimes
export let utimeSync: typeof fs.utimesSync = fs.utimesSync
export let link: typeof fsp.link = fsp.link
export let linkSync: typeof fs.linkSync = fs.linkSync
export let symlink = (
  target: Path,
  path: Path,
  options: { type?: 'file' | 'dir' | 'junction' } = {},
): Promise<void> => fsp.symlink(target, path, options.type)
export let symlinkSync = (
  target: Path,
  path: Path,
  options: { type?: 'file' | 'dir' | 'junction' } = {},
): void => fs.symlinkSync(target, path, options.type)
export let makeTempDir = (
  o: { dir?: string; prefix?: string; suffix?: string } = {},
): Promise<string> =>
  fsp.mkdtemp(join(o.dir ?? tmpdir(), o.prefix ?? '') + (o.prefix ? '' : sep))
    .then(async (path) => {
      if (!o.suffix) return path
      await fsp.rename(path, path + o.suffix)
      return path + o.suffix
    })
export let makeTempDirSync = (
  o: { dir?: string; prefix?: string; suffix?: string } = {},
): string => {
  let path = fs.mkdtempSync(
    join(o.dir ?? tmpdir(), o.prefix ?? '') + (o.prefix ? '' : sep),
  )
  if (!o.suffix) return path
  fs.renameSync(path, path + o.suffix)
  return path + o.suffix
}

export let makeTempFile = async (
  o: { dir?: string; prefix?: string; suffix?: string } = {},
): Promise<string> => {
  let path = join(
    o.dir ?? tmpdir(),
    (o.prefix ?? '') + crypto.randomUUID() + (o.suffix ?? ''),
  )
  await fsp.writeFile(path, '', { flag: 'wx', mode: 0o600 })
  return path
}
export let makeTempFileSync = (
  o: { dir?: string; prefix?: string; suffix?: string } = {},
): string => {
  let path = join(
    o.dir ?? tmpdir(),
    (o.prefix ?? '') + crypto.randomUUID() + (o.suffix ?? ''),
  )
  fs.writeFileSync(path, '', { flag: 'wx', mode: 0o600 })
  return path
}

export let SeekMode: {
  readonly Start: 0
  readonly Current: 1
  readonly End: 2
} = { Start: 0, Current: 1, End: 2 }
let call = <T>(
  fn: (done: (error: NodeJS.ErrnoException | null, result: T) => void) => void,
): Promise<T> =>
  new Promise((resolve, reject) =>
    fn((error, result) => error ? reject(error) : resolve(result))
  )

/** An open file. Closing releases its descriptor and any lock it holds. */
export type FsFile = {
  readonly fd: number
  read: (buffer: Uint8Array) => Promise<number | null>
  readSync: (buffer: Uint8Array) => number | null
  write: (buffer: Uint8Array) => Promise<number>
  writeSync: (buffer: Uint8Array) => number
  seek: (offset: number, mode: number) => Promise<number>
  seekSync: (offset: number, mode: number) => number
  stat: () => Promise<FileInfo>
  statSync: () => FileInfo
  truncate: (size?: number) => Promise<void>
  truncateSync: (size?: number) => void
  sync: () => Promise<void>
  syncSync: () => void
  lock: (exclusive?: boolean) => Promise<void>
  tryLock: (exclusive?: boolean) => Promise<boolean>
  tryLockSync: (exclusive?: boolean) => boolean
  unlock: () => Promise<void>
  close: () => void
  [Symbol.dispose]: () => void
}

// Contenders have unique names, so recovery removes only a dead descriptor's
// claim, never a subsequent holder. The directory stays across acquisitions.
let locking = (fd: number) => {
  let { dev, ino } = fs.fstatSync(fd)
  let at = join(
    tmpdir(),
    `yaks-file-locks-${process.getuid?.() ?? 'user'}`,
    `${dev}.${ino}`,
  )
  let key = `${process.pid}.${crypto.randomUUID()}`
  let token = ''
  let own = ''
  let exclusiveHeld = false
  let held = false
  let unlock = () => {
    if (!held) return
    fs.unlinkSync(own)
    held = false
  }
  let tryLock = (exclusive = false) => {
    if (held && exclusiveHeld == exclusive) return true
    unlock()
    token = `${key}.${exclusive ? 'write' : 'read'}`
    own = join(at, token)
    exclusiveHeld = exclusive
    fs.mkdirSync(at, { recursive: true, mode: 0o700 })
    fs.closeSync(fs.openSync(own, 'wx', 0o600))
    try {
      for (let name of fs.readdirSync(at)) {
        if (name == token) continue
        let pid = Number(name.split('.')[0])
        if (!pid) throw new Error(`invalid file lock: ${join(at, name)}`)
        try {
          process.kill(pid, 0)
          if (exclusive || name.endsWith('.write')) return false
          continue
        } catch (e) {
          if (!isNotFound(e)) throw e
        }
        try {
          fs.unlinkSync(join(at, name))
        } catch (e) {
          if (!isNotFound(e)) throw e
        }
      }
      return held = true
    } finally {
      if (!held) fs.unlinkSync(own)
    }
  }
  return { tryLock, unlock }
}

let opened = (fd: number): FsFile => {
  let position = 0
  let closed = false
  let locks: ReturnType<typeof locking> | undefined
  let tryLock = (exclusive = false) => {
    if (closed) throw new Error('file is closed')
    return (locks ??= locking(fd)).tryLock(exclusive)
  }
  let seek = (offset: number, mode: number) => {
    position = offset +
      (mode == SeekMode.Current
        ? position
        : mode == SeekMode.End
        ? fs.fstatSync(fd).size
        : 0)
    if (position < 0) throw new RangeError('negative seek position')
    return position
  }
  let close = () => {
    if (closed) return
    try {
      locks?.unlock()
    } finally {
      fs.closeSync(fd)
      closed = true
    }
  }
  return {
    fd,
    read: async (buffer) => {
      let n = await call<number>((done) =>
        fs.read(fd, buffer, 0, buffer.length, position, done)
      )
      position += n
      return n || (buffer.length ? null : 0)
    },
    readSync: (buffer) => {
      let n = fs.readSync(fd, buffer, 0, buffer.length, position)
      position += n
      return n || (buffer.length ? null : 0)
    },
    write: async (buffer) => {
      let n = await call<number>((done) =>
        fs.write(fd, buffer, 0, buffer.length, position, done)
      )
      position += n
      return n
    },
    writeSync: (buffer) => {
      let n = fs.writeSync(fd, buffer, 0, buffer.length, position)
      position += n
      return n
    },
    seek: (offset, mode) => Promise.resolve(seek(offset, mode)),
    seekSync: seek,
    stat: async () => info(await call<fs.Stats>((done) => fs.fstat(fd, done))),
    statSync: () => info(fs.fstatSync(fd)),
    truncate: (size = 0) => call<void>((done) => fs.ftruncate(fd, size, done)),
    truncateSync: (size = 0) => fs.ftruncateSync(fd, size),
    sync: () => call<void>((done) => fs.fsync(fd, done)),
    syncSync: () => fs.fsyncSync(fd),
    lock: async (exclusive = false) => {
      while (!tryLock(exclusive)) {
        await new Promise((resolve) =>
          setTimeout(resolve, 5 + Math.random() * 10)
        )
      }
    },
    tryLock: (exclusive) => Promise.resolve(tryLock(exclusive)),
    tryLockSync: tryLock,
    unlock: () => {
      locks?.unlock()
      return Promise.resolve()
    },
    close,
    [Symbol.dispose]: close,
  }
}
export let open = async (path: Path, o: OpenOptions = {}): Promise<FsFile> =>
  opened(
    await call<number>((done) =>
      fs.open(reading(path), flags(o), o.mode, done)
    ),
  )
export let openSync = (path: Path, o: OpenOptions = {}): FsFile =>
  opened(fs.openSync(reading(path), flags(o), o.mode))
