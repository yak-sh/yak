// A directory as an app: `yak admin push apps/mail` makes the app hold exactly
// the files in that directory, through the connector's own tools (app_new,
// app_files, app_deploy), the ones any assistant calls. Git is the app's only
// source of code, so a file the directory no longer has is deleted from the
// app too, and an app pushed from here is never edited on the platform.
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

/** A push's base version, confirmation and progress, and its bounded wait
 * for the connector's file data contract. */
export type PushOptions = {
  base?: number
  confirm?: boolean
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

/**
 * Make the app hold exactly `local`, released as a version, along with each
 * picture, PDF, font or sound it holds that `local` lacks. An app
 * that does not exist yet is created first: its file list is asked for, and a
 * list the platform refuses is answered by `app_new`, whose own refusal says
 * why when that fails too. A list that answers without its files is a broken
 * platform, and says so rather than trying to make the app again.
 */
export let push = async (
  ask: Ask,
  local: File[],
  to: Target,
  opts: PushOptions = {},
): Promise<string[]> => {
  if (!local.length) throw new CallError('dir', 'no files to push')
  let at = { app: to.app, ...to.space ? { space: to.space } : {} }
  let said: string[] = []
  let held: { held: Map<string, string>; unreleased: boolean; version: number }
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
    held = { held: new Map(), unreleased: true, version: 0 }
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
  let base = opts.base != null && opts.base <= held.version
    ? opts.base
    : held.version
  if (base != opts.base) await opts.remember?.(base)
  opts.progress?.({ phase: 'hash', state: 'start', count: local.length })
  let hashes = await Promise.all(local.map(shaOf))
  let changed = local.filter((f, i) => held.held.get(f.path) != hashes[i])
  let keep = new Set(local.map((f) => f.path))
  let gone = [...held.held.keys()].filter((p) =>
    !keep.has(p) && !pinned(p, keep) && !asset(p)
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
  if (value.deployed) await opts.remember?.(value.version)
  else said.push('confirm with --confirm to deploy these files')
  opts.progress?.({ phase: 'deploy', state: 'done', deployed: value.deployed })
  return said
}

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
