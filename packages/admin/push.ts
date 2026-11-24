// A directory as an app: `yak admin push apps/mail` makes the app hold exactly
// the files in that directory, through the connector's own tools (app_new,
// app_files, app_deploy), the ones any assistant calls. Git is the app's
// source of code, so a file the directory no longer has is deleted from the
// app too.
//
// A change made on the platform is carried into git, never pushed over: the
// space's Operator fixing the app, or its copy edited on the app's page
// (@yaks/copy). A file the app holds that matches no text git has of it is
// such a change. The push merges it over the checkout's file, against the
// newest text git has that the app held too: copy.json by key (@yaks/copy
// `merge`, where a key edited on the page keeps the page's text), every other
// file by line. A Git checkout commits the merge and the release uses the
// committed bytes. Where git and the platform changed
// the same source lines, the push refuses before writing anything. A conflict
// in the app's generated lock clears it from the draft so the release compiler
// regenerates it from the merged package.json.
//
// A file is sent as text when its bytes are UTF-8 and as base64 when they are
// not (an icon, a .wasm). Dotfiles are left out: nothing the platform serves
// starts with a dot, and `.DS_Store` is not part of an app.
//
// An app's pictures, PDFs, fonts and sounds are released like its code, so an
// installed copy carries them, but git does not keep their bytes
// (apps/.gitignore). A checkout that lacks one leaves the copy the app already
// holds, so the next release takes it again; only a checkout that has the
// bytes changes it. The app's own `icon.png` is kept in git like code.
//
// The one file the app holds that git need not is the package-lock.json the
// compile writes beside a package.json (workers/yak esbuild.ts): it pins what
// the deploy installed, so a push keeps it while its package.json is pushed,
// and a push that changes nothing deploys nothing.

import * as fs from '@yaks/file/io'
import * as systemProcess from '@yaks/process/system'
import { dirname } from 'node:path'

import { merge as byKey } from '@yaks/copy'
import { merge as byLine } from 'node-diff3'
import { CallError } from '@yaks/tools/errors'
import { type Reply, saidBy, valueOf } from './api.ts'

/** One file as app_files takes it. */
export type File = { path: string; content: string } | {
  path: string
  base64: string
}

/** Where a push goes: the app's slug, its space when the account has several,
 * and the title it is created with when it does not exist yet (the slug
 * unless named). */
export type Target = { app: string; space?: string; title?: string }

/** A connector call, as ./api.ts `rpc` makes one. */
export type Ask = (method: string, params?: unknown) => Promise<unknown>

/** A push's current phase, delivered before and after its slow operations. */
export type PushProgress =
  | { phase: 'list'; state: 'start' }
  | { phase: 'list'; state: 'done'; count: number }
  | { phase: 'create' | 'deploy'; state: 'start' | 'done'; deployed?: boolean }
  | { phase: 'hash'; state: 'start'; count: number }
  | {
    phase: 'hash'
    state: 'done'
    count: number
    changed: number
    removed: number
  }
  | {
    phase: 'upload'
    state: 'start' | 'done'
    done: number
    total: number
    batch: number
  }
  | {
    phase: 'delete'
    state: 'start' | 'done'
    done: number
    total: number
    path: string
  }

/** A text the app holds that git does not, merged with git's. */
export type Carried = { path: string; content: string }

/** The checkout a push reads from: each earlier text git has of a file,
 * newest first, and how the changes made on the platform reach git: written
 * into a working tree, or landed as a commit on main by a release from one. A
 * checkout that cannot keep them still carries them into the release. */
export type Checkout = {
  earlier: (path: string) => AsyncIterable<string>
  /** Save the merge, returning the bytes the checkout committed if it
   * transformed the files before committing. */
  write?: (files: Carried[]) => Promise<Carried[] | void>
}

/** A push's base version, confirmation and progress, its bounded wait for
 * the connector's file data contract, and the checkout the platform's changes
 * merge into.
 * `review: false` is a push from the app's source (the deploy catch-up's
 * release of main): a base behind live deploys from live without asking, since
 * what was deployed since (a copy edit saved on the page, another push from the
 * same source) is not lost to it. Another release going live while it writes
 * its files sends it again from that live, and a deploy that still answers it
 * deployed nothing is an error. A base ahead of live still waits for
 * `confirm`. */
export type PushOptions = {
  checkout?: Checkout
  base?: number
  confirm?: boolean
  review?: boolean
  /** Files maintained in the app and carried into each release. */
  keep?: string[]
  remember?: (version: number) => void | Promise<void>
  wait?: number
  poll?: number
  progress?: (event: PushProgress) => void
}

