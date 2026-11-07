// The sandbox runs the CLI sources yak-front serves at the apex's `/_cli/`
// (front/wrangler.toml). Each release serves a content-addressed workspace and
// a small current descriptor; changing CLI source never changes the sandbox's
// toolchain image, nor the kernel's version.
import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
import { command as spawnCommand } from '@yaks/process/command'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { members } from '@yaks/cli/dependencies'

export type Workspace = { files: Record<string, string> }
export type Release = { hash: string; url: string }

/** Runtime sources and config, without tests, credentials or build output. */
export let sources = (paths: string[], members: string[]): string[] => {
  let configs = new Set([
    'deno.json',
    'deno.lock',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    ...members.map((path) => `${path.replace(/^\.\//, '')}/package.json`),
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

/** Generate the static assets Wrangler binds to yak-front's version. */
export let assets = async (
  root = fileURLToPath(new URL('../../../', import.meta.url)),
  output = join(root, 'workers/yak/front/public/_cli'),
): Promise<Release & { files: number; bytes: number }> => {
  root = resolve(root)
  let listed = await spawnCommand('git', {
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
    members(root),
  )
  let files: Record<string, string> = {}
  for (let path of paths) {
    files[path] = await io.readTextFile(join(root, path))
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
  await io.mkdir(output, { recursive: true })
  await io.writeFile(join(output, `${hash}.json.gz`), compressed)
  await io.copyFile(
    join(root, 'workers/yak/sandbox/launch.ts'),
    join(output, 'launch.ts'),
  )
  let descriptor = join(output, `current.json.${system.pid}`)
  await io.writeTextFile(descriptor, JSON.stringify(release))
  await io.rename(descriptor, join(output, 'current.json'))
  // Only this release's workspace goes into the next asset upload.
  for await (let entry of io.readDir(output)) {
    if (
      /^[a-f0-9]{64}\.json\.gz$/.test(entry.name) &&
      entry.name != `${hash}.json.gz`
    ) {
      await io.remove(join(output, entry.name))
    }
  }
  return { ...release, files: paths.length, bytes: compressed.byteLength }
}

if (import.meta.main) {
  let started = performance.now()
  let root = system.args[0] ??
    fileURLToPath(new URL('../../../', import.meta.url))
  let output = system.args[1] ?? join(root, 'workers/yak/front/public/_cli')
  let release = await assets(root, output)
  console.log(
    `Sandbox CLI: ${release.files} files, ${release.bytes} bytes, ${
      ((performance.now() - started) / 1000).toFixed(3)
    }s (${release.hash})`,
  )
}
