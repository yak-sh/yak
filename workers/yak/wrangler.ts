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
import { Buffer } from 'node:buffer'
import { stripVTControlCharacters } from 'node:util'
import { parse, stringify } from '@std/toml'
import packages from './package.json' with { type: 'json' }
import { imaged } from './sandbox/base.ts'
import { installed } from './dependencies.ts'
import { sleep } from '@yaks/fp'
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

// A prerequisite made, and what making it took; `quiet` says only a failure.
let timed = async <T>(name: string, make: () => Promise<T>, quiet = false) => {
  let started = performance.now()
  let value = await make()
  if (!quiet) {
    console.log(
      `${name}: ready in ${((performance.now() - started) / 1000).toFixed(3)}s`,
    )
  }
  return value
}

let generated = async (name: string, args: string[], quiet = false) => {
  let result = await new Deno.Command('deno', {
    args: ['run', '--no-lock', '-A', ...args],
    stdin: 'null',
    stdout: quiet ? 'null' : 'inherit',
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
    cli?: () => Promise<void>
    client?: () => Promise<void>
  },
) => {
  let dependencies = Promise.resolve().then(make.dependencies)
  let web = Promise.resolve().then(make.web)
  let catalog = Promise.resolve().then(make.catalog)
  let cli = Promise.resolve().then(() => make.cli?.())
  let client = Promise.resolve().then(() => make.client?.())
  let all = Promise.allSettled([dependencies, web, catalog, cli, client])
    .then(
      (completed) => {
        for (let result of completed) {
          if (result.status == 'rejected') throw result.reason
        }
      },
    )
  return { dependencies, web, catalog, all }
}

let preparing = (root = dir, timeout = 600_000, quiet = false) =>
  readiness({
    dependencies: () =>
      timed('npm dependencies', async () => {
        let changed = await installed(root, { timeout })
        aliased()
        return changed
      }, quiet),
    web: () =>
      timed('Web assets', () =>
        generated('Web asset', [
          join(repo, 'packages/web/assets.ts'),
          join(root, 'public/_web'),
          '@yaks/browse/web',
        ], quiet), quiet),
    client: () =>
      timed(
        'Client assets',
        () =>
          generated('Client asset', [join(root, 'client-assets.ts')], quiet),
        quiet,
      ),
    cli: () =>
      timed('Sandbox CLI', () =>
        generated(
          'Sandbox CLI',
          [join(root, 'sandbox/cli-assets.ts')],
          quiet,
        ), quiet),
    catalog: () =>
      timed('Compiler catalog', () =>
        generated('Compiler catalog', [
          join(repo, 'bin/compiler-packages.ts'),
        ], quiet), quiet),
  })

/** Set in the environment of a process that readied a root, naming it: every
 * process it starts afterwards inherits it, so a test run (bin/test.ts)
 * readies once, and the runtimes that boot its kernels find it done. */
export let READIED = 'YAK_WORKER_READIED'

/** Prepare every prerequisite before a probe reads it, unless this process or
 * the one that started it already did. Answers whether npm installed. `quiet`
 * says only what failed: a test run's reader acts on nothing else. */
export let ready = async (quiet = false, root = dir, timeout = 600_000) => {
  if (Deno.env.get(READIED) == root) return false
  let made = preparing(root, timeout, quiet)
  await made.all
  let installed = await made.dependencies
  Deno.env.set(READIED, root)
  return installed
}

// Wrangler accepts --env on either side of the command. Both forms need
// the same commit annotation, so production and staging identify one build.
export let command = (args: string[]) => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] == '--env' || args[i] == '-e') i++
    else if (!args[i].startsWith('--env=')) return args[i]
  }
}

type StepResult = { code: number; output: string; log?: string }

let deploying = (args: string[]) =>
  command(args) == 'deploy' ||
  (command(args) == 'versions' && args.includes('deploy'))

// The containers API's client words every HTTP 500 it gets this way, and
// prints no request or status beside it.
let INTERNAL = /^\s*There has been an internal error\b/

// Final API errors a new Wrangler process gets past. Asset completion tokens
// are single-use (100312): a new process starts a fresh upload session rather
// than resubmitting the consumed token. A version just uploaded can stay
// unreadable past Wrangler's own two seconds of asking (100146): a new process
// uploads it again.
let RACED = /\[code: (?:100146|100312)\]/