// An app_files write does per-file object-store and hashing work before its
// MCP request can answer. Bound both parallel work and request bytes so a
// directory with hundreds of files does not exhaust that request's deadline.
let MAX_FILES = 16
let MAX_BYTES = 256 * 1024

let batches = (files: File[]): File[][] => {
  let out: File[][] = []
  let group: File[] = []
  let bytes = 0
  for (let f of files) {
    let size = new TextEncoder().encode(JSON.stringify(f)).byteLength
    if (
      group.length && (group.length == MAX_FILES || bytes + size > MAX_BYTES)
    ) {
      out.push(group)
      group = []
      bytes = 0
    }
    group.push(f)
    bytes += size
  }
  if (group.length) out.push(group)
  return out
}

let utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

let b64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

/** A file's bytes as app_files takes them: text when they are UTF-8, base64
 * when they are not. */
export let fileOf = (path: string, bytes: Uint8Array): File => {
  try {
    return { path, content: utf8.decode(bytes) }
  } catch {
    return { path, base64: b64(bytes) }
  }
}

let bytesOf = (file: File) =>
  'content' in file
    ? new TextEncoder().encode(file.content)
    : Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))

let shaOf = async (file: File) => {
  let hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytesOf(file)),
  )
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
}

let ASSET =
  /\.(pdf|png|jpe?g|gif|webp|avif|ico|ttf|otf|woff2?|mp3|wav|ogg|m4a|mp4|webm)$/i

/// asset('yaks-stamp.png') -> true
/// asset('fonts/EBGaramond.woff2') -> true
/// asset('icon.png') -> false
/// asset('art/icon.png') -> true
/// asset('main.css') -> false
/** Whether the file at `path` is a picture, PDF, font or sound whose bytes git does
 * not keep (apps/.gitignore): every one but the app's icon. */
export let asset = (path: string) => ASSET.test(path) && path != 'icon.png'

/** Every file under `dir`, paths relative to it, dotfiles left out, sorted.
 * A link to a file is that file's bytes, so an app can serve a file kept in a
 * package (apps/yak-sh's gouache.css is @yaks/ui's); a link to a directory is
 * not walked, as an app's `api` link points at what the platform serves. */
export let read = async (dir: string): Promise<File[]> => {
  let files: File[] = []
  let walk = async (rel: string) => {
    for await (let e of fs.readDir(`${dir}/${rel}`)) {
      if (e.name.startsWith('.')) continue
      let path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory) await walk(path)
      else if (
        e.isFile || e.isSymlink && (await fs.stat(`${dir}/${path}`)).isFile
      ) {
        files.push(fileOf(path, await fs.readFile(`${dir}/${path}`)))
      }
    }
  }
  await walk('')
  return files.sort((a, b) => a.path < b.path ? -1 : 1)
}

let LOCK = 'package-lock.json'
let PACKAGE = 'package.json'

// A lock the compile wrote beside a package.json the directory still has.
let pinned = (path: string, keep: Set<string>) =>
  /(^|\/)package-lock\.json$/.test(path) &&
  keep.has(path.replace(/package-lock\.json$/, 'package.json'))

let reply = async (ask: Ask, name: string, args: Record<string, unknown>) =>
  await ask('tools/call', { name, arguments: args }) as Reply

// What a tool said, for the person running the push.
let call = async (ask: Ask, name: string, args: Record<string, unknown>) =>
  saidBy(await reply(ask, name, args))

let filesIn = (value: Record<string, unknown>) => {
  let files = value.files
  if (
    !Array.isArray(files) ||
    files.some((f) =>
      !f || typeof f != 'object' ||
      typeof (f as { path?: unknown }).path != 'string'
    )
  ) {
    throw new Error('app_files answered malformed file data')
  }
  // A checkout can reach an older Worker while its own commit deploys.
  if (
    value.unreleased == null &&
    files.every((f) => (f as { sha?: unknown }).sha == null)
  ) return null
  if (
    typeof value.unreleased != 'boolean' ||
    files.some((f) =>
      !/^[0-9a-f]{64}$/.test(String((f as { sha?: unknown }).sha))
    )
  ) throw new Error('app_files answered malformed file data')
  if (value.version == null) return null
  if (
    typeof value.version != 'number' || !Number.isSafeInteger(value.version) ||
    value.version < 0
  ) throw new Error('app_files answered malformed version data')
  return {
    held: new Map(files.map((f) => [
      (f as { path: string }).path,
      (f as { sha: string }).sha,
    ])),
    unreleased: value.unreleased,
    version: value.version,
    lockRemoved: typeof value.draft == 'string' &&
      Array.isArray(value.drafts) &&
      value.drafts.some((draft) =>
        draft?.draft == value.draft && Array.isArray(draft.paths) &&
        draft.paths.includes(LOCK)
      ) && !files.some((f) => f.path == LOCK),
  }
}

