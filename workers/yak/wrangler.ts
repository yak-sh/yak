#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net=registry.cloudflare.com --allow-env=WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST --allow-run=deno,npm,npx,git,pgrep,kill,docker,env
// The one door to this Worker's wrangler: `deno task deploy:yak`,
// `deno task dev:yak`, their `-staging` variants and the test runner
// (bin/test.ts) all come through here, so the pinned version is written once
// and `node_modules` is current before wrangler reads it.
//
// Why the install has to happen first: wrangler bundles with esbuild, which
// resolves `zod` and the MCP SDK as files under this directory's
// `node_modules` (wrangler.toml `[alias]`). node_modules is gitignored, so a
// fresh worktree has none and every wrangler command dies unresolved at
// mcp.ts's `import { z } from 'zod'` (T-34159). npm is the only thing that
// fills that directory: esbuild wants files on disk, so no import map or
// deno cache reaches those two deps. Deno reads from it too: the kernel in
// memory imports the OAuth provider as a file there (oauth-provider.ts), so a
// test run installs before its first test loads.

// The pin. `--yes` so a cold npx cache installs it instead of asking.
//
// It has a floor, not just a version: `send_email` is Email Sending's binding
// now, whose `send()` takes `{from, to, subject, text, html}` and answers
// `{messageId}` (post.ts), and miniflare only grew that shape late — 4.42.2's
// stand-in knew the old Email Routing binding alone and bounced every letter
// with `could not parse email` (T-34179). Never pin below a wrangler whose
// miniflare simulates the builder; mail_test.ts holds it.
//
// And not the newest either: 4.128.0 boots the same probes three times slower
// and drops kernels under parallel load (`Network connection lost`), where
// 4.111.0 runs them at the old pin's pace. Measure before moving.
// Exact pins can reuse npm's restored cache without registry revalidation.
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parse, stringify } from '@std/toml'
import packages from './package.json' with { type: 'json' }
import { based, imaged } from './sandbox/base.ts'
import { installed } from './dependencies.ts'
export { stale } from './dependencies.ts'

export let WRANGLER = [
  'npx',
  '--yes',
  '--prefer-offline',
  `wrangler@${packages.devDependencies.wrangler}`,
]

export let dir = fileURLToPath(new URL('./', import.meta.url)).replace(
  /\/$/,
  '',
)

// Where a `@yaks/*` name goes when esbuild bundles. The kernel imports the
// packages by name, which deno resolves through the repo's workspace; esbuild
// knows nothing of the workspace. So the workspace itself is handed to it:
// every member's name and exports, read out of its deno.json, written as the
// tsconfig `paths` wrangler.toml points esbuild at. A package the kernel starts
// importing is bundled because it is in the workspace, never because somebody
// remembered to list it.
export let TSCONFIG = `${dir}/.wrangler/paths.json`

let repo = fileURLToPath(new URL('../../', import.meta.url))

type Member = { name?: string; exports?: string | Record<string, string> }

/** Every import name the workspace exports, to the file it is. */
export let members = (root = repo): Record<string, string> => {
  let config = (at: string) =>
    JSON.parse(Deno.readTextFileSync(join(root, at, 'deno.json')))
  let { workspace = [] } = config('.') as { workspace?: string[] }
  return Object.fromEntries(workspace.flatMap((at) => {
    let { name, exports } = config(at) as Member
    if (!name || exports == null) return []
    let map = typeof exports == 'string' ? { '.': exports } : exports
    return Object.entries(map).map(([sub, file]) => [
      name + sub.slice(1),
      join(root, at, file),
    ])
  }))
}

/**
 * Write {@link TSCONFIG}: the workspace as `paths`, relative to the file.
 * Through a rename, so a parallel probe never reads half of one.
 */
export let aliased = (root = repo, to = TSCONFIG) => {
  let paths = Object.fromEntries(
    Object.entries(members(root)).map((
      [name, file],
    ) => [name, [relative(dirname(to), file)]]),
  )
  Deno.mkdirSync(dirname(to), { recursive: true })
  let tmp = `${to}.${Deno.pid}`
  Deno.writeTextFileSync(tmp, JSON.stringify({ compilerOptions: { paths } }))
  Deno.renameSync(tmp, to)
}

let timed = async <T>(name: string, make: () => Promise<T>) => {
  let started = performance.now()
  let value = await make()
  console.log(
    `${name}: ready in ${((performance.now() - started) / 1000).toFixed(3)}s`,
  )
  return value
}

