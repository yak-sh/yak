#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net=registry.cloudflare.com,api.cloudflare.com --allow-env --allow-sys=uid --allow-run=deno,node,pnpm,git,pgrep,kill,docker,env
// The one door to this Worker's wrangler: `deno task deploy:yak`,
// `deno task dev:yak`, their `-staging` variants and the test runner
// (bin/test.ts) all come through here, so the pinned version is written once
// and `node_modules` is current before wrangler reads it.
//
// pnpm installs the repository workspace before bundling. Package manifests
// own dependencies and exports, so esbuild follows the same names as Deno.

// The workspace pins Wrangler; every caller runs that installed package.
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
// Installation is shared with the rest of the pnpm workspace.
import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
import { command as spawnCommand } from '@yaks/process/command'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { stripVTControlCharacters } from 'node:util'
import { parse, stringify } from 'smol-toml'
import pinned from 'wrangler/package.json' with { type: 'json' }
import { imaged } from './sandbox/base.ts'
import { installed } from '@yaks/cli/dependencies'
import { assets } from './asset-ready.ts'
import { from as sources, plan } from './sheet-assets.ts'
import { backoff, once, sleep } from '@yaks/fp'
import { credentials, type Reads, reads } from './deployed.ts'
export { stale } from '@yaks/cli/dependencies'

export let WRANGLER_VERSION = pinned.version
export let WRANGLER = [
  'node',
  fileURLToPath(
    new URL(pinned.bin.wrangler, import.meta.resolve('wrangler/package.json')),
  ),
]

export let dir = fileURLToPath(new URL('./', import.meta.url)).replace(
  /\/$/,
  '',
)

let repo = fileURLToPath(new URL('../../', import.meta.url))

// What serves, read through one `wrangler auth token` the first read asks
// for: every read waits for pnpm to install the pinned Wrangler first.
let cloudflare = reads(dir, once(() => credentials(WRANGLER, dir)))

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
  let result = await spawnCommand('deno', {
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

let modules = (root: string, quiet: boolean) =>
  timed('pnpm dependencies', () => installed(resolve(root, '../..')), quiet)

let preparing = (
  root = dir,
  quiet = false,
  dependencies: () => Promise<boolean> = () => modules(root, quiet),
) =>
  readiness({
    dependencies,
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
 * the one that started it already did. Answers whether pnpm installed. `quiet`
 * says only what failed: a test run's reader acts on nothing else. Without
 * `assets`, only node_modules: a run none of whose files read a generated
 * asset leaves them as they are. */
export let ready = async (
  quiet = false,
  {
    root = dir,
    assets: made = true,
    prepared,
  }: {
    root?: string
    assets?: boolean
    prepared?: (outputs: readonly string[]) => void
  } = {},
) => {
  if (system.env.get(READIED) == root) return false
  let dependencies = modules(root, quiet)
  let make = async () => {
    await preparing(root, quiet, () => dependencies).all
  }
  let artifacts = made && assets(repo, root, make)
  let completed = await Promise.allSettled([
    dependencies,
    artifacts,
  ])
  for (let result of completed) {
    if (result.status == 'rejected') throw result.reason
  }
  if (artifacts) prepared?.(await artifacts)
  let changed = await dependencies
  if (made) system.env.set(READIED, root)
  return changed
}

// Wrangler accepts --env on either side of the command. Both forms need
// the same commit annotation, so production and staging identify one build.
export let command = (args: string[]) => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] == '--env' || args[i] == '-e') i++
    else if (!args[i].startsWith('--env=')) return args[i]
  }
}

export type StepResult = { code: number; output: string; log?: string }

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
let REQUEST =
  /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/\S+) -> (\d{3})\b[^\n]*/