// The files an app holds, read off the list's answer as data: its words are
// for a person, and carry more than the list (the unseen block). A checkout
// may speak the new data contract before the Worker built from that checkout
// is live. Wait through that bounded rollout gap; a refusal still throws from
// `valueOf` at once, and a server that never catches up is still a defect.
let listed = async (
  ask: Ask,
  at: Record<string, string>,
  opts: PushOptions,
) => {
  let wait = opts.wait ?? 120_000
  let deadline = Date.now() + wait
  for (;;) {
    let value = valueOf(
      await reply(ask, 'app_files', { ...at, op: 'list' }),
    )
    if (value) {
      let files = filesIn(value)
      if (files) return files
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `app_files answered no file hashes or version after ${
          Math.round(wait / 1000)
        }s`,
      )
    }
    await new Promise((go) => setTimeout(go, opts.poll ?? 3_000))
  }
}

let COPY = 'copy.json'

/** A file git and the platform both changed in the same lines. */
export class Unmerged extends Error {
  override name = 'Unmerged'
}

let lines = (text: string) => text.split(/(?<=\n)/)

/// merged('a.ts', 'a\nB\nc\nd\n', 'a\nb\nc\nD\n', 'a\nb\nc\nd\n') -> 'a\nB\nc\nD\n'
/// merged('a.ts', '', 'x\n', '') -> 'x\n'
/** The platform's text of a file merged over git's, against the newest text
 * both held: copy.json by key, any other file by line. */
export let merged = (
  path: string,
  ours: string,
  live: string,
  base: string,
): string => {
  if (path == COPY) return byKey(ours, live, base)
  let { conflict, result } = byLine(lines(live), lines(base), lines(ours))
  if (conflict) {
    throw new Unmerged(
      `${path} was changed on the platform and in git in the same lines; ` +
        'nothing was written: merge the live file into git by hand, then push',
    )
  }
  return result.join('')
}

// The file at `path` the app holds as `sha`, as the platform changed it and
// merged over the checkout's (`ours`, empty where git no longer has it), or
// nothing when the app holds a text git has had.
let carried = async (
  ask: Ask,
  at: Record<string, string>,
  path: string,
  sha: string,
  ours: string,
  checkout: Checkout,
): Promise<string | undefined> => {
  let texts = [ours]
  for await (let text of checkout.earlier(path)) texts.push(text)
  let shas = await Promise.all(texts.map((content) => shaOf({ path, content })))
  if (shas.includes(sha)) return
  let live = valueOf(await reply(ask, 'app_files', { ...at, op: 'read', path }))
  if (typeof live?.content != 'string') return
  let past = valueOf(
    await reply(ask, 'app_files', { ...at, op: 'history', path }),
  )
  if (!Array.isArray(past?.replaced)) {
    throw new Error(`app_files answered no ${path} history`)
  }
  let held = new Set(past.replaced.map((w) => (w as { sha?: unknown }).sha))
  let base = texts[shas.findIndex((s) => held.has(s))] ?? ''
  let content = merged(path, ours, live.content, base)
  return content == ours ? undefined : content
}

// Each file the app holds as the platform changed it, merged over the
// checkout's: one `local` holds with other bytes, or one it lacks that the
// push would delete.
let changes = async (
  ask: Ask,
  at: Record<string, string>,
  local: File[],
  hashes: string[],
  held: Map<string, string>,
  checkout: Checkout,
  kept: string[] = [],
) => {
  let keep = new Set([...local.map((f) => f.path), ...kept])
  let ours = new Map(local.map((f, i) => [f.path, { f, sha: hashes[i] }]))
  let compiled = ours.has(PACKAGE) || held.has(PACKAGE)
  let out: Carried[] = []
  let relock = false
  for (let [path, sha] of held) {
    let mine = ours.get(path)
    if (
      mine
        ? mine.sha == sha || !('content' in mine.f)
        : keep.has(path) || pinned(path, keep) || asset(path)
    ) continue
    let text = mine && 'content' in mine.f ? mine.f.content : ''
    try {
      let content = await carried(ask, at, path, sha, text, checkout)
      if (content != null) out.push({ path, content })
    } catch (e) {
      if (path != LOCK || !compiled || !(e instanceof Unmerged)) throw e
      relock = true
    }
  }
  return { carry: out, relock }
}