let generated = async (name: string, args: string[]) => {
  let result = await new Deno.Command('deno', {
    args: ['run', '--no-lock', '-A', ...args],
    stdin: 'null',
  }).spawn().status
  if (!result.success) throw new Error(`${name} generation failed`)
}

/** Independent prerequisites start together. A bundle waits for the files it
 * reads; writes wait for all of them. Every lane settles even when one fails. */
export let readiness = (
  make: {
    dependencies: () => Promise<boolean>
    web: () => Promise<void>
    catalog: () => Promise<void>
  },
) => {
  let dependencies = Promise.resolve().then(make.dependencies)
  let web = Promise.resolve().then(make.web)
  let catalog = Promise.resolve().then(make.catalog)
  let all = Promise.allSettled([dependencies, web, catalog]).then(
    (completed) => {
      for (let result of completed) {
        if (result.status == 'rejected') throw result.reason
      }
    },
  )
  return { dependencies, web, catalog, all }
}

let preparing = (root = dir, timeout = 600_000) =>
  readiness({
    dependencies: () =>
      timed('npm dependencies', async () => {
        let changed = await installed(root, timeout)
        aliased()
        return changed
      }),
    web: () =>
      timed('Web assets', () =>
        generated('Web asset', [
          join(repo, 'packages/web/assets.ts'),
          join(root, 'public/_web'),
          '@yaks/browse/web',
        ])),
    catalog: () =>
      timed('Compiler catalog', () =>
        generated('Compiler catalog', [
          join(repo, 'bin/compiler-packages.ts'),
        ])),
  })

/** Prepare every prerequisite before a probe reads it. Answers whether npm installed. */
export let ready = async (root = dir, timeout = 600_000) => {
  let made = preparing(root, timeout)
  await made.all
  return await made.dependencies
}

// Wrangler accepts --env on either side of the command. Both forms need
// the same commit annotation, so production and staging identify one build.
export let command = (args: string[]) => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] == '--env' || args[i] == '-e') i++
    else if (!args[i].startsWith('--env=')) return args[i]
  }
}

// The Workers this one is a contract with, each deployed first, from the same
// commit and to the same environment, so no Worker is ever deployed by hand:
// yak-out (outbound/) is this Worker's dispatch namespace's outbound Worker,
// handing every fetch an app makes back to this Worker's `Outbound`
// entrypoint, and yak-esbuild (esbuild/) is what the ESBUILD binding compiles
// an app with at deploy (@yaks/esbuild), in a container of its own. Both
// exist before this Worker's bindings name them.
export let SIBLINGS = ['outbound/wrangler.toml', 'esbuild/wrangler.toml']

// Each sibling's deploy arguments, or none when these arguments are not a
// deploy or already name a config of their own. A sibling's container rolls
// out as this Worker's does, so a `--containers-rollout` passes through.
export let siblings = (argv: string[]): string[][] =>
  command(argv) != 'deploy' ||
    argv.some((a) => /^(-c|--config)(=|$)/.test(a))
    ? []
    : SIBLINGS.map((c) => [...argv, '-c', c])

// Arguments without their `--containers-rollout`, in either form.
let unrolled = (args: string[]) =>
  args.filter((a, i) =>
    !/^--containers-rollout(=|$)/.test(a) &&
    args[i - 1] != '--containers-rollout'
  )

type Containers = {
  containers?: { image?: string; image_build_context?: string }[]
}

/** What the container images a config builds are made of, by path from
 * `root`: each `[[containers]]` Dockerfile and every file of its build
 * context (the Dockerfile's directory unless the config names one). An image
 * named by registry reference adds nothing; the config itself names it. */
export let images = (
  config: string,
  root = dir,
): Record<string, Uint8Array> => {
  let path = join(root, config)
  let parsed = parse(Deno.readTextFileSync(path)) as Containers & {
    env?: Record<string, Containers>
  }
  return imageInputs(
    path,
    root,
    [parsed, ...Object.values(parsed.env ?? {})]
      .flatMap((c) => c.containers ?? []),
  )
}

