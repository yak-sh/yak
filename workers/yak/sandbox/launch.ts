// The sandbox's yak launcher. The live platform supplies the same workspace
// its Worker was built from; immutable directories keep concurrent commands
// and a platform deployment from changing a running command's source files.

type Release = { hash: string; url: string }

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

/** Download once per source identity, publishing only a complete workspace. */
export let installed = async (host: string, root: string) => {
  await Deno.mkdir(root, { recursive: true })
  // A deploy between the manifest and source requests can retire that asset.
  // Read the live manifest again rather than running a stale fallback.
  for (let attempt = 0; attempt < 2; attempt++) {
    let current = await release(host)
    let path = `${root}/${current.hash}`
    try {
      await Deno.stat(`${path}/deno.json`)
      return path
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error
    }
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
      try {
        await Deno.rename(temp, path)
      } catch (error) {
        // Another command may have installed this exact workspace meanwhile.
        if (!(await Deno.stat(`${path}/deno.json`)).isFile) throw error
      }
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

if (import.meta.main) {
  try {
    let host = Deno.env.get('YAKS_HOST')?.replace(/\/$/, '')
    if (!host || new URL(host).protocol != 'https:') {
      throw new Error('yak needs the platform origin in YAKS_HOST')
    }
    let path = await installed(host, '/opt/yaks-cli')
    let code = await new Deno.Command('deno', {
      args: [
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