// Asset uploads are authorized by the upload session's own JWT, not the
// deploy's token: their 401 refuses the session, and a new process opens
// another.
let SESSION = /\/workers\/assets\/upload\b/

// JSON API errors hide their HTTP status on the console. Wrangler's sanitized
// debug file records it even at normal verbosity. Use the last response before
// the final API error, never an earlier request that Wrangler recovered from.
let transient = ({ output, log = '' }: StepResult) => {
  output = stripVTControlCharacters(output).split('[ERROR]').at(-1)!
  if (INTERNAL.test(output)) return true
  let malformed = output.includes('Received a malformed response from the API')
  let failed = /A request to the Cloudflare API(?: \([^\n]+\))? failed\./.exec(
    output,
  )
  if (!malformed && !failed) return false
  if (failed && RACED.test(output)) return true
  let request =
    /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/\S+) -> (\d{3})\b/
      .exec(output)
  if (request?.[2] == '401' && SESSION.test(request[1])) return true
  let status = request?.[2]
  if (!status) {
    let at = log.lastIndexOf(
      failed?.[0] ?? 'Received a malformed response from the API',
    )
    let before = at < 0 ? log : log.slice(0, at)
    status = [
      ...before.matchAll(/-- START CF API RESPONSE:[^\n]*\b(\d{3})\s*$/gm),
    ]
      .at(-1)?.[1]
  }
  return status
    ? status.startsWith('5') || (malformed && Number(status) < 400)
    : malformed
}

/** Run one Wrangler step, keeping its arguments and exit code. The command
 * boundary supplies diagnostics; the timer and signal belong to the caller.
 * Deploys get three attempts; permanent failures and other commands get one.
 * Each attempt that would change what serves first asks `allowed`, the deploy
 * guard as it stands then; one it refuses deploys nothing and exits 0. */
export let runStep = async (
  args: string[],
  execute: (args: string[]) => Promise<StepResult>,
  { wait = sleep, signal, allowed }: {
    wait?: typeof sleep
    signal?: AbortSignal
    allowed?: () => Promise<boolean>
  } = {},
): Promise<number> => {
  let promotes = deploying(args) && !args.includes('--dry-run')
  for (let attempt = 1;; attempt++) {
    if (signal?.aborted) return 130
    if (promotes && allowed && !await allowed()) return 0
    let result = await execute(args)
    if (
      !result.code || result.code == 130 || result.code == 143 ||
      !deploying(args) || attempt == 3 || !transient(result)
    ) return result.code
    if (signal?.aborted) return 130
    let ms = 1000 * 2 ** (attempt - 1)
    console.log(
      `Temporary Cloudflare API failure; retrying Wrangler ${
        command(args)
      } (attempt ${attempt + 1}/3) in ${ms / 1000}s`,
    )
    await wait(ms, signal)
  }
}

// Forward bytes immediately, retaining only the diagnostic tail. Parallel
// siblings write directly rather than locking a shared stdout stream writer.
let forwarded = async (
  from: ReadableStream<Uint8Array>,
  to: { write: (bytes: Uint8Array) => Promise<number> },
) => {
  let decoder = new TextDecoder(), tail = ''
  for await (let bytes of from) {
    tail = (tail + decoder.decode(bytes, { stream: true })).slice(-65536)
    for (let at = 0; at < bytes.length;) {
      at += await to.write(bytes.subarray(at))
    }
  }
  return tail + decoder.decode()
}

let logTail = (path: string) => {
  try {
    using file = Deno.openSync(path)
    let bytes = new Uint8Array(Math.min(file.statSync().size, 65536))
    file.seekSync(-bytes.length, Deno.SeekMode.End)
    let size = file.readSync(bytes) ?? 0
    return new TextDecoder().decode(bytes.subarray(0, size))
  } catch {
    return ''
  }
}