let transient = ({ output, log = '' }: StepResult) => {
  output = stripVTControlCharacters(output).split('[ERROR]').at(-1)!
  if (INTERNAL.test(output)) return true
  let malformed = output.includes('Received a malformed response from the API')
  let failed = /A request to the Cloudflare API(?: \([^\n]+\))? failed\./.exec(
    output,
  )
  if (!malformed && !failed) return false
  if (failed && RACED.test(output)) return true
  let request = REQUEST.exec(output)
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

/** What a failed Wrangler run throws. Cloudflare's API failing is one
 * fault, whichever endpoint and caller met it, so one outage files one bug. */
export let failure = (args: string[], result: StepResult): Error => {
  let output = stripVTControlCharacters(result.output)
  if (!transient(result)) {
    return new Error(
      `wrangler ${command(args)} exited ${result.code}: ${output}`,
    )
  }
  let request = REQUEST.exec(output)?.[0]
  return Object.assign(
    new Error(`Cloudflare's API failed${request ? `: ${request}` : ''}`),
    { fault: 'cloudflare api failed' },
  )
}

/** Run Wrangler until it succeeds, fails for good, or a passing Cloudflare
 * API outage outlasts `attempts`, each retry waiting longer than the last. An
 * interrupted run (130, 143) is never retried; `execute` sees an aborted
 * signal itself, since `wait` returns as soon as it aborts. This is the one
 * place a transient API failure is retried, for the deploy door and for every
 * read the box makes. */
export let retried = async <T extends StepResult>(
  args: string[],
  execute: () => Promise<T>,
  { wait = sleep, signal, attempts = 3 }: {
    wait?: typeof sleep
    signal?: AbortSignal
    attempts?: number
  } = {},
): Promise<T> => {
  for (let attempt = 1;; attempt++) {
    let result = await execute()
    if (
      !result.code || result.code == 130 || result.code == 143 ||
      attempt >= attempts || !transient(result)
    ) return result
    let ms = backoff(attempt)
    console.log(
      `Temporary Cloudflare API failure; retrying Wrangler ${
        command(args)
      } (attempt ${attempt + 1}/${attempts}) in ${ms / 1000}s`,
    )
    await wait(ms, signal)
  }
}

/** Run one Wrangler step, keeping its arguments and exit code. The command
 * boundary supplies diagnostics; the timer and signal belong to the caller.
 * Deploys get three attempts; permanent failures and other commands get one.
 * Each attempt that would change what serves first asks `allowed`, the deploy
 * guard as it stands then; one it refuses deploys nothing and exits 0. One
 * that went live then runs `landed`, which looks at what it replaced. */
export let runStep = async (
  args: string[],
  execute: (args: string[]) => Promise<StepResult>,
  { wait = sleep, signal, allowed, landed }: {
    wait?: typeof sleep
    signal?: AbortSignal
    allowed?: () => Promise<boolean>
    landed?: () => Promise<unknown>
  } = {},
): Promise<number> => {
  let promotes = deploying(args) && !args.includes('--dry-run')
  let { code } = await retried(args, async () => {
    if (signal?.aborted) return { code: 130, output: '' }
    if (promotes && allowed && !await allowed()) return { code: 0, output: '' }
    let result = await execute(args)
    if (promotes && !result.code && landed) await landed()
    return result
  }, { wait, signal, attempts: deploying(args) ? 3 : 1 })
  return code
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
    using file = io.openSync(path)
    let bytes = new Uint8Array(Math.min(file.statSync().size, 65536))
    file.seekSync(-bytes.length, io.SeekMode.End)
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
// entrypoint; yak-esbuild (esbuild/) is what the ESBUILD binding compiles
// an app with at deploy (@yaks/esbuild), in a container of its own;
// yak-raster (raster/) is what the RASTER binding draws an app's icon.svg
// with; yak-browser (browser/) is what the BROWSER binding renders a draft
// with for app_preview; yak-sandbox (sandbox/) holds the Sandbox object and
// container the WORKBENCH binding names; and yak-front (front/) is what answers the cached
// pages in front of this Worker. Each exists before this Worker's bindings
// name it, except yak-front, whose bindings name this Worker: a missing
// entrypoint there only fails its use receipts until this deploy finishes,
// seconds later.
export let SIBLINGS = [
  'outbound/wrangler.toml',
  'esbuild/wrangler.toml',
  'raster/wrangler.toml',
  'browser/wrangler.toml',
  'sandbox/wrangler.toml',
  'front/wrangler.toml',
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
  let parsed = parse(io.readTextFileSync(path)) as Containers & {
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
    out[relative(root, file)] = io.readFileSync(file)
  }
  let walk = (at: string) => {
    for (let entry of io.readDirSync(at)) {
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
      stat = io.statSync(file)
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

/// beganIn(versionMessage('739f56b25cae820c8541a8b4a1ade2f7a6c7e9be A subject', new Date(0))) -> 0
/// beganIn('739f56b25cae820c8541a8b4a1ade2f7a6c7e9be A subject') -> undefined
/** The kernel version's message: its commit and subject, then when this door
 * began the deploy that made it. Cloudflare cuts a deployment's copy to 50
 * characters, so the `began:` line lives on the version alone. */
export let versionMessage = (commit: string, began: Date) =>
  `${commit}\nbegan:${began.toISOString()}`

/** When the deploy door began the deploy that made a version (ms), as its
 * message's `began:` line says; a version deployed before the line, nothing. */
export let beganIn = (message?: string): number | undefined => {
  let at = Date.parse(message?.match(/^began:(\S+)$/m)?.[1] ?? '')
  return Number.isFinite(at) ? at : undefined
}

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
  let parsed = parse(io.readTextFileSync(path)) as Containers & {
    env?: Record<string, Containers>
  }
  let refs = new Map<string, string>()
  for (let part of [parsed, ...Object.values(parsed.env ?? {})]) {
    for (let container of part.containers ?? []) {
      let image = container.image
      if (!image) continue
      let dockerfile = join(dirname(path), image)
      try {
        if (io.statSync(dockerfile).isDirectory) {
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
  let temp = io.makeTempFileSync({
    dir: dirname(path),
    prefix: '.images-',
    suffix: '.toml',
  })
  try {
    io.writeTextFileSync(temp, stringify(parsed))
  } catch (error) {
    io.removeSync(temp)
    throw error
  }
  return { config: relative(root, temp), remove: () => io.removeSync(temp) }
}

type Bundle = { entry: string; output: string }

// The executor has an independent Builds connection. Naming it before that
// project publishes its first release would prevent kernel deployment, so
// only a fully serving release grants the kernel its service binding.

/** The executor's release name when these arguments are a production deploy
 * and it fully serves; nothing otherwise. Reads no bundle, so it runs while
 * the kernel bundles. */
export let executor = async (
  args: string[],
  read: Reads['deployments'] = cloudflare.deployments,
  root = dir,
): Promise<string | undefined> => {
  if (
    command(args) != 'deploy' || envs(args).length ||
    args.some((arg) => /^--dry-run(=|$)/.test(arg))
  ) return
  let model = '../model/wrangler.toml'
  let name = parse(io.readTextFileSync(join(root, model))).name
  if (typeof name != 'string') {
    throw Error('Executor config has no release name')
  }
  if (!singleServing(await read(model))) {
    console.log(
      `${name}: no fully serving executor release; hosted calls remain inline`,
    )
    return
  }
  return name
}

/** These arguments with the serving executor {@link executor} named bound as
 * MODEL, through a disposable config beside theirs; unchanged without one. */
export let modelBound = (
  args: string[],
  name: string | undefined,
  root = dir,
) => {
  if (!name) return { args, remove: () => {} }
  let at = args.indexOf('-c')
  let path = resolve(root, at >= 0 ? args[at + 1] : 'wrangler.toml')
  let parsed = parse(io.readTextFileSync(path))
  let services = Array.isArray(parsed.services) ? parsed.services : []
  parsed.services = [
    ...services.filter((service) =>
      !service || typeof service != 'object' || !('binding' in service) ||
      service.binding != 'MODEL'
    ),
    { binding: 'MODEL', service: name },
  ]
  let config = io.makeTempFileSync({
    dir: dirname(path),
    prefix: '.model-',
    suffix: '.toml',
  })
  try {
    io.writeTextFileSync(config, stringify(parsed))
  } catch (error) {
    io.removeSync(config)
    throw error
  }
  let bound = [...args]
  if (at >= 0) bound[at + 1] = relative(root, config)
  else bound.push('-c', relative(root, config))
  console.log(`${name}: serving executor bound as MODEL`)
  return { args: bound, remove: () => io.removeSync(config) }
}

let bundleEntry = (output: string, meta: string, base: string): Bundle => {
  let { outputs } = JSON.parse(io.readTextFileSync(meta)) as {
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
  io.removeSync(meta)
  return { entry, output }
}

/** Every environment's assets answer this deploy's content-named files without
 * the Worker. Exact names, because an excepted path that misses never reaches
 * it, and a page held from before a deploy names the sheet it replaced. */
export let direct = (
  config: Record<string, unknown>,
  names: Record<string, string>,
) => {
  let first = ['/*', ...Object.values(names).map((name) => `!/${name}`)]
  let environments = Object.values(config.env ?? {}) as typeof config[]
  for (let { assets } of [config, ...environments]) {
    if (assets) Object.assign(assets, { run_worker_first: first })
  }
  return config
}

// Keep relative bindings, assets and image paths beside their original config.
// These modules already contain the pin's transforms and source maps.
let unbundled = async (
  from: string,
  { entry, output }: Bundle,
  root: string,
) => {
  let path = join(root, from)
  let parsed = parse(io.readTextFileSync(path))
  if (parsed.assets) {
    direct(parsed, plan(await sources(join(dirname(path), 'public'))).names)
  }
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
  let config = io.makeTempFileSync({
    dir: dirname(path),
    prefix: '.bundle-',
    suffix: '.toml',
  })
  try {
    io.writeTextFileSync(config, stringify(parsed))
    return config
  } catch (error) {
    io.removeSync(config)
    throw error
  }
}

let scratch = (root: string, prefix: string): string => {
  let dir = join(root, '.wrangler')
  io.mkdirSync(dir, { recursive: true })
  return io.makeTempDirSync({ dir, prefix })
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
  let output = scratch(root, 'kernel-')
  let config: string | undefined
  let remove = () => {
    if (config) io.removeSync(config)
    io.removeSync(output, { recursive: true })
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
    config = await unbundled('wrangler.toml', {
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
    spawnCommand('env', {
      args: [...PINNED.flatMap((v) => ['-u', v]), ...wrangler, ...argv],
      cwd: root,
      stdout: 'piped',
      stderr: 'piped',
    }).output(),
  read: Reads = cloudflare,
): Promise<PreparedSibling> => {
  let config = args[args.indexOf('-c') + 1]
  let started = performance.now()
  if (args.includes('--dry-run')) {
    return { args, config, root, started, remove: () => {} }
  }
  let output = scratch(root, 'sibling-')
  let remove = () => io.removeSync(output, { recursive: true })
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
      Promise.resolve().then(() => read.deployments(config, envs(args))),
    ])
    if (bundled.status == 'rejected') throw bundled.reason
    let built = bundled.value
    let deployments = serving.status == 'fulfilled' ? serving.value : undefined
    if (!built.success) {
      console.error(new TextDecoder().decode(built.stderr))
      return { args, config, root, started, code: built.code, remove }
    }
    let bundle = bundleEntry(output, meta, dirname(join(root, config)))
    let modules: Record<string, Uint8Array> = {}
    for (let file of io.readDirSync(output)) {
      // Wrangler emits these beside the actual multipart upload modules.
      if (
        file.isFile && file.name != 'README.md' && !file.name.endsWith('.map')
      ) {
        modules[file.name] = io.readFileSync(join(output, file.name))
      }
    }
    Object.assign(modules, images(config, root))
    let digest = siblingDigest(
      JSON.stringify({
        config: io.readTextFileSync(join(root, config)),
        // The pin, not where this checkout installed it: every worktree's
        // deploy of the same inputs finds the same upload already serving.
        wrangler: WRANGLER_VERSION,
        // Flags can override config bindings too; the commit annotation alone
        // changes on every push and is not part of the serving code.
        args: args.filter((arg, i) =>
          arg != '--message' && args[i - 1] != '--message'
        ),
      }),
      modules,
    )
    // Cloudflare may cut deployment messages to 50 characters; the full
    // annotation remains on the sole serving version.
    let same = await sameServing(
      digest,
      deployments,
      async (id) => await read.version(config, id, envs(args)) ?? null,
    )
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
    if (bundle) artifact = await unbundled(image.config, bundle, root)
    annotated[annotated.indexOf('-c') + 1] = artifact ?? image.config
    result = await run(annotated, true)
  } finally {
    if (artifact) io.removeSync(artifact)
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
  let out = spawnCommand('pgrep', { args: ['-P', String(pid)] })
    .outputSync()
  let kids = new TextDecoder().decode(out.stdout).split('\n').filter(Boolean)
    .map(Number)
  return kids.flatMap((kid) => [...descendants(kid), kid])
}

// ---- which commit may go live ----------------------------------------------
//
// Builds finish in any order. A completed build may deploy unless a newer
// commit is already live. Read live versions again before each upload and
// retry: a newer build can finish while this one prepares or waits. A check
// before an upload cannot see a newer build that goes live during it, so two
// builds that both looked before either went live both deploy, and the last
// to finish serves (9c39a10f went live 3 s after its child d348e1ab on
// 2026-11-05). Cloudflare deploys without comparing what it replaces, so the
// door looks after its deploy too (`undo`): when the release it replaced
// carries a commit ahead of its own, it puts that release back.

/** This build's commit and the commits live now, with whether each is ahead
 * of this one (null when git cannot tell). */
export type Seen = {
  head: string
  live: { sha: string; ahead: boolean | null }[]
}

let short = (sha: string) => sha.slice(0, 8)

/** Why this commit must not go live, or null when it may. */
export let superseded = ({ head, live }: Seen): string | null => {
  let newer = live.find((l) => l.ahead)
  return newer
    ? `${short(newer.sha)} is live and ahead of ${short(head)}`
    : null
}

let git = async (root: string, ...args: string[]) => {
  let r = await spawnCommand('git', {
    args,
    cwd: root,
    stdout: 'piped',
    stderr: 'null',
  }).output()
  return { code: r.code, out: new TextDecoder().decode(r.stdout).trim() }
}

let SHA = /^[0-9a-f]{40}\b/

/** The production trigger's build watch paths (README.md), as git pathspecs.
 * The deploy catch-up compares these to find source that needs a build. */
export let WATCHED = [
  'workers/yak',
  'packages',
  'src',
  'deno.json',
  'deno.lock',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  'bin/build-yak',
  'bin/build-tools',
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

/** What a deploy from `root`'s checkout sees, given the commits live now.
 * Fetch ancestry a shallow clone lacks, without trees or file contents. */
export let seen = async (
  root: string,
  live: string[] | Promise<string[]>,
  read = git,
): Promise<Seen> => {
  let [checked, named] = await Promise.all([
    read(root, 'rev-parse', 'HEAD'),
    live,
  ])
  let head = checked.out
  return {
    head,
    live: await Promise.all(
      named.map(async (sha) => ({
        sha,
        ahead: await aheadOf(root, head, sha, read),
      })),
    ),
  }
}

/** Whether `sha` descends from `head` (null when git cannot tell), fetching
 * the ancestry a shallow clone lacks. */
export let aheadOf = async (
  root: string,
  head: string,
  sha: string,
  read = git,
): Promise<boolean | null> => {
  if (sha == head) return false
  await fetched(root, sha, 'tree:0', read)
  let { code } = await read(root, 'merge-base', '--is-ancestor', head, sha)
  return code == 0 ? true : code == 1 ? false : null
}

/** A deployment of the Worker, newest first: the commit its message names,
 * its one version at 100% (null when split or unread), its message, and
 * whether its commit is ahead of this build's. */
export type Release = {
  sha: string | null
  version: string | null
  message: string
  ahead: boolean | null
}

/// let ours = { sha: 'a', version: 'v2', message: 'a', ahead: false }
/// let newer = { sha: 'b', version: 'v1', message: 'b', ahead: true }
/// overtook('a', [ours, newer])?.version -> 'v1'
/// overtook('a', [ours, { ...newer, ahead: false }]) -> undefined
/// overtook('a', [ours, { ...newer, ahead: null }]) -> undefined
/// overtook('a', [ours, { ...newer, version: null }]) -> undefined
/// overtook('a', [newer, ours]) -> undefined
/// overtook('a', [ours]) -> undefined
/** The release this build's deploy replaced, when its commit is ahead of this
 * build's: an older build that finished last went live over a newer one. Only
 * while this build's deploy is the newest; a later one answers for itself. */
export let overtook = (head: string, releases: Release[]) => {
  let [now, before] = releases
  return now?.sha == head && before?.ahead && before.version
    ? before
    : undefined
}

/** After this build went live, puts back the release it replaced when that
 * release is ahead of it ({@link overtook}), through `restore`. */
export let undo = (
  head: string,
  releases: () => Promise<Release[]>,
  restore: (release: Release) => Promise<number>,
  note = console.log,
) =>
async () => {
  let newer = overtook(head, await releases())
  if (!newer) return false
  note(
    `${short(head)} went live over ${short(newer.sha!)}, which is ahead of ` +
      `it; restoring version ${newer.version}`,
  )
  return !await restore(newer)
}

/** The deploy guard looks beside preparation (`first`) and reads fresh live
 * versions before each upload (`still`). Once a newer commit is live, this
 * build leaves it serving for every remaining upload. */
export let guard = (
  look: () => Promise<Seen>,
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
      note(`deploy ${short(saw.head)}: live ${live.join(' ') || '(unread)'}`)
      return decide(saw)
    },
    still: async () => !refused && decide(await look()),
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

// The kernel's deployments in an environment, newest first; none unread.
let deployments = async (env: string[]): Promise<Deployment[]> => {
  let all = await cloudflare.deployments('wrangler.toml', env)
  return (Array.isArray(all) ? all as Deployment[] : [])
    .toSorted((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))
}

/** The commits the versions live now were deployed from, as the message this
 * door gives every version says (`--message` below), in the deploy's own
 * environment. Anything wrangler will not answer names no commit. */
let serving = async (env: string[]): Promise<string[]> => {
  let [now] = await deployments(env)
  let annotated = SHA.exec(annotation(now ?? null))?.[0]
  if (
    now?.versions.length == 1 && now.versions[0].percentage == 100 && annotated
  ) return [annotated]
  let named = await Promise.all(
    (now?.versions ?? []).filter((v) => v.percentage > 0).map(async (v) => {
      let version = await cloudflare.version('wrangler.toml', v.version_id, env)
      return SHA.exec(annotation(version ?? null))?.[0]
    }),
  )
  return named.filter((sha) => sha != null)
}

/** The Worker's two newest deployments as {@link Release}s for `head`. */
let releases = async (head: string, env: string[]) =>
  Promise.all(
    (await deployments(env)).slice(0, 2).map(
      async (d): Promise<Release> => {
        let message = annotation(d)
        let sha = SHA.exec(message)?.[0] ?? null
        let [one] = d.versions
        return {
          sha,
          version: d.versions.length == 1 && one.percentage == 100
            ? one.version_id
            : null,
          message,
          ahead: sha ? await aheadOf(dir, head, sha) : null,
        }
      },
    ),
  )

if (import.meta.main) {
  let began = new Date()
  let started = performance.now()
  let argv = [...system.args]
  let wrangler = WRANGLER
  let guarded = command(argv) === 'deploy' && !argv.includes('--dry-run')
  let door = guarded
    ? guard(() => seen(dir, readied.then(() => serving(envs(argv)))))
    : undefined
  let inspect = async () => door ? await door.first() : true
  let still = async () => door ? await door.still() : true
  let head = ''
  if (command(argv) === 'deploy') {
    // Versions carry their commit so `yak admin deploys` need not infer it by
    // time, and when this door began, which the deploy catch-up times.
    let commit = await spawnCommand('git', {
      args: ['log', '-1', '--format=%H %s'],
      cwd: dir,
      stdout: 'piped',
      stderr: 'inherit',
    }).output()
    if (!commit.success) system.exit(commit.code)
    let line = new TextDecoder().decode(commit.stdout).trim()
    head = line.split(' ')[0]
    argv.push('--message', versionMessage(line, began))
  }
  let children = new Set<system.ChildProcess>()
  let stopped = new AbortController()
  // A signal to this door reaches wrangler too; otherwise a stopped `tail`
  // leaves wrangler streaming and its reader waiting on a pipe that never
  // closes (verify-deploy.ts hung ten minutes on a three-minute tail). The
  // whole subtree is signalled, deepest first. Through kill(1), not
  // system.kill: that needs the unrestricted run permission, and this door
  // runs with an allowlist (node, pnpm, git, pgrep, kill, docker, env).
  for (let signal of ['SIGINT', 'SIGTERM'] as const) {
    system.addSignalListener(signal, () => {
      stopped.abort()
      let pids = [...children].flatMap((child) => [
        ...descendants(child.pid),
        child.pid,
      ]).map(String)
      if (!pids.length) return
      spawnCommand('kill', {
        args: ['-s', signal.slice(3), ...pids],
        stderr: 'null',
      }).spawn()
    })
  }
  // env(1) execs wrangler in its own place, so the pid signalled is the same.
  let run = (argv: string[], unpinned = false): Promise<number> =>
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
      let log = capture ? io.makeTempFileSync({ suffix: '.log' }) : undefined
      try {
        let child = spawnCommand(cmd, {
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
            capture ? forwarded(child.stdout, system.stdout) : '',
            capture ? forwarded(child.stderr, system.stderr) : '',
          ])
          for (let result of completed) {
            if (result.status == 'rejected') throw result.reason
          }
          let [status, stdout, stderr] = completed.map((result) =>
            (result as PromiseFulfilledResult<unknown>).value
          ) as [system.CommandStatus, string, string]
          return {
            code: status.code,
            output: `${stdout}\n${stderr}`,
            log: log ? logTail(log) : '',
          }
        } finally {
          children.delete(child)
        }
      } finally {
        if (log) io.removeSync(log)
      }
    }, {
      signal: stopped.signal,
      allowed: still,
      // A sibling's message names its inputs, not its commit, and an older
      // sibling with the same inputs serves the same code; a restore is not
      // looked after again.
      landed: guarded && !unpinned && command(argv) == 'deploy'
        ? undo(
          head,
          () => releases(head, envs(argv)),
          ({ version, message }) =>
            run([
              'versions',
              'deploy',
              `${version}@100%`,
              '--yes',
              '--message',
              message,
              ...envs(argv),
            ]),
        )
        : undefined,
    })
  let made = preparing()
  let readied = made.dependencies.then(() => {
    // Choose after pnpm has installed: a cold checkout has this pin now too.
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
  // The kernel's modules read only tracked source; the catalog and the other
  // generated assets are what its upload carries, which waits for them.
  let kernel = preflight(
    () => readied,
    () => inspected,
    async () => {
      let named = argv.some((a) => /^(-c|--config)(=|$)/.test(a))
        ? Promise.resolve(undefined)
        : executor(argv)
      let [built, served] = await Promise.allSettled([
        bundled(
          argv,
          (output, meta) =>
            timed(
              'Kernel modules',
              () =>
                generated('Kernel modules', [
                  join(dir, 'bundle.ts'),
                  output,
                  meta,
                ]),
            ),
        ),
        named,
      ])
      if (built.status == 'rejected') throw built.reason
      let bundle = built.value
      try {
        if (served.status == 'rejected') throw served.reason
        let bound = modelBound(bundle.args, served.value)
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
  system.exit((completed[0] as PromiseFulfilledResult<number>).value)
}
