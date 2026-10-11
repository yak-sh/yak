// The sandbox's yak launcher. The live platform supplies the same workspace
// its Worker was built from; immutable directories keep concurrent commands
// and a platform deployment from changing a running command's source files.
// This launcher has no dependencies: Deno can fetch it before any workspace
// or npm cache exists.

type Release = { hash: string; url: string }

// Never unlink this file: all callers must lock the same inode. The kernel
// releases a killed installer's lock, so no stale PID or timeout can block a
// later command (or mistake a slow, live installation for a dead one).
let locked = async <T>(root: string, work: () => Promise<T>) => {
  await Deno.mkdir(root, { recursive: true })
  using file = await Deno.open(`${root}/.lock`, {
    create: true,
    write: true,
  })
  await file.lock(true)
  try {
    return await work()
  } finally {
    await file.unlock()
  }
}

let exists = async (path: string) => {
  try {
    return (await Deno.stat(path)).isFile
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
    return false
  }
}

let release = async (host: string): Promise<Release> => {
  let response = await fetch(`${host}/_cli/current.json`)
  if (!response.ok) throw new Error(`yak workspace: HTTP ${response.status}`)
  let value = await response.json()
  if (
    !/^[a-f0-9]{64}$/.test(value.hash) ||
    value.url != `/_cli/${value.hash}.json.gz`
  ) throw new Error('yak workspace: invalid release')
  return value
}

// Keep older workspaces until the container is destroyed: another command may
// still need their dynamic imports after this call installs a newer release.
/** Download once per source identity, publishing only a complete workspace. */
export let installed = (host: string, root: string) =>
  locked(root, () => workspace(host, root))

let workspace = async (host: string, root: string) => {
  // Only the lock holder can own staging here. A killed downloader can leave
  // a partial directory, which must not accumulate across retries.
  for await (let entry of Deno.readDir(root)) {
    if (entry.isDirectory && entry.name.startsWith('.install-')) {
      await Deno.remove(`${root}/${entry.name}`, { recursive: true })
    }
  }
  // A deploy between the manifest and source requests can retire that asset.
  // Read the live manifest again rather than running a stale fallback.
  for (let attempt = 0; attempt < 2; attempt++) {
    let current = await release(host)
    let path = `${root}/${current.hash}`
    if (await exists(`${path}/deno.json`)) return path
    let response = await fetch(`${host}${current.url}`)
    if (response.status == 404 && attempt == 0) continue
    if (!response.ok || !response.body) {
      throw new Error(`yak workspace: HTTP ${response.status}`)
    }
    let body = await new Response(
      response.body.pipeThrough(new DecompressionStream('gzip')),
    ).text()
    let bytes = new TextEncoder().encode(body)
    let sum = await crypto.subtle.digest('SHA-256', bytes)
    let hash = [...new Uint8Array(sum)]
      .map((b) => b.toString(16).padStart(2, '0')).join('')
    if (hash != current.hash) {
      throw new Error('yak workspace: checksum mismatch')
    }
    let files = (JSON.parse(body) as { files: Record<string, string> }).files
    let temp = await Deno.makeTempDir({ dir: root, prefix: '.install-' })
    try {
      for (let [name, content] of Object.entries(files)) {
        if (name.startsWith('/') || name.split('/').includes('..')) {
          throw new Error('yak workspace: invalid path')
        }
        let file = `${temp}/${name}`
        await Deno.mkdir(file.slice(0, file.lastIndexOf('/')), {
          recursive: true,
        })
        await Deno.writeTextFile(file, content)
      }
      await Deno.rename(temp, path)
      return path
    } finally {
      // Cleanup must not hide a failed download or publication.
      try {
        await Deno.remove(temp, { recursive: true })
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) console.error(error)
      }
    }
  }
  throw new Error('yak workspace changed during download; retry the command')
}

let args = (path: string) => [
  'run',
  '--quiet',
  // Keep the lockfile without prefetching unrelated workspace packages.
  '--unstable-npm-lazy-caching',
  '--allow-net',
  '--allow-env',
  '--allow-read',
  '--allow-write',
  '--config',
  `${path}/deno.json`,
]

type Cache = {
  lock: typeof locked
  has: typeof exists
  fill: (path: string) => Promise<void>
  mark: (path: string) => Promise<void>
}

/** Fill the CLI's runtime cache once per workspace, publishing only success.
 * This runs in the configured child itself: killing its parent cannot drop
 * the lock while that child's module downloads are still running. */
export let warmed = (
  path: string,
  root: string,
  cache: Cache = {
    lock: locked,
    has: exists,
    fill: async (path) => {
      let { main } = await import(`file://${path}/packages/cli/yak.ts`)
      if (await main(['--help'])) {
        throw new Error('yak workspace: warm-up failed')
      }
    },
    mark: (path) => Deno.writeTextFile(path, ''),
  },
) =>
  cache.lock(root, async () => {
    let marker = `${path}.ready`
    if (await cache.has(marker)) return
    await cache.fill(path)
    await cache.mark(marker)
  })

if (import.meta.main) {
  try {
    if (Deno.args[0] == '--warm-workspace') {
      await warmed(Deno.args[1], Deno.args[2])
      Deno.exit(0)
    }
    let host = Deno.env.get('YAKS_HOST')?.replace(/\/$/, '')
    if (!host || new URL(host).protocol != 'https:') {
      throw new Error('yak needs the platform origin in YAKS_HOST')
    }
    let path = await installed(host, '/opt/yaks-cli')
    if (!await exists(`${path}.ready`)) {
      let warm = await new Deno.Command('deno', {
        args: [
          ...args(path),
          import.meta.url,
          '--warm-workspace',
          path,
          '/opt/yaks-cli',
        ],
        stdin: 'null',
        stdout: 'null',
        stderr: 'inherit',
      }).spawn().status
      if (!warm.success) Deno.exit(warm.code)
    }
    let code = await new Deno.Command('deno', {
      args: [
        ...args(path),
        `${path}/packages/cli/yak.ts`,
        ...Deno.args,
      ],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn().status
    Deno.exit(code.code)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    Deno.exit(1)
  }
}