// The Workers this one is a contract with, each deployed first, from the same
// commit and to the same environment, so no Worker is ever deployed by hand:
// yak-out (outbound/) is this Worker's dispatch namespace's outbound Worker,
// handing every fetch an app makes back to this Worker's `Outbound`
// entrypoint, yak-esbuild (esbuild/) is what the ESBUILD binding compiles
// an app with at deploy (@yaks/esbuild), in a container of its own, and
// yak-raster (raster/) is what the RASTER binding draws an app's icon.svg
// with. Each exists before this Worker's bindings name it.
export let SIBLINGS = [
  'outbound/wrangler.toml',
  'esbuild/wrangler.toml',
  'raster/wrangler.toml',
]

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
let INPUTS = /(?:\ninputs:[a-f0-9]{64}$|^inputs:[A-Za-z0-9_-]{43}(?:\n|$))/

// All 256 bits fit in Cloudflare's 50-character deployment summary. Keep the
// full commit on the next line of the version's annotation.
export let siblingMessage = (digest: string, commit = '') =>
  `inputs:${Buffer.from(digest, 'hex').toString('base64url')}` +
  (commit ? `\n${commit}` : '')

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
  let matches = (message: string) =>
    message.split('\n')[0] == siblingMessage(digest) ||
    message.endsWith(`\ninputs:${digest}`)
  return matches(message) ||
    (!INPUTS.test(message) &&
      typeof live.versions[0].version_id == 'string' &&
      version?.id == live.versions[0].version_id &&
      matches(annotation(version ?? null)))
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

// The executor has an independent Builds connection. Naming it before that
// project publishes its first release would prevent kernel deployment, so
// only a fully serving release grants the kernel its service binding.
export let modelBound = async (
  args: string[],
  read = (args: string[]) =>
    new Deno.Command('env', {
      args: [...PINNED.flatMap((v) => ['-u', v]), ...WRANGLER, ...args],
      cwd: dir,
      stdout: 'piped',
      stderr: 'piped',
    }).output(),
  root = dir,
) => {
  let unchanged = { args, remove: () => {} }
  if (
    command(args) != 'deploy' || envs(args).length ||
    args.some((arg) => /^--dry-run(=|$)/.test(arg))
  ) return unchanged
  let model = '../model/wrangler.toml'
  let name = parse(Deno.readTextFileSync(join(root, model))).name
  if (typeof name != 'string') {
    throw Error('Executor config has no release name')
  }
  try {
    let result = await read(['deployments', 'list', '-c', model, '--json'])
    if (
      !result.success ||
      !singleServing(JSON.parse(new TextDecoder().decode(result.stdout)))
    ) {
      console.log(
        `${name}: no fully serving executor release; hosted calls remain inline`,
      )
      return unchanged
    }
  } catch {
    console.log(
      `${name}: executor deployment unreadable; hosted calls remain inline`,
    )
    return unchanged
  }
  let at = args.indexOf('-c')
  let path = resolve(root, at >= 0 ? args[at + 1] : 'wrangler.toml')
  let parsed = parse(Deno.readTextFileSync(path))
  let services = Array.isArray(parsed.services) ? parsed.services : []
  parsed.services = [
    ...services.filter((service) => service.binding != 'MODEL'),
    { binding: 'MODEL', service: name },
  ]
  let config = Deno.makeTempFileSync({
    dir: dirname(path),
    prefix: '.model-',
    suffix: '.toml',
  })
  try {
    Deno.writeTextFileSync(config, stringify(parsed))
  } catch (error) {
    Deno.removeSync(config)
    throw error
  }
  let bound = [...args]
  if (at >= 0) bound[at + 1] = relative(root, config)
  else bound.push('-c', relative(root, config))
  console.log(`${name}: serving executor bound as MODEL`)
  return { args: bound, remove: () => Deno.removeSync(config) }
}

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
    rules: [
      { type: 'ESModule', globs: ['**/*.js'], fallthrough: true },
      ...(Array.isArray(parsed.rules) ? parsed.rules : []),
    ],
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

/** Build the kernel before uploads finish, then hand Wrangler the same
 * modules and source maps through the original config's bindings. */