let imageInputs = (
  path: string,
  root: string,
  all: NonNullable<Containers['containers']>,
) => {
  let out: Record<string, Uint8Array> = {}
  let add = (file: string) => {
    out[relative(root, file)] = Deno.readFileSync(file)
  }
  let walk = (at: string) => {
    for (let entry of Deno.readDirSync(at)) {
      let file = join(at, entry.name)
      if (entry.isDirectory) walk(file)
      else if (entry.isFile) add(file)
    }
  }
  for (let { image, image_build_context: context } of all) {
    if (!image) continue
    let file = join(dirname(path), image)
    let stat
    try {
      stat = Deno.statSync(file)
    } catch {
      continue
    }
    if (stat.isDirectory) file = join(file, 'Dockerfile')
    add(file)
    walk(context ? join(dirname(path), context) : dirname(file))
  }
  return out
}

/** Deploy independent siblings together, settling every process before the
 * kernel starts. A sibling failure never launches the kernel, and a rejected
 * process wait cannot leave its other sibling running after this door exits. */
export let runWrangler = async (
  argv: string[],
  run: (args: string[], unpinned?: boolean) => Promise<number>,
  prepare: () => Promise<string[]> = () => Promise.resolve(argv),
): Promise<number> => {
  let completed = await Promise.allSettled(
    [
      ...siblings(argv).map((args) =>
        Promise.resolve().then(() => run(args, true))
      ),
      Promise.resolve().then(prepare),
    ],
  )
  for (let result of completed) {
    if (result.status == 'rejected') throw result.reason
    if (typeof result.value == 'number' && result.value) return result.value
  }
  return await run((completed.at(-1) as PromiseFulfilledResult<string[]>).value)
}

/** Prepare a disposable artifact while the read-only guard runs. Uploads may
 * begin once readiness and the guard permit them; their preparation can await
 * the artifact. Settle every lane before removing it, including refused or
 * failed guards, so no bundle process or temporary output outlives this door. */
export let preflight = async <T extends { remove: () => void }>(
  ready: () => Promise<unknown>,
  inspect: () => Promise<boolean>,
  prepare: () => Promise<T>,
  upload: (prepared: Promise<T>) => Promise<number>,
  writable: () => Promise<unknown> = () => Promise.resolve(),
): Promise<number> => {
  let readied = Promise.resolve().then(ready)
  let prepared = readied.then(prepare)
  let uploaded = Promise.allSettled([
    readied,
    Promise.resolve().then(inspect),
    Promise.resolve().then(writable),
  ])
    .then(([ready, allowed, writable]) => {
      if (ready.status == 'rejected') throw ready.reason
      if (allowed.status == 'rejected') throw allowed.reason
      if (writable.status == 'rejected') throw writable.reason
      return allowed.value ? upload(prepared) : 0
    })
  let [made, sent] = await Promise.allSettled([prepared, uploaded])
  try {
    if (made.status == 'rejected') throw made.reason
    if (sent.status == 'rejected') throw sent.reason
    return sent.value
  } finally {
    if (made.status == 'fulfilled') made.value.remove()
  }
}

type Deployment = {
  created_on: string
  versions: { version_id: string; percentage: number }[]
  annotations?: Record<string, string>
}

let singleServing = (deployments: unknown): Deployment | undefined => {
  if (
    !Array.isArray(deployments) ||
    deployments.some((d) =>
      !d || typeof d != 'object' || !Number.isFinite(Date.parse(d.created_on))
    )
  ) return
  let latest =
    deployments.toSorted((a, b) =>
      Date.parse(b.created_on) - Date.parse(a.created_on)
    )[0]
  return Array.isArray(latest?.versions) && latest.versions.length == 1 &&
      latest.versions[0]?.percentage == 100
    ? latest
    : undefined
}

let annotation = (release: { annotations?: Record<string, string> } | null) => {
  let message = release?.annotations?.['workers/message']
  return typeof message == 'string' ? message : ''
}
let INPUTS = /\ninputs:[a-f0-9]{64}$/

/** Skip an upload only when the single serving deployment carries the digest
 * of these exact inputs. A version's full annotation can replace a truncated
 * deployment summary only when it names that deployment's sole live version. */
export let sameSibling = (
  digest: string,
  deployments: unknown,
  version?: { id?: string; annotations?: Record<string, string> } | null,
): boolean => {
  let live = singleServing(deployments)
  if (!live) return false
  let message = annotation(live)
  return message.endsWith(`\ninputs:${digest}`) ||
    (!INPUTS.test(message) &&
      typeof live.versions[0].version_id == 'string' &&
      version?.id == live.versions[0].version_id &&
      annotation(version ?? null).endsWith(`\ninputs:${digest}`))
}

