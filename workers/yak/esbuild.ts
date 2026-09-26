// The deploy's compile step (D-40376): what an app writes in TypeScript, or
// with an npm import, becomes code a runtime can load, at app_deploy and
// nowhere else. @yaks/esbuild says what needs compiling; yak-esbuild, the
// Worker behind the ESBUILD binding, compiles it; this file is the wiring
// between the two and the app's files.
//
// An app with nothing to compile is not compiled and nothing is called, so its
// deploy is the one it always was. For one that has:
//
// - the compiled worker goes to deploy_worker.ts in place of the source
//   modules, with any `.wasm` or `.txt` it imports carried beside it;
// - a compiled page script is kept under the app's `esbuild/` prefix and
//   served at its source's own address (files.ts), so `<script type="module"
//   src="main.ts">` just works while `main.ts` stays the file the agent wrote;
// - package-lock.json is written among the app's files when the build moved
//   it, so a version pins it and a rollback compiles the same code;
// - the seconds the compile took are counted on the space's meter beside the
//   sandbox's (meter.ts `countedSpend`), and refused at the same allowance.
//
// A compile that fails refuses the deploy with the compiler's own lines, and
// nothing here has moved: the last release's worker and pages still serve.
import type { Answer, Ask } from '@yaks/esbuild'
import { plan, Unplanned } from '@yaks/esbuild'
import type { App, Space } from './directory.ts'
import type { Module } from './dispatch.ts'
import type { Env } from './env.ts'
import { prefixOf } from './files.ts'
import { r2Objects } from './lib/objects.ts'
import { countedSpend, refusedSpend } from './meter.ts'
import { caught } from './sentry.ts'
import type { Who } from './session.ts'
import { type Ctx, refuse } from './tool.ts'
import { BUILT, own, replaced } from './versions.ts'
import { type Config, sourceOf } from './wrangler_app.ts'

export let LOCK = 'package-lock.json'

/** What the compile step hands the rest of the release. */
export type Compiled = {
  /** The compiled worker, when the server source needed compiling: the app's
   * own source path, and the modules to upload in place of it. */
  worker?: { source: string; main: string; modules: Module[] }
  /** What the deploy says about it. */
  lines: string[]
}

let encode = (text: string) => new TextEncoder().encode(text)

/** The compiler, over the binding. A failure of the binding itself is ours,
 * reported and refused in a sentence. */
let asked = async (env: Env, ask: Ask, app: App): Promise<Answer> => {
  try {
    let r = await env.ESBUILD!.fetch(
      new Request('https://esbuild.invalid/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ask),
      }),
    )
    if (!r.ok) {
      throw new Error(
        `yak-esbuild ${r.status}: ${(await r.text()).slice(0, 400)}`,
      )
    }
    let answer: Answer = await r.json()
    return answer
  } catch (e) {
    caught(e, { request: 'esbuild', app: app.slug })
    throw refuse(
      'unavailable',
      "app_deploy could not reach the compiler for this app's TypeScript " +
        'and npm imports; the files are live as written and the last ' +
        'release still serves — app_deploy again',
    )
  }
}

// What an ask names, for the deploy's answer.
let named = (ask: Ask) =>
  [
    ...(ask.worker ? [ask.worker.entry] : []),
    ...ask.pages,
  ].join(', ')

/**
 * Compile what this release of the app needs compiled, refusing the release
 * when it cannot be. `config` is the app's parsed wrangler config, and `keys`
 * every key under the app, from its root.
 */
export let compiled = async (
  ctx: Ctx,
  space: Space,
  app: App,
  who: Who,
  config: Config,
  keys: string[],
): Promise<Compiled> => {
  let blobs = r2Objects(ctx.env.BLOBS)
  let prefix = `${prefixOf(space, app)}/`
  let paths = own(keys)
  let held = keys.filter((k) => k.startsWith(BUILT))
  let read = (path: string) => blobs.read(prefix + path)
  let has = new Set(paths)
  let main = sourceOf(config, (p) => has.has(p))
  let planned
  try {
    planned = await plan({
      paths,
      read,
      main,
      flags: config.compatibility_flags,
    })
  } catch (e) {
    if (e instanceof Unplanned) throw refuse('arguments', e.message)
    throw e
  }
  let pages = planned?.ask.pages ?? []
  let drop = () =>
    Promise.all(
      held.filter((k) => !pages.includes(k.slice(BUILT.length)))
        .map((k) => blobs.delete(prefix + k)),
    )
  if (!planned) {
    await drop()
    return { lines: [] }
  }
  let { ask, notes } = planned
  if (!ctx.env.ESBUILD) {
    throw refuse(
      'unavailable',
      `${named(ask)} must be compiled, and this platform has no compiler ` +
        'bound here (ESBUILD); the files are live as written and the last ' +
        'release still serves',
    )
  }
  let no = await refusedSpend(ctx.dir, space, 'seconds', ctx.env)
  if (no) throw refuse('limit', no)
  let began = Date.now()
  let took = 0
  let answer: Answer
  try {
    answer = await asked(ctx.env, ask, app)
  } finally {
    took = (Date.now() - began) / 1000
    await countedSpend(ctx.env, space, 0, Math.max(1, Math.ceil(took)))
  }
  if (answer.errors.length) {
    throw refuse(
      'arguments',
      `could not compile ${named(ask)}:\n${answer.errors.join('\n')}\n` +
        'The files are live as written; the last release still serves.',
    )
  }
  await Promise.all(
    Object.entries(answer.pages).map(([path, code]) =>
      blobs.put(prefix + BUILT + path, encode(code))
    ),
  )
  await drop()
  let lines = [
    `compiled ${named(ask)} (${took.toFixed(1)}s)`,
    ...notes,
    ...answer.notes,
  ]
  if (answer.lock != null) {
    let was = await read(LOCK)
    if (!was || new TextDecoder().decode(was) != answer.lock) {
      await replaced(blobs, prefix, LOCK, who.person ?? '')
      await blobs.put(prefix + LOCK, encode(answer.lock))
    }
    lines.push(
      `${LOCK} pins ${answer.installed.join(', ') || 'nothing'}; the next ` +
        'deploy installs the same versions',
    )
  }
  if (!ask.worker || !answer.worker) return { lines }
  let carried = await Promise.all(
    ask.worker.carry.map(async (name): Promise<Module[]> => {
      let bytes = await read(name)
      return bytes ? [{ name, bytes }] : []
    }),
  )
  return {
    lines,
    worker: {
      source: ask.worker.entry,
      main: answer.worker.main,
      modules: [
        { name: answer.worker.main, bytes: encode(answer.worker.code) },
        ...carried.flat(),
      ],
    },
  }
}