export let bundled = async (
  args: string[],
  make: (output: string, meta: string) => Promise<void>,
  root = dir,
) => {
  if (
    !siblings(args).length ||
    args.some((a) => /^(--no-bundle)(=|$)/.test(a))
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
    let metaAt = args.findIndex((arg) =>
      arg == '--metafile' || arg.startsWith('--metafile=')
    )
    let attached = metaAt >= 0 && args[metaAt].startsWith('--metafile=')
    let next = metaAt >= 0 && !attached &&
      args[metaAt + 1]?.startsWith('-') === false
    let named = attached
      ? args[metaAt].slice('--metafile='.length)
      : next
      ? args[metaAt + 1]
      : undefined
    let meta = named ? resolve(root, named) : join(output, 'metafile.json')
    await make(output, meta)
    // The metafile describes esbuild's source attribution. Wrangler uploads
    // already-built modules here, so it has no second metafile to write.
    let upload = args.filter((_, i) =>
      metaAt < 0 || i != metaAt && (!next || i != metaAt + 1)
    )
    config = unbundled('wrangler.toml', {
      entry: join(output, 'index.js'),
      output,
    }, root)
    return { args: [...upload, '-c', config], remove }
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
  refresh?: string[]
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
      let current = singleServing(deployments)!
      let refresh = annotation(current).split('\n')[0] == siblingMessage(digest)
        ? undefined
        : [
          'versions',
          'deploy',
          `${current.versions[0].version_id}@100%`,
          '--yes',
          '-c',
          config,
          ...envs(args),
          '--message',
          siblingMessage(digest),
        ]
      return {
        args,
        config,
        root,
        started,
        code: refresh ? undefined : 0,
        refresh,
        remove,
      }
    }
    let annotated = [...args]
    let message = annotated.indexOf('--message')
    if (message >= 0) {
      annotated[message + 1] = siblingMessage(
        digest,
        annotated[message + 1].slice(0, 40),
      )
    } else annotated.push('--message', siblingMessage(digest))
    return { args: annotated, config, root, started, bundle, remove }
  } catch (error) {
    remove()
    throw error
  }
}

/** Upload only a changed, successfully prepared sibling. Image preparation
 * remains on this side of the deploy guard. */