// The compiler writes the regenerated lock into its release. Keep those
// bytes in the checkout too, provided this is still the release we made.
let keepLock = async (
  ask: Ask,
  at: Record<string, string>,
  opts: PushOptions,
  version: number,
  previous: string | undefined,
) => {
  let write = opts.checkout?.write
  if (!write) return
  let fresh = await listed(ask, at, opts)
  let sha = fresh.held.get(LOCK)
  if (fresh.version != version || !sha) return
  let lock = valueOf(
    await reply(ask, 'app_files', { ...at, op: 'read', path: LOCK }),
  )
  if (lock?.version != version || typeof lock.content != 'string') return
  if (lock.sha == sha && lock.content != previous) {
    await write([{ path: LOCK, content: lock.content }])
  }
}

/**
 * Make the app hold exactly `local`, released as a version, along with each
 * picture, PDF, font or sound it holds that `local` lacks. An app
 * that does not exist yet is created first: its file list is asked for, and a
 * list the platform refuses is answered by `app_new`, whose own refusal says
 * why when that fails too. A list that answers without its files is a broken
 * platform, and says so rather than trying to make the app again.
 */
export let push = (
  ask: Ask,
  local: File[],
  to: Target,
  opts: PushOptions = {},
): Promise<string[]> => pushing(ask, local, to, opts, RACES)

/** How many times a release from the source pushes again when another
 * release went live while it wrote its files. */
let RACES = 3

