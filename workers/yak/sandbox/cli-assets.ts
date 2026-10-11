// The sandbox runs the CLI sources carried by the Worker it talks to. Each
// release serves a content-addressed workspace and a small current descriptor;
// changing CLI source never changes the sandbox's toolchain image.
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Workspace = { files: Record<string, string> }
export type Release = { hash: string; url: string }

/** Runtime sources and config, without tests, credentials or build output. */
export let sources = (paths: string[], members: string[]): string[] => {
  let configs = new Set([
    'deno.json',
    'deno.lock',
    ...members.map((path) => `${path.replace(/^\.\//, '')}/deno.json`),
  ])
  return paths.filter((path) => {
    if (configs.has(path)) return true
    return path.startsWith('packages/') &&
      !/(^|\/)(?:\.[^/]+|node_modules|fixtures?|tests?)(\/|$)/.test(path) &&
      !/(?:_test|\.test|_bench|\.bench|\.gen|\.example)\.[^.]+$/.test(path) &&
      !/(^|\/)conform\.ts$/.test(path) &&
      /\.(?:[cm]?[jt]sx?|jsonc?|css|html|py|sh|service)$/.test(path)
  }).sort()
}

/** Stable bytes give equal workspaces the same URL across unrelated commits. */
export let serialized = (files: Record<string, string>): string =>
  JSON.stringify({
    files: Object.fromEntries(
      Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    ),
  })

/** Generate the static assets Wrangler binds to this Worker version. */
export let assets = async (
  root = fileURLToPath(new URL('../../../', import.meta.url)),
  output = join(root, 'workers/yak/public/_cli'),
): Promise<Release & { files: number; bytes: number }> => {
  root = resolve(root)
  let { workspace = [] } = JSON.parse(
    await Deno.readTextFile(join(root, 'deno.json')),
  ) as { workspace?: string[] }
  let listed = await new Deno.Command('git', {
    args: ['ls-files', '-z'],
    cwd: root,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!listed.success) {
    throw new Error(new TextDecoder().decode(listed.stderr))
  }
  let paths = sources(
    new TextDecoder().decode(listed.stdout).split('\0').filter(Boolean),
    workspace,
  )
  let files: Record<string, string> = {}
  for (let path of paths) {
    files[path] = await Deno.readTextFile(join(root, path))
  }
  let body = new TextEncoder().encode(serialized(files))
  let hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
  let compressed = new Uint8Array(
    await new Response(
      new Blob([body]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  )
  let release = { hash, url: `/_cli/${hash}.json.gz` }
  await Deno.mkdir(output, { recursive: true })
  await Deno.writeFile(join(output, `${hash}.json.gz`), compressed)
  await Deno.copyFile(
    join(root, 'workers/yak/sandbox/launch.ts'),
    join(output, 'launch.ts'),
  )
  let descriptor = join(output, `current.json.${Deno.pid}`)
  await Deno.writeTextFile(descriptor, JSON.stringify(release))
  await Deno.rename(descriptor, join(output, 'current.json'))
  // Only this release's workspace goes into the next asset upload.
  for await (let entry of Deno.readDir(output)) {
    if (
      /^[a-f0-9]{64}\.json\.gz$/.test(entry.name) &&
      entry.name != `${hash}.json.gz`
    ) {
      await Deno.remove(join(output, entry.name))
    }
  }
  return { ...release, files: paths.length, bytes: compressed.byteLength }
}

if (import.meta.main) {
  let started = performance.now()
  let root = Deno.args[0] ??
    fileURLToPath(new URL('../../../', import.meta.url))
  let output = Deno.args[1] ?? join(root, 'workers/yak/public/_cli')
  let release = await assets(root, output)
  console.log(
    `Sandbox CLI: ${release.files} files, ${release.bytes} bytes, ${
      ((performance.now() - started) / 1000).toFixed(3)
    }s (${release.hash})`,
  )
}
