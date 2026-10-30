// Reuse generated assets while their complete source set and output bytes agree.
import { remember } from '@yaks/cli/memo'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'
import { join } from 'node:path'

let hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')
let stamp = async (paths: string[]) =>
  await Promise.all(
    paths.map(async (path) => [path, hash(await Deno.readFile(path))] as const),
  )
let agrees = async (files: readonly (readonly [string, string])[]) => {
  try {
    return (await Promise.all(
      files.map(async ([path, was]) => hash(await Deno.readFile(path)) == was),
    )).every(Boolean)
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false
    throw error
  }
}

/** Build when sources changed or a required output was lost or edited. */
export let materialized = async (
  inputs: string[],
  outputs: () => Promise<string[]>,
  make: () => Promise<unknown>,
  dir: string,
) => {
  let paths = new Set(inputs)
  let made = async () => {
    await make()
    return await stamp(await outputs())
  }
  await remember(
    'worker assets',
    inputs.map((p) => pathToFileURL(p).href),
    made,
    {
      dir,
      valid: agrees,
      imports: () => Promise.resolve([]),
      files: {
        ...Deno,
        readTextFileSync: (path) =>
          paths.has(path) && !/\.(?:jsonc?|lock)$/.test(path)
            ? Buffer.from(Deno.readFileSync(path)).toString('base64')
            : Deno.readTextFileSync(path),
      },
    },
  )
}

/** Inputs to the browser bundles, compiler catalog and sandbox workspace. */
export let assetInputs = (paths: string[]) =>
  paths.filter((path) =>
    /^(?:packages\/|workers\/yak\/public\/)/.test(path) ||
    /^(?:deno\.(?:jsonc?|lock)|bin\/compiler-packages\.ts)$/.test(path) ||
    /^workers\/yak\/(?:wrangler\.ts|asset-ready\.ts|client-assets\.ts|sandbox\/(?:cli-assets|launch)\.ts|package(?:-lock)?\.json|deno\.json)$/
      .test(path)
  ).filter((path) =>
    !/(^|\/)(?:node_modules|\.wrangler|fixtures?|tests?)(\/|$)/.test(path) &&
    !/(?:_test|\.test|_bench|\.bench)\.[^.]+$/.test(path)
  ).sort()

let outputs = async (root: string) => {
  let publicDir = join(root, 'public')
  let { url } = JSON.parse(
    await Deno.readTextFile(join(publicDir, '_cli/current.json')),
  )
  return [
    ...[
      'app.js',
      'styles.css',
      'index.html',
      'manifest.webmanifest',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
      'apple-touch-icon.png',
    ]
      .map((name) => join(publicDir, '_web', name)),
    ...[
      '_compiler/packages.json',
      '_draft.js',
      '_outbox.js',
      '_wire.js',
      '_client.js',
      '_cli/current.json',
      '_cli/launch.ts',
      url,
    ]
      .map((name) => join(publicDir, name)),
  ]
}

/** Materialize the Worker's generated assets, reusing a validated memo. */
export let assets = async (
  repo: string,
  root: string,
  make: () => Promise<unknown>,
) => {
  let listed = await new Deno.Command('git', {
    args: ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    cwd: repo,
    stdout: 'piped',
    stderr: 'null',
  }).output()
  if (!listed.success) return await make()
  let paths = assetInputs(
    new TextDecoder().decode(listed.stdout).split('\0').filter(Boolean),
  )
  await materialized(
    paths.map((path) => join(repo, path)),
    () => outputs(root),
    make,
    join(root, '.wrangler/asset-memo'),
  )
}
