#!/usr/bin/env -S deno run -A
// Each executor release keeps its Worker and Workflow names. A changed bundle
// gets another release, leaving accepted calls on the Worker that accepted them.
import { aliased, dir as dependencies, WRANGLER } from '../yak/wrangler.ts'
import { installed } from '../yak/dependencies.ts'
import { fileURLToPath } from 'node:url'
import { parse } from '@std/toml'

export let root = fileURLToPath(new URL('./', import.meta.url)).replace(
  /\/$/,
  '',
)

export let ready = async () => {
  await installed(dependencies)
  aliased(undefined, `${root}/.wrangler/paths.json`)
}

let execute = (args: string[], piped = false) =>
  new Deno.Command(WRANGLER[0], {
    args: [...WRANGLER.slice(1), ...args],
    cwd: root,
    stdin: piped ? 'null' : 'inherit',
    stdout: piped ? 'piped' : 'inherit',
    stderr: piped ? 'piped' : 'inherit',
  })

let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// A bundle includes every generated module and the bindings that give it its
// authority. Hashing both keeps a config-only change from replacing a release.
export let fingerprint = async (directory: string): Promise<string> => {
  let files: string[] = []
  let walk = async (at: string) => {
    for await (let entry of Deno.readDir(`${directory}/${at}`)) {
      let file = at ? `${at}/${entry.name}` : entry.name
      if (entry.isDirectory) await walk(file)
      else if (entry.isFile) files.push(file)
    }
  }
  await walk('')
  let chunks: Uint8Array[] = []
  let encoder = new TextEncoder()
  for (let file of files.sort()) {
    let bytes = await Deno.readFile(`${directory}/${file}`)
    chunks.push(encoder.encode(`${file}\0${bytes.length}\0`), bytes)
  }
  chunks.push(
    encoder.encode(JSON.stringify(WRANGLER)),
    await Deno.readFile(`${root}/wrangler.toml`),
  )
  let bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0))
  let offset = 0
  for (let chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** An existing release can be reused, but its published code stays frozen. */
export let reusable = (
  hash: string,
  versions: { annotations?: Record<string, string> }[],
): boolean => {
  if (!versions.length) return false
  let hashes = versions.map((version) =>
    version.annotations?.['workers/message']?.match(
      /model-bundle:([a-f\d]{64})/,
    )
      ?.[1]
  )
  if (hashes.every((published) => published === hash)) return true
  throw Error(
    'executor release is published; give the changed Worker and Workflow another release name and retain this release for accepted calls',
  )
}

let published = async () => {
  let result = await execute(['versions', 'list', '--json'], true).output()
  if (result.success) return JSON.parse(decode(result.stdout))
  let reason = decode(result.stderr)
  if (/\[code: 10007\]/.test(reason)) return []
  throw Error(`cannot inspect executor release: ${reason}`)
}

/** An immutable release must be activated with the host it needs to run. */
export let activated = (config: { services?: unknown }): void => {
  let services = config.services
  if (
    !Array.isArray(services) ||
    !services.some((service) =>
      service?.binding === 'KERNEL' && service?.service === 'yak' &&
      service?.entrypoint === 'ModelHost'
    )
  ) {
    throw Error(
      'executor deployment needs the KERNEL service binding to yak/ModelHost; complete kernel integration before publishing this immutable release',
    )
  }
}

export let run = async (args: string[]): Promise<number> => {
  await ready()
  if (args[0] !== 'deploy' || args.includes('--dry-run')) {
    return (await execute(args).spawn().status).code
  }
  // Deploy settings belong to this release's config. Passing another config
  // or name would make the frozen-release check inspect a different Worker.
  if (args.length !== 1) {
    throw Error('deploy takes no overrides; edit the release config')
  }
  activated(parse(await Deno.readTextFile(`${root}/wrangler.toml`)))
  let scratch = await Deno.makeTempDir({ prefix: 'model-bundle-' })
  try {
    let bundled = await execute(['deploy', '--dry-run', '--outdir', scratch])
      .spawn().status
    if (!bundled.success) return bundled.code
    let hash = await fingerprint(scratch)
    if (reusable(hash, await published())) {
      console.log('executor release unchanged; retaining its serving version')
      return 0
    }
    let commit = await new Deno.Command('git', {
      args: ['log', '-1', '--format=%H %s'],
      cwd: root,
      stdout: 'piped',
      stderr: 'inherit',
    }).output()
    if (!commit.success) throw Error('cannot identify executor commit')
    return (await execute([
      'deploy',
      '--message',
      `${decode(commit.stdout).trim()}\nmodel-bundle:${hash}`,
    ]).spawn().status).code
  } finally {
    await Deno.remove(scratch, { recursive: true })
  }
}

if (import.meta.main) Deno.exit(await run(Deno.args))
