// Reuse generated assets while their complete source set and output bytes agree.
import * as io from '@yaks/file/io'
import { command as spawnCommand } from '@yaks/process/command'
import { remember } from '@yaks/cli/memo'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'
import { join } from 'node:path'
import { from, plan, ui } from './sheet-assets.ts'
import { PAGES } from './site/mod.ts'

let hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')
let stamp = async (paths: string[]) =>
  await Promise.all(
    paths.map(async (path) => [path, hash(await io.readFile(path))] as const),
  )
let agrees = async (files: readonly (readonly [string, string])[]) => {
  try {
    return (await Promise.all(
      files.map(async ([path, was]) => hash(await io.readFile(path)) == was),
    )).every(Boolean)
  } catch (error) {
    if (error instanceof io.errors.NotFound) return false
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
  let prepared = await remember(
    'worker assets',
    inputs.map((p) => pathToFileURL(p).href),
    made,
    {
      dir,
      valid: agrees,
      imports: () => Promise.resolve([]),
      files: {
        ...io,
        readTextFileSync: (path) =>
          paths.has(path) && !/\.(?:jsonc?|lock)$/.test(path)
            ? Buffer.from(io.readFileSync(path)).toString('base64')
            : io.readTextFileSync(path),
      },
    },
  )
  return prepared.map(([path]) => path)
}

/** Inputs to the browser bundles, compiler catalog and sandbox workspace. */
export let assetInputs = (paths: string[]) =>
  paths.filter((path) =>
    /^(?:packages\/|workers\/yak\/(?:public|site)\/)/.test(path) ||
    /^(?:deno\.(?:jsonc?|lock)|bin\/compiler-packages\.ts)$/.test(path) ||
    // `_talk.js` is built from operator-rows.ts and what it imports here.
    /^workers\/yak\/(?:wrangler\.ts|asset-ready\.ts|client-assets\.ts|sheet-assets\.ts|operator-(?:rows|draw|aside)\.ts|icons\.ts|sandbox\/(?:cli-assets|launch)\.ts|package(?:-lock)?\.json|deno\.json)$/
      .test(path)
  ).filter((path) =>
    !/(^|\/)(?:node_modules|\.wrangler|fixtures?|tests?)(\/|$)/.test(path) &&
    !/(?:_test|\.test|_bench|\.bench)\.[^.]+$/.test(path)
  ).sort()

let outputs = async (root: string) => {
  let publicDir = join(root, 'public')
  let cli = join(root, 'front/public')
  let { url } = JSON.parse(
    await io.readTextFile(join(cli, '_cli/current.json')),
  )
  return [
    ...['_cli/current.json', '_cli/launch.ts', url]
      .map((name) => join(cli, name)),
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
      '_compiler/toolkit.json',
      '_draft.js',
      '_outbox.js',
      '_wire.js',
      '_talk.js',
      '_client.js',
      ...(await ui()).keys(),
      ...Object.keys(PAGES),
      ...Object.values(plan(await from(publicDir)).names),
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
  let listed = await spawnCommand('git', {
    args: ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    cwd: repo,
    stdout: 'piped',
    stderr: 'null',
  }).output()
  if (!listed.success) {
    await make()
    return []
  }
  let paths = assetInputs(
    new TextDecoder().decode(listed.stdout).split('\0').filter(Boolean),
  )
  return await materialized(
    paths.map((path) => join(repo, path)),
    () => outputs(root),
    make,
    join(root, '.wrangler/asset-memo'),
  )
}
