// Reuse generated assets while their complete source set and output bytes agree.
import * as io from '@yaks/file/io'
import { command as spawnCommand } from '@yaks/process/command'
import { remember } from '@yaks/cli/memo'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'
import { join, relative } from 'node:path'
import { type Read, sources } from '@yaks/esbuild'
import { strip } from '@yaks/esbuild/strip'
import { chunksOf, made, reading } from '@yaks/web/assets'
import { ASSETS, drawn, planned } from './assets.ts'

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

/** The files bundles read from `entries`, by path: each entry's module graph
 * as esbuild resolves it (@yaks/esbuild `sources`), packages named on the way
 * left unread. */
export let reached = async (read: Read, entries: string[]) =>
  (await Promise.all(entries.map((entry) => sources(strip)(read, entry))))
    .flatMap(({ files }) => [...files.keys()])

/** What the site's bundles read (assets.ts `ASSETS`), by path in `repo`. */
let bundled = (repo: string) =>
  reached(
    (path) =>
      io.readFile(join(repo, path)).then((bytes) => new Uint8Array(bytes))
        .catch((error) => {
          if (error instanceof io.errors.NotFound) return null
          throw error
        }),
    ASSETS.flatMap(({ bundle }) =>
      bundle instanceof URL ? [relative(repo, fileURLToPath(bundle))] : []
    ),
  )

/** Inputs to the browser bundles, compiler catalog and sandbox workspace,
 * among `paths`: those the bundles read (`read`), and what the rest are made
 * of. */
export let assetInputs = (paths: string[], read: string[] = []) =>
  paths.filter((path) =>
    read.includes(path) ||
    /^(?:packages\/|workers\/yak\/(?:public|site)\/|apps\/home\/copy\.json$)/
      .test(path) ||
    /^(?:deno\.(?:jsonc?|lock)|bin\/compiler-packages\.ts)$/.test(path) ||
    // `_words.js` is drawn from the Operator store's words (operator-words.ts).
    /^workers\/yak\/(?:wrangler\.ts|asset-ready\.ts|assets\.ts|sheet-assets\.ts|operator-(?:metadata|words|vocab|store|load)\.ts|(?:config|vocabs)\.ts|icons\.ts|mascot\.ts|sandbox\/(?:cli-assets|launch)\.ts|package(?:-lock)?\.json|deno\.json)$/
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
      ...[...ASSETS, ...await drawn()].filter(made).map(({ name }) => name),
      ...Object.values(planned(publicDir).names),
      ...chunksOf(ASSETS, reading(publicDir)),
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
    await bundled(repo),
  )
  return await materialized(
    paths.map((path) => join(repo, path)),
    () => outputs(root),
    make,
    join(root, '.wrangler/asset-memo'),
  )
}