export let uploadSibling = async (
  { args, config, root, started, code, refresh, bundle }: PreparedSibling,
  run: (args: string[], unpinned?: boolean) => Promise<number>,
  wrangler = WRANGLER,
  ensure = imaged,
) => {
  if (code != null) return code
  if (refresh) return await run(refresh, true)
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
// Workers Builds runs one build per push that changes the watched source
// (`WATCHED`), and the builds finish in whatever order they finish. A deploy stops when a
// newer build has source to deploy, or a newer version is already live. Other
// pushes do not start a build, so they must not supersede the last one.
// A live version that is neither behind nor ahead (a commit that never reached
// main) is replaced: main is what runs. What could not be read is printed.
// The tracker's deploy (workers/tracker/deploy.ts) asks the same with the
// watched paths of its own trigger.
//
// The door looks once as the build starts (`seen`), beside its preparation,
// and asks main's tip again as each upload starts (`again`): bundling, images
// and sibling uploads can take minutes, and a newer push's build can go live
// in them, so an answer from the start alone can let an older build go live
// over a newer one.

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

/** The production trigger's build watch paths (README.md), as git pathspecs:
 * a push that changes none of these starts no build, so it neither supersedes
 * this one nor leaves main ahead of what is live (packages/admin/catchup.ts).
 * A test, a README or an app alone changes none. */
export let WATCHED = [
  'workers/yak',
  'packages',
  'src',
  'deno.json',
  'deno.lock',
  ':(exclude,glob)**/*_test.*',
  ':(exclude,glob)**/README.md',
  ':(exclude,glob).github/**',
  ':(exclude,glob)bench/**',
]

// Fetches a commit a shallow clone lacks: its ancestry alone (`tree:0`), or
// with its trees (`blob:none`) to compare it, never historical file contents.
let fetched = async (
  root: string,
  sha: string,
  filter: 'tree:0' | 'blob:none',
  read = git,
) => {
  if (!(await read(root, 'cat-file', '-e', `${sha}^{commit}`)).code) return
  await timed(`Git ${filter} ${short(sha)}`, () =>
    read(
      root,
      'fetch',
      '--quiet',
      '--no-tags',
      `--filter=${filter}`,
      'origin',
      sha,
    ))
}

// A watched path as the trigger means it, from the repository's top: git reads
// a pathspec from the directory it runs in, and a deploy runs in its Worker's.
let top = (spec: string) =>
  spec.startsWith(':(') ? `:(top,${spec.slice(2)}` : `:(top)${spec}`

/** Whether the watched source differs between two commits, so the later one
 * starts a build; fetches what `root`'s clone lacks, and is null when git
 * cannot tell. `root` is any directory of the checkout, and a Worker with a
 * build trigger of its own names its paths. */
export let changed = async (
  root: string,
  from: string,
  to: string,
  watched = WATCHED,
  read = git,
): Promise<boolean | null> => {
  for (let sha of [from, to]) await fetched(root, sha, 'blob:none', read)
  let { code } = await read(
    root,
    'diff',
    '--quiet',
    from,
    to,
    '--',
    ...watched.map(top),
  )
  return code == 0 ? false : code == 1 ? true : null
}

// main's tip at the remote, or null when the remote could not be asked.
let tipOf = async (root: string, read = git) => {
  let asked = await read(root, 'ls-remote', 'origin', 'refs/heads/main')
  return asked.code ? null : SHA.exec(asked.out)?.[0] ?? null
}

// Whether the watched source changed between this commit and main's tip.
let moved = (
  root: string,
  head: string,
  tip: string | null,
  watched = WATCHED,
  read = git,
) => tip && tip != head ? changed(root, head, tip, watched, read) : false

/**
 * What a deploy from `root`'s checkout sees, given the commits live now. A
 * shallow clone can lack both older and newer live commits. Fetch their
 * ancestry without trees or blobs; comparing watched source at main's tip
 * needs trees, but never historical file contents.
 */
export let seen = async (
  root: string,
  live: string[] | Promise<string[]>,
  watched = WATCHED,
  read = git,
): Promise<Seen> => {
  let [checked, tip, named] = await Promise.all([
    read(root, 'rev-parse', 'HEAD'),
    tipOf(root, read),
    live,
  ])
  let head = checked.out
  let change = await moved(root, head, tip, watched, read)
  let ahead = async (sha: string) => {
    if (sha == head) return false
    await fetched(root, sha, 'tree:0', read)
    let { code } = await read(root, 'merge-base', '--is-ancestor', head, sha)
    return code == 0 ? true : code == 1 ? false : null
  }
  return {
    head,
    tip,
    changed: change,
    live: await Promise.all(
      named.map(async (sha) => ({ sha, ahead: await ahead(sha) })),
    ),
  }
}

/** What a deploy sees as an upload starts: its first look (`seen`) with
 * main's tip asked again. A version ahead of this commit goes live only from a
 * newer commit on main, so while the tip has not moved the first look stands,
 * for one `ls-remote`; a tip that cannot be read leaves it standing too. */
let again = async (
  root: string,
  saw: Seen,
  watched = WATCHED,
  read = git,
): Promise<Seen> => {
  let tip = await tipOf(root, read)
  return !tip || tip == saw.tip ? saw : {
    ...saw,
    tip,
    changed: await moved(root, saw.head, tip, watched, read),
  }
}

/** The deploy door's guard over the first look `look` gives: `first` answers
 * it beside the build's preparation, and `still` answers {@link again} as
 * each upload starts. Main only moves on, so a refusal stands for every upload
 * after it. */
export let guard = (
  root: string,
  look: () => Promise<Seen>,
  watched = WATCHED,
  read = git,
  note = console.log,
) => {
  let looked: Promise<Seen> | undefined
  let once = () => looked ??= look()
  let refused: string | null = null
  let decide = (saw: Seen) => {
    refused ??= superseded(saw)
    if (refused) note(`not deploying: ${refused}`)
    return !refused
  }
  return {
    first: async () => {
      let saw = await once()
      let live = saw.live.map((l) =>
        short(l.sha) + (l.ahead == null ? '?' : '')
      )
      note(
        `deploy ${short(saw.head)}: main at ${
          saw.tip ? short(saw.tip) : '(unread)'
        }, live ${live.join(' ') || '(unread)'}`,
      )
      return decide(saw)
    },
    still: async () =>
      !refused && decide(await again(root, await once(), watched, read)),
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
  let door = guarded
    ? guard(
      dir,
      () => seen(dir, readied.then(() => serving(envs(argv), wrangler))),
    )
    : undefined
  let inspect = async () => door ? await door.first() : true
  let still = async () => door ? await door.still() : true
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
  let stopped = new AbortController()
  // A signal to this door reaches wrangler too; otherwise a stopped `tail`
  // leaves wrangler streaming and its reader waiting on a pipe that never
  // closes (verify-deploy.ts hung ten minutes on a three-minute tail). The
  // child is npx, which does not pass a signal to the wrangler it spawned, so
  // the whole subtree is signalled, deepest first. Through kill(1), not
  // Deno.kill: that needs the unrestricted run permission, and this door
  // runs with an allowlist (npm, npx, git, pgrep, kill, docker, env).
  for (let signal of ['SIGINT', 'SIGTERM'] as const) {
    Deno.addSignalListener(signal, () => {
      stopped.abort()
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
  let run = (argv: string[], unpinned = false) =>
    runStep(argv, async (argv) => {
      console.log(
        `Wrangler ${command(argv)} ${
          argv.includes('-c') ? argv[argv.indexOf('-c') + 1] : 'wrangler.toml'
        }: starting at ${((performance.now() - started) / 1000).toFixed(3)}s`,
      )
      let [cmd, ...args] = unpinned
        ? ['env', ...PINNED.flatMap((v) => ['-u', v]), ...wrangler]
        : wrangler
      let capture = deploying(argv)
      let log = capture ? Deno.makeTempFileSync({ suffix: '.log' }) : undefined
      try {
        let child = new Deno.Command(cmd, {
          args: [...args, ...argv],
          cwd: dir,
          ...(log
            ? {
              env: {
                WRANGLER_LOG_PATH: log,
                WRANGLER_WRITE_LOGS: 'true',
                WRANGLER_LOG_SANITIZE: 'true',
              },
              stdout: 'piped' as const,
              stderr: 'piped' as const,
            }
            : {}),
        }).spawn()
        children.add(child)
        try {
          let completed = await Promise.allSettled([
            child.status,
            capture ? forwarded(child.stdout, Deno.stdout) : '',
            capture ? forwarded(child.stderr, Deno.stderr) : '',
          ])
          for (let result of completed) {
            if (result.status == 'rejected') throw result.reason
          }
          let [status, stdout, stderr] = completed.map((result) =>
            (result as PromiseFulfilledResult<unknown>).value
          ) as [Deno.CommandStatus, string, string]
          return {
            code: status.code,
            output: `${stdout}\n${stderr}`,
            log: log ? logTail(log) : '',
          }
        } finally {
          children.delete(child)
        }
      } finally {
        if (log) Deno.removeSync(log)
      }
    }, { signal: stopped.signal, allowed: still })
  let made = preparing()
  let readied = made.dependencies.then(() => {
    // Choose after npm has installed: a cold checkout has this pin now too.
    wrangler = ['env', executable]
  })
  let inspected = inspect()
  let uploads = new Map(
    siblings(argv).map((args) => [
      args[args.indexOf('-c') + 1],
      preflight(
        () => readied,
        () => inspected,
        () => prepareSibling(args, wrangler),
        async (prepared) => uploadSibling(await prepared, run, wrangler),
        () => made.all,
      ),
    ]),
  )
  let kernel = preflight(
    () => Promise.all([readied, made.catalog]),
    () => inspected,
    async () => {
      let bundle = await bundled(
        argv,
        (output, meta) =>
          generated('Kernel modules', [join(dir, 'bundle.ts'), output, meta]),
      )
      try {
        let bound = argv.some((a) => /^(-c|--config)(=|$)/.test(a))
          ? { args: bundle.args, remove: () => {} }
          : await modelBound(bundle.args, (args) =>
            new Deno.Command('env', {
              args: [...PINNED.flatMap((v) => ['-u', v]), ...wrangler, ...args],
              cwd: dir,
              stdout: 'piped',
              stderr: 'piped',
            }).output())
        return {
          args: bound.args,
          remove: () => {
            bound.remove()
            bundle.remove()
          },
        }
      } catch (error) {
        bundle.remove()
        throw error
      }
    },
    (bundle) =>
      runWrangler(
        argv,
        (args, unpinned) =>
          unpinned ? uploads.get(args[args.indexOf('-c') + 1])! : run(args),
        async () => (await bundle).args,
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
