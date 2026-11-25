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
  let file = await Deno.open(`${dir}/local-check.lock`, {
    write: true,
    create: true,
    mode: 0o600,
  })
  try {
    await file.lock(true)
    return file
  } catch (error) {
    file.close()
    throw error
  }
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