/** Read the full annotation only when the single serving summary lacks it.
 * An unavailable identity means upload, just as a changed identity does. */
export let sameServing = async (
  digest: string,
  deployments: unknown,
  read: (id: string) => Promise<Parameters<typeof sameSibling>[2]>,
) => {
  let version: Parameters<typeof sameSibling>[2]
  let current = singleServing(deployments)
  if (
    current && typeof current.versions[0].version_id == 'string' &&
    !INPUTS.test(annotation(current))
  ) {
    try {
      version = await read(current.versions[0].version_id)
    } catch { /* unread means upload */ }
  }
  return sameSibling(digest, deployments, version)
}

/** Wrangler's upload inputs, not source timestamps or the last main commit. */
export let siblingDigest = (
  config: string,
  modules: Record<string, Uint8Array>,
) => {
  let hash = createHash('sha256')
  for (
    let [name, body] of [
      ['config', new TextEncoder().encode(config)],
      ...Object.entries(modules).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    ] as [string, Uint8Array][]
  ) {
    hash.update(`${name.length}:${name}:${body.length}:`)
    hash.update(body)
  }
  return hash.digest('hex')
}

/** Replace local image builds with source-addressed registry images. The temporary
 * config stays beside its original so Wrangler resolves every other path alike. */
export let siblingImages = async (
  config: string,
  ensure: typeof imaged = imaged,
  root = dir,
  wrangler = WRANGLER,
) => {
  let path = join(root, config)
  let parsed = parse(Deno.readTextFileSync(path)) as Containers & {
    env?: Record<string, Containers>
  }
  let refs = new Map<string, string>()
  for (let part of [parsed, ...Object.values(parsed.env ?? {})]) {
    for (let container of part.containers ?? []) {
      let image = container.image
      if (!image) continue
      let dockerfile = join(dirname(path), image)
      try {
        if (Deno.statSync(dockerfile).isDirectory) {
          dockerfile = join(dockerfile, 'Dockerfile')
        }
      } catch {
        continue
      }
      let context = container.image_build_context
        ? join(dirname(path), container.image_build_context)
        : dirname(dockerfile)
      let descriptor = JSON.stringify({
        dockerfile: relative(root, dockerfile),
        context: relative(root, context),
      })
      let ref = refs.get(descriptor)
      if (!ref) {
        let digest = siblingDigest(
          descriptor,
          imageInputs(path, root, [container]),
        )
        ref = await ensure({
          wrangler,
          name: `yak-${dirname(config).replaceAll('/', '-')}:inputs-${digest}`,
          dockerfile,
          context,
        })
        refs.set(descriptor, ref)
      }
      container.image = ref
      delete container.image_build_context
    }
  }
  if (!refs.size) return { config, remove: () => {} }
  let temp = Deno.makeTempFileSync({
    dir: dirname(path),
    prefix: '.images-',
    suffix: '.toml',
  })
  try {
    Deno.writeTextFileSync(temp, stringify(parsed))
  } catch (error) {
    Deno.removeSync(temp)
    throw error
  }
  return { config: relative(root, temp), remove: () => Deno.removeSync(temp) }
}

type Bundle = { entry: string; output: string }

let bundleEntry = (output: string, meta: string, base: string): Bundle => {
  let { outputs } = JSON.parse(Deno.readTextFileSync(meta)) as {
    outputs: Record<string, { entryPoint?: string }>
  }
  let entries = Object.entries(outputs).filter(([, output]) =>
    output.entryPoint
  )
  if (entries.length != 1) throw new Error('Bundle has no unique entrypoint')
  let entry = resolve(base, entries[0][0])
  if (!entry.startsWith(output + '/')) {
    throw new Error('Entrypoint is outside its bundle')
  }
  Deno.removeSync(meta)
  return { entry, output }
}

// Keep relative bindings, assets and image paths beside their original config.
// These modules already contain the pin's transforms and source maps.
let unbundled = (from: string, { entry, output }: Bundle, root: string) => {
  let path = join(root, from)
  let parsed = parse(Deno.readTextFileSync(path))
  Object.assign(parsed, {
    main: entry,
    base_dir: output,
    no_bundle: true,
    minify: false,
    find_additional_modules: true,
  })
  let config = Deno.makeTempFileSync({
    dir: dirname(path),
    prefix: '.bundle-',
    suffix: '.toml',
  })
  try {
    Deno.writeTextFileSync(config, stringify(parsed))
    return config
  } catch (error) {
    Deno.removeSync(config)
    throw error
  }
}

