import { getPriority, homedir, setPriority } from 'node:os'

let REMOTE = 'YAK_CHECK_REMOTE'

/** Keep a local fallback from competing with the servers or with another
 * checkout's run. The kernel releases the lock even if its holder is killed.
 * The run machine admits its own jobs and CI has its own runner. */
export let localCheck = async (): Promise<Deno.FsFile | undefined> => {
  if (Deno.build.os != 'linux' || Deno.env.has(REMOTE) || Deno.env.has('CI')) {
    return
  }
  setPriority(0, Math.max(8, getPriority()))
  let dir = `${homedir()}/.cache/yak`
  await Deno.mkdir(dir, { recursive: true })
  let path = `${dir}/local-check.lock`
  let file = await Deno.open(path, {
    write: true,
    create: true,
    mode: 0o600,
  })
  try {
    let locked = file.lock(true)
    let timer: ReturnType<typeof setTimeout> | undefined
    let waited = await Promise.race([
      locked.then(() => false),
      new Promise<boolean>((done) => timer = setTimeout(done, 1_000, true)),
    ])
    clearTimeout(timer)
    if (waited) {
      // The file's own stat would wait behind its lock.
      let ino = (await Deno.stat(path)).ino
      let pid = ino == null ? undefined : holder(
        await Deno.readTextFile('/proc/locks').catch(() => ''),
        ino,
      )
      console.error(
        `local check: waiting for ${
          pid ? described(pid) : 'another run'
        } to end; this box runs one check at a time`,
      )
    }
    await locked
    return file
  } catch (error) {
    file.close()
    throw error
  }
}

/// holder('1: FLOCK  ADVISORY  WRITE 42 fc:06:7 0 EOF\n', 7) -> 42
/// holder('1: FLOCK  ADVISORY  WRITE 42 fc:06:7 0 EOF\n', 8) -> undefined
/// holder('1: FLOCK  ADVISORY  WRITE 42 fc:06:17 0 EOF\n', 7) -> undefined
/** The process holding the flock on inode `ino`, from /proc/locks. */
export let holder = (locks: string, ino: number): number | undefined => {
  for (let line of locks.split('\n')) {
    let [, kind, , , pid, at] = line.trim().split(/\s+/)
    if (kind == 'FLOCK' && at?.endsWith(`:${ino}`)) return Number(pid)
  }
}

/** A process as a person waiting on it needs it: its id, its command, and
 * the checkout it runs in. */
let described = (pid: number) => {
  let read = (f: string) => {
    try {
      return f == 'cwd'
        ? Deno.readLinkSync(`/proc/${pid}/cwd`)
        : Deno.readTextFileSync(`/proc/${pid}/${f}`)
    } catch {
      return ''
    }
  }
  let cmd = read('cmdline').split('\0').filter(Boolean).slice(-3).join(' ')
    .slice(0, 120)
  return [
    `process ${pid}`,
    cmd && `(${cmd})`,
    read('cwd') && `in ${read('cwd')}`,
  ]
    .filter(Boolean).join(' ')
}

/** Send checks to the run machine with the same comparison and source files
 * they would see here. A run there does not dispatch itself again. */
export let onRunner = async (
  task: string,
  args: string[],
  before?: (from: string) => Promise<unknown>,
): Promise<number | undefined> => {
  if (Deno.env.get('YAK_MACHINE') === '') return
  let { elsewhere } = await import('./elsewhere.ts')
  let { base } = await import('./test-changes.ts')
  let at: Promise<string> | undefined
  let from = () => at ??= base()
  let whole = args.includes('--all')
  return await elsewhere(['deno', 'task', task, ...args], {
    from,
    env: { TASKS_TEST_BASE: 'HEAD', YAK_MACHINE: '', [REMOTE]: '1' },
    before: before && (async () => before(await from())),
    limits: [
      'MemoryMax=6G',
      'MemorySwapMax=0',
      `CPUWeight=${whole ? 100 : 1000}`,
    ],
    whole,
  })
}