let pushing = async (
  ask: Ask,
  local: File[],
  to: Target,
  opts: PushOptions,
  races: number,
): Promise<string[]> => {
  let given = local
  if (!local.length) throw new CallError('dir', 'no files to push')
  let at = { app: to.app, ...to.space ? { space: to.space } : {} }
  let said: string[] = []
  let held: Awaited<ReturnType<typeof listed>>
  let created = false
  opts.progress?.({ phase: 'list', state: 'start' })
  try {
    held = await listed(ask, at, opts)
  } catch (e) {
    if (!(e instanceof CallError)) throw e
    created = true
    opts.progress?.({ phase: 'create', state: 'start' })
    said.push(
      await call(ask, 'app_new', {
        slug: to.app,
        title: to.title ?? to.app,
        ...to.space ? { space: to.space } : {},
      }),
    )
    opts.progress?.({ phase: 'create', state: 'done' })
    held = { held: new Map(), unreleased: true, version: 0, lockRemoved: false }
  }
  if (!created) {
    opts.progress?.({ phase: 'list', state: 'done', count: held.held.size })
  }
  // A remembered base past live means live went back (a rollback through
  // another door) since this checkout deployed. Pushing would undo that, so
  // it is asked for before a single file is written, and once confirmed the
  // push starts from what is live.
  if (opts.base != null && opts.base > held.version && !opts.confirm) {
    return [
      ...said,
      `live is v${held.version}, behind v${opts.base} this checkout last ` +
      'deployed (rolled back elsewhere); nothing was written, confirm with ' +
      '--confirm to deploy these files over it',
    ]
  }
  let base = opts.base != null && opts.base <= held.version &&
      opts.review !== false
    ? opts.base
    : held.version
  if (base != opts.base) await opts.remember?.(base)
  opts.progress?.({ phase: 'hash', state: 'start', count: local.length })
  let hashes = await Promise.all(local.map(shaOf))
  let checkout = opts.checkout
  let { carry, relock } = checkout
    ? await changes(ask, at, local, hashes, held.held, checkout, opts.keep)
    : { carry: [], relock: false }
  if (carry.length) {
    let saved = await checkout?.write?.(carry) ?? carry
    let by = new Map(saved.map((f) => [f.path, f]))
    let had = new Set(local.map((f) => f.path))
    local = [
      ...local.map((f) => by.get(f.path) ?? f),
      ...saved.filter((f) => !had.has(f.path)),
    ]
    hashes = await Promise.all(local.map(shaOf))
    said.push(
      ...carry.map((f) =>
        `${f.path}: kept the change made on the platform` +
        (checkout?.write ? ', in git too' : '')
      ),
    )
  }
  // A retry may find the deletion already staged in its draft.
  relock ||= held.lockRemoved && local.some((f) => f.path == LOCK)
  let keep = new Set([...local.map((f) => f.path), ...opts.keep ?? []])
  let changed = local.filter((f, i) =>
    !(relock && f.path == LOCK) && held.held.get(f.path) != hashes[i]
  )
  let gone = [...held.held.keys()].filter((p) =>
    relock && p == LOCK || !keep.has(p) && !pinned(p, keep) && !asset(p)
  )
  opts.progress?.({
    phase: 'hash',
    state: 'done',
    count: local.length,
    changed: changed.length,
    removed: gone.length,
  })
  let done = 0
  for (let batch of batches(changed)) {
    opts.progress?.({
      phase: 'upload',
      state: 'start',
      done,
      total: changed.length,
      batch: batch.length,
    })
    await call(ask, 'app_files', { ...at, files: batch })
    done += batch.length
    opts.progress?.({
      phase: 'upload',
      state: 'done',
      done,
      total: changed.length,
      batch: batch.length,
    })
  }
  done = 0
  for (let path of gone) {
    opts.progress?.({
      phase: 'delete',
      state: 'start',
      done,
      total: gone.length,
      path,
    })
    await call(ask, 'app_files', { ...at, op: 'delete', path })
    opts.progress?.({
      phase: 'delete',
      state: 'done',
      done: ++done,
      total: gone.length,
      path,
    })
  }
  if (!changed.length && !gone.length && !held.unreleased) {
    return [...said, 'no files changed']
  }
  said.push(
    `wrote ${changed.length} file${changed.length == 1 ? '' : 's'}` +
      (gone.length ? `, deleted ${gone.join(', ')}` : ''),
  )
  opts.progress?.({ phase: 'deploy', state: 'start' })
  // A release that outlasts app_deploy's patience answers that it is still
  // running; the same call again waits for it and answers how it ended.
  let args = { ...at, base, ...opts.confirm ? { confirm: true } : {} }
  let deployed = await reply(ask, 'app_deploy', args)
  while (valueOf(deployed)?.running === true) {
    deployed = await reply(ask, 'app_deploy', args)
  }
  let value = valueOf(deployed)
  if (
    typeof value?.deployed != 'boolean' ||
    typeof value.version != 'number' || !Number.isSafeInteger(value.version) ||
    value.version < 0
  ) throw new Error('app_deploy answered malformed version data')
  said.push(saidBy(deployed))
  if (value.deployed) {
    if (relock) {
      let old = given.find((f) => f.path == LOCK)
      await keepLock(
        ask,
        at,
        opts,
        value.version,
        old && 'content' in old ? old.content : undefined,
      )
    }
    await opts.remember?.(value.version)
  } else if (opts.review === false) {
    // Another release went live while this one wrote its files (a person's
    // push, or a copy edit): the source is still what goes live, so push it
    // again from the live it moved to.
    if (value.version > base && races > 0) {
      return [
        `live moved to v${value.version} during this release; pushed again`,
        ...await pushing(ask, given, to, opts, races - 1),
      ]
    }
    throw new Error(`app_deploy deployed nothing: ${said.join('; ')}`)
  } else said.push('confirm with --confirm to deploy these files')
  opts.progress?.({ phase: 'deploy', state: 'done', deployed: value.deployed })
  return said
}

/** Where the box keeps its push bases: beside its graph, or in ~/.yak for a
 * graph kept in memory. */
export let homeOf = (db?: string): string =>
  db && db != ':memory:' ? dirname(db) : `${systemProcess.env.get('HOME')}/.yak`

/** A checkout's last read or deployed version for one target. Each target has
 * its own file beside the box's graph; it stays independent of other checkouts
 * and survives process restarts. No source file is written or uploaded. */
export let versions = async (
  home: string,
  key: string,
): Promise<Pick<PushOptions, 'base' | 'remember'>> => {
  let hash = await shaOf({ path: '', content: key })
  let dir = `${home}/push`
  let path = `${dir}/${hash}.json`
  let base: number | undefined
  try {
    let value = JSON.parse(await fs.readTextFile(path))
    if (typeof value != 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`invalid push base version in ${path}`)
    }
    base = value
  } catch (e) {
    if (!fs.isNotFound(e)) throw e
  }
  return {
    base,
    remember: async (version) => {
      await fs.mkdir(dir, { recursive: true })
      let temporary = await fs.makeTempFile({ dir, prefix: hash })
      try {
        await fs.writeTextFile(temporary, JSON.stringify(version))
        await fs.rename(temporary, path)
      } catch (e) {
        await fs.remove(temporary)
        throw e
      }
    },
  }
}