/** Bundle with the pinned Wrangler before uploads finish, then upload those
 * same modules and source maps through the original config's bindings. */
export let bundled = async (
  args: string[],
  run: (args: string[]) => Promise<number>,
  root = dir,
) => {
  if (
    !siblings(args).length ||
    args.some((a) =>
      /^(--dry-run|--no-bundle|--outdir|--metafile)(=|$)/.test(a)
    )
  ) {
    return { args, remove: () => {} }
  }
  let output = Deno.makeTempDirSync({
    dir: join(root, '.wrangler'),
    prefix: 'kernel-',
  })
  let config: string | undefined
  let remove = () => {
    if (config) Deno.removeSync(config)
    Deno.removeSync(output, { recursive: true })
  }
  try {
    let meta = join(output, 'metafile.json')
    let code = await run([
      ...unrolled(args),
      '--dry-run',
      '--containers-rollout=none',
      '--outdir',
      output,
      '--metafile',
      meta,
    ])
    if (code) throw new Error(`Kernel bundle exited ${code}`)
    config = unbundled('wrangler.toml', bundleEntry(output, meta, root), root)
    return { args: [...args, '-c', config], remove }
  } catch (error) {
    remove()
    throw error
  }
}

export type PreparedSibling = {
  args: string[]
  config: string
  root: string
  started: number
  code?: number
  bundle?: Bundle
  remove: () => void
}

/** Bundle a sibling and read its serving deployment, without uploading or
 * preparing images. The caller owns the returned artifact until upload ends. */
export let prepareSibling = async (
  args: string[],
  wrangler = WRANGLER,
  root = dir,
  query = (argv: string[]) =>
    new Deno.Command('env', {
      args: [...PINNED.flatMap((v) => ['-u', v]), ...wrangler, ...argv],
      cwd: root,
      stdout: 'piped',
      stderr: 'piped',
    }).output(),
): Promise<PreparedSibling> => {
  let config = args[args.indexOf('-c') + 1]
  let started = performance.now()
  if (args.includes('--dry-run')) {
    return { args, config, root, started, remove: () => {} }
  }
  let output = Deno.makeTempDirSync({
    dir: join(root, '.wrangler'),
    prefix: 'sibling-',
  })
  let remove = () => Deno.removeSync(output, { recursive: true })
  let meta = join(output, 'metafile.json')
  try {
    // A dry run with no rollout bundles the Worker and builds no image: the
    // image's inputs are read below instead.
    let [bundled, serving] = await Promise.allSettled([
      Promise.resolve().then(() =>
        query([
          ...unrolled(args),
          '--dry-run',
          '--outdir',
          output,
          '--metafile',
          meta,
          '--containers-rollout=none',
        ])
      ),
      Promise.resolve().then(() =>
        query(['deployments', 'list', '-c', config, ...envs(args), '--json'])
      ),
    ])
    if (bundled.status == 'rejected') throw bundled.reason
    let built = bundled.value
    let live = serving.status == 'fulfilled' ? serving.value : undefined
    if (!built.success) {
      console.error(new TextDecoder().decode(built.stderr))
      return { args, config, root, started, code: built.code, remove }
    }
    let bundle = bundleEntry(output, meta, dirname(join(root, config)))
    let modules: Record<string, Uint8Array> = {}
    for (let file of Deno.readDirSync(output)) {
      // Wrangler emits these beside the actual multipart upload modules.
      if (
        file.isFile && file.name != 'README.md' && !file.name.endsWith('.map')
      ) {
        modules[file.name] = Deno.readFileSync(join(output, file.name))
      }
    }
    Object.assign(modules, images(config, root))
    let digest = siblingDigest(
      JSON.stringify({
        config: Deno.readTextFileSync(join(root, config)),
        wrangler: WRANGLER,
        // Flags can override config bindings too; the commit annotation alone
        // changes on every push and is not part of the serving code.
        args: args.filter((arg, i) =>
          arg != '--message' && args[i - 1] != '--message'
        ),
      }),
      modules,
    )
    let deployments: unknown
    try {
      if (live?.success) {
        deployments = JSON.parse(new TextDecoder().decode(live.stdout))
      }
    } catch { /* unread means upload */ }
    // Cloudflare may cut deployment messages to 50 characters; the full
    // annotation remains on the sole serving version.
    let same = await sameServing(digest, deployments, async (id) => {
      let read = await query([
        'versions',
        'view',
        id,
        '-c',
        config,
        ...envs(args),
        '--json',
      ])
      return read.success
        ? JSON.parse(new TextDecoder().decode(read.stdout))
        : null
    })
    console.log(
      `${config}: bundled and read serving deployment in ${
        ((performance.now() - started) / 1000).toFixed(3)
      }s`,
    )
    if (same) {
      console.log(
        `${config}: unchanged bundled upload ${
          digest.slice(0, 12)
        } — already serving`,
      )
      return { args, config, root, started, code: 0, remove }
    }
    let annotated = [...args]
    let message = annotated.indexOf('--message')
    if (message >= 0) {
      // Keep the commit identity; subjects can already consume the API's 512-byte message limit.
      annotated[message + 1] = annotated[message + 1].slice(0, 40) +
        `\ninputs:${digest}`
    } else annotated.push('--message', `inputs:${digest}`)
    return { args: annotated, config, root, started, bundle, remove }
  } catch (error) {
    remove()
    throw error
  }
}

/** Upload only a changed, successfully prepared sibling. Image preparation
 * remains on this side of the deploy guard. */
export let uploadSibling = async (
  { args, config, root, started, code, bundle }: PreparedSibling,
  run: (args: string[], unpinned?: boolean) => Promise<number>,
  wrangler = WRANGLER,
  ensure = imaged,
) => {
  if (code != null) return code
  if (args.includes('--dry-run')) return await run(args, true)
  let image = /(^| )--containers-rollout[= ]none( |$)/.test(args.join(' '))
    ? { config, remove: () => {} }
    : await siblingImages(config, ensure, root, wrangler)
  let annotated = [...args]
  let result: number
  let artifact: string | undefined
  try {
    if (bundle) artifact = unbundled(image.config, bundle, root)
    annotated[annotated.indexOf('-c') + 1] = artifact ?? image.config
    result = await run(annotated, true)
  } finally {
    if (artifact) Deno.removeSync(artifact)
    image.remove()
  }
  console.log(
    `${config}: upload path finished in ${
      ((performance.now() - started) / 1000).toFixed(3)
    }s`,
  )
  return result
}

// What Workers Builds pins to this Worker. Inherited by another Worker's
// deploy, the first deploys it under this Worker's name and the second fails
// its tag check, so each sibling's deploy runs without them (bin/build-yak drops
// them for staging the same way).
export let PINNED = ['WRANGLER_CI_OVERRIDE_NAME', 'WRANGLER_CI_MATCH_TAG']

// Every process under `pid`, children before parents. Through pgrep(1):
// reading /proc is something Deno grants only to --allow-all.
export let descendants = (pid: number): number[] => {
  let out = new Deno.Command('pgrep', { args: ['-P', String(pid)] })
    .outputSync()
  let kids = new TextDecoder().decode(out.stdout).split('\n').filter(Boolean)
    .map(Number)
  return kids.flatMap((kid) => [...descendants(kid), kid])
}

// ---- which commit may go live ----------------------------------------------
//
// Workers Builds runs one build per push that changes workers/yak or packages,
// and the builds finish in whatever order they finish. A deploy stops when a
// newer build has source to deploy, or a newer version is already live. Other
// pushes do not start a build, so they must not supersede the last one.
// A live version that is neither behind nor ahead (a commit that never reached
// main) is replaced: main is what runs. What could not be read is printed.

/** What a deploy sees: its own commit, main's tip at the remote (null when the
 * remote could not be asked), whether the watched source changed at that tip,
 * and each commit a live version was deployed from, with whether it is ahead
 * of this one (null when git cannot tell). */
export type Seen = {
  head: string
  tip: string | null
  changed: boolean | null
  live: { sha: string; ahead: boolean | null }[]
}

let short = (sha: string) => sha.slice(0, 8)

/** Why this commit must not go live, or null when it may. */
export let superseded = ({ head, tip, changed, live }: Seen): string | null => {
  if (tip && tip != head && changed !== false) {
    return changed
      ? `main is at ${
        short(tip)
      } with newer Worker source; its build deploys it`
      : `main is at ${short(tip)}; watched source could not be compared`
  }
  let newer = live.find((l) => l.ahead)
  return newer
    ? `${short(newer.sha)} is live and ahead of ${short(head)}`
    : null
}

let git = async (root: string, ...args: string[]) => {
  let r = await new Deno.Command('git', {
    args,
    cwd: root,
    stdout: 'piped',
    stderr: 'null',
  }).output()
  return { code: r.code, out: new TextDecoder().decode(r.stdout).trim() }
}

let SHA = /^[0-9a-f]{40}\b/

// The paths in the Workers Builds dashboard (README.md). An app-only push
// changes neither, so no later build exists to take this one's place.
let WATCHED = ['workers/yak', 'packages']

/**
 * What a deploy from `root`'s checkout sees, given the commits live now. A
 * live commit this clone lacks is fetched first: it was pushed after the clone
 * was made, and a shallow clone holds only the commits it was made with.
 */
export let seen = async (
  root: string,
  live: string[] | Promise<string[]>,
  read = git,
): Promise<Seen> => {
  let [checked, asked, named] = await Promise.all([
    read(root, 'rev-parse', 'HEAD'),
    read(root, 'ls-remote', 'origin', 'refs/heads/main'),
    live,
  ])
  let head = checked.out
  let tip = asked.code ? null : SHA.exec(asked.out)?.[0] ?? null
  let include = async (sha: string) => {
    if ((await read(root, 'cat-file', '-e', `${sha}^{commit}`)).code) {
      await read(root, 'fetch', '--quiet', 'origin', sha)
    }
  }
  let changed: boolean | null = false
  if (tip && tip != head) {
    await include(tip)
    let { code } = await read(
      root,
      'diff',
      '--quiet',
      head,
      tip,
      '--',
      ...WATCHED,
    )
    changed = code == 0 ? false : code == 1 ? true : null
  }
  let ahead = async (sha: string) => {
    if (sha == head) return false
    await include(sha)
    let { code } = await read(root, 'merge-base', '--is-ancestor', head, sha)
    return code == 0 ? true : code == 1 ? false : null
  }
  return {
    head,
    tip,
    changed,
    live: await Promise.all(
      named.map(async (sha) => ({ sha, ahead: await ahead(sha) })),
    ),
  }
}

// A command's `--env` arguments, as it wrote them.
let envs = (args: string[]): string[] =>
  args.flatMap((a, i) =>
    a == '--env' || a == '-e'
      ? [a, args[i + 1]]
      : a.startsWith('--env=')
      ? [a]
      : []
  )

/** The commits the versions live now were deployed from, as the message this
 * door gives every version says (`--message` below), in the deploy's own
 * environment. Anything wrangler will not answer names no commit. */
let serving = async (env: string[], wrangler = WRANGLER): Promise<string[]> => {
  let read = async (args: string[]) => {
    let r = await new Deno.Command(wrangler[0], {
      args: [...wrangler.slice(1), ...args, ...env, '--json'],
      cwd: dir,
      stdout: 'piped',
      stderr: 'null',
    }).output()
    try {
      return r.success ? JSON.parse(new TextDecoder().decode(r.stdout)) : null
    } catch {
      return null
    }
  }
  let deployments: {
    created_on: string
    annotations?: Record<string, string>
    versions: { version_id: string; percentage: number }[]
  }[] = await read(['deployments', 'list']) ?? []
  let now =
    deployments.toSorted((a, b) =>
      Date.parse(b.created_on) - Date.parse(a.created_on)
    )[0]
  let annotated = SHA.exec(now?.annotations?.['workers/message'] ?? '')?.[0]
  if (
    now?.versions.length == 1 && now.versions[0].percentage == 100 && annotated
  ) return [annotated]
  let named = await Promise.all(
    (now?.versions ?? []).filter((v) => v.percentage > 0).map(async (v) => {
      let version = await read(['versions', 'view', v.version_id])
      return SHA.exec(version?.annotations?.['workers/message'] ?? '')?.[0]
    }),
  )
  return named.filter((sha) => sha != null)
}

if (import.meta.main) {
  let started = performance.now()
  let argv = [...Deno.args]
  // npm ci pins this executable already. npx adds an npm process and package
  // resolution to every read/upload even when the exact package is installed.
  let executable = join(dir, 'node_modules/.bin/wrangler')
  let wrangler = WRANGLER
  let guarded = command(argv) === 'deploy' && !argv.includes('--dry-run')
  let inspect = async () => {
    if (!guarded) return true
    let saw = await seen(dir, serving(envs(argv), wrangler))
    let live = saw.live.map((l) => short(l.sha) + (l.ahead == null ? '?' : ''))
    console.log(
      `deploy ${short(saw.head)}: main at ${
        saw.tip ? short(saw.tip) : '(unread)'
      }, live ${live.join(' ') || '(unread)'}`,
    )
    let why = superseded(saw)
    if (why) {
      console.log(`not deploying: ${why}`)
      return false
    }
    return true
  }
  if (command(argv) === 'deploy') {
    // Versions carry their commit so `yak admin deploys` need not infer it by time.
    let commit = await new Deno.Command('git', {
      args: ['log', '-1', '--format=%H %s'],
      cwd: dir,
      stdout: 'piped',
      stderr: 'inherit',
    }).output()
    if (!commit.success) Deno.exit(commit.code)
    argv.push('--message', new TextDecoder().decode(commit.stdout).trim())
  }
  let children = new Set<Deno.ChildProcess>()
  let interrupted = false
  // A signal to this door reaches wrangler too; otherwise a stopped `tail`
  // leaves wrangler streaming and its reader waiting on a pipe that never
  // closes (verify-deploy.ts hung ten minutes on a three-minute tail). The
  // child is npx, which does not pass a signal to the wrangler it spawned, so
  // the whole subtree is signalled, deepest first. Through kill(1), not
  // Deno.kill: that needs the unrestricted run permission, and this door
  // runs with an allowlist (npm, npx, git, pgrep, kill, docker, env).
  for (let signal of ['SIGINT', 'SIGTERM'] as const) {
    Deno.addSignalListener(signal, () => {
      interrupted = true
      let pids = [...children].flatMap((child) => [
        ...descendants(child.pid),
        child.pid,
      ]).map(String)
      if (!pids.length) return
      new Deno.Command('kill', {
        args: ['-s', signal.slice(3), ...pids],
        stderr: 'null',
      }).spawn()
    })
  }
  // env(1) execs wrangler in its own place, so the pid signalled is the same.
  let run = async (argv: string[], unpinned = false) => {
    if (interrupted) return 130
    console.log(
      `Wrangler ${command(argv)} ${
        argv.includes('-c') ? argv[argv.indexOf('-c') + 1] : 'wrangler.toml'
      }: starting at ${((performance.now() - started) / 1000).toFixed(3)}s`,
    )
    let [cmd, ...args] = unpinned
      ? ['env', ...PINNED.flatMap((v) => ['-u', v]), ...wrangler]
      : wrangler
    let child = new Deno.Command(cmd, { args: [...args, ...argv], cwd: dir })
      .spawn()
    children.add(child)
    try {
      return (await child.status).code
    } finally {
      children.delete(child)
    }
  }
  let prepare = async (
    bundle: Promise<Awaited<ReturnType<typeof bundled>>>,
  ) => {
    let [compiled, base] = await Promise.allSettled([
      bundle,
      (async () => {
        if (
          command(argv) === 'deploy' &&
          !/(^| )--containers-rollout[= ]none( |$)/.test(argv.join(' '))
        ) await based({ wrangler, dry: argv.includes('--dry-run') })
      })(),
    ])
    if (base.status == 'rejected') throw base.reason
    if (compiled.status == 'rejected') throw compiled.reason
    return compiled.value.args
  }
  let made = preparing()
  let readied = made.dependencies.then(() => {
    // Choose after npm has installed: a cold checkout has this pin now too.
    wrangler = ['env', executable]
  })
  let inspected = readied.then(inspect)
  let uploads = new Map(
    siblings(argv).map((args) => [
      args[args.indexOf('-c') + 1],
      preflight(
        () =>
          args.includes('esbuild/wrangler.toml')
            ? Promise.all([readied, made.catalog])
            : readied,
        () => inspected,
        () => prepareSibling(args, wrangler),
        async (prepared) => uploadSibling(await prepared, run, wrangler),
        () => made.all,
      ),
    ]),
  )
  let kernel = preflight(
    () => readied,
    () => inspected,
    () => bundled(argv, run),
    (bundle) =>
      runWrangler(
        argv,
        (args, unpinned) =>
          unpinned ? uploads.get(args[args.indexOf('-c') + 1])! : run(args),
        () => prepare(bundle),
      ),
    () => made.all,
  )
  // A refused guard never enters runWrangler, so drain its sibling preparations
  // here too before leaving the door.
  let completed = await Promise.allSettled([kernel, ...uploads.values()])
  for (let result of completed) {
    if (result.status == 'rejected') throw result.reason
  }
  Deno.exit((completed[0] as PromiseFulfilledResult<number>).value)
}
