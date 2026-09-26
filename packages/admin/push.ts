// A directory as an app: `yak admin push apps/mail` makes the app hold exactly
// the files in that directory, through the connector's own tools (app_new,
// app_files, app_deploy), the ones any assistant calls. Git is the app's only
// source, so a file the directory no longer has is deleted from the app too,
// and an app pushed from here is never edited on the platform.
//
// A file is sent as text when its bytes are UTF-8 and as base64 when they are
// not (an icon, a .wasm). Dotfiles are left out: nothing the platform serves
// starts with a dot, and `.DS_Store` is not part of an app.

import { CallError } from '@yaks/tools'
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

/** How long a push waits for a newly deployed answer contract to arrive. */
export type PushOptions = { wait?: number; poll?: number }

let utf8 = new TextDecoder('utf-8', { fatal: true })

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

/** Every file under `dir`, paths relative to it, dotfiles left out, sorted. */
export let read = async (dir: string): Promise<File[]> => {
  let files: File[] = []
  let walk = async (rel: string) => {
    for await (let e of Deno.readDir(`${dir}/${rel}`)) {
      if (e.name.startsWith('.')) continue
      let path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory) await walk(path)
      else if (e.isFile) {
        files.push(fileOf(path, await Deno.readFile(`${dir}/${path}`)))
      }
    }
  }
  await walk('')
  return files.sort((a, b) => a.path < b.path ? -1 : 1)
}

let reply = async (ask: Ask, name: string, args: Record<string, unknown>) =>
  await ask('tools/call', { name, arguments: args }) as Reply

// What a tool said, for the person running the push.
let call = async (ask: Ask, name: string, args: Record<string, unknown>) =>
  saidBy(await reply(ask, name, args))

let pathsIn = (value: Record<string, unknown>) => {
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
  return files.map((f) => (f as { path: string }).path)
}

// The paths an app holds, read off the list's answer as data: its words are
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
    if (value) return pathsIn(value)
    if (Date.now() >= deadline) {
      throw new Error(
        `app_files answered no value after ${Math.round(wait / 1000)}s`,
      )
    }
    await new Promise((go) => setTimeout(go, opts.poll ?? 3_000))
  }
}

/**
 * Make the app hold exactly `files`, then release them as a version. An app
 * that does not exist yet is created first: its file list is asked for, and a
 * list the platform refuses is answered by `app_new`, whose own refusal says
 * why when that fails too. A list that answers without its files is a broken
 * platform, and says so rather than trying to make the app again.
 */
export let push = async (
  ask: Ask,
  files: File[],
  to: Target,
  opts: PushOptions = {},
): Promise<string[]> => {
  if (!files.length) throw new CallError('dir', 'no files to push')
  let at = { app: to.app, ...to.space ? { space: to.space } : {} }
  let said: string[] = []
  let held: string[]
  try {
    held = await listed(ask, at, opts)
  } catch (e) {
    if (!(e instanceof CallError)) throw e
    said.push(
      await call(ask, 'app_new', {
        slug: to.app,
        title: to.title ?? to.app,
        ...to.space ? { space: to.space } : {},
      }),
    )
    held = []
  }
  await call(ask, 'app_files', { ...at, files })
  let keep = new Set(files.map((f) => f.path))
  let gone = held.filter((p) => !keep.has(p))
  for (let path of gone) {
    await call(ask, 'app_files', { ...at, op: 'delete', path })
  }
  said.push(
    `wrote ${files.length} file${files.length == 1 ? '' : 's'}` +
      (gone.length ? `, deleted ${gone.join(', ')}` : ''),
    await call(ask, 'app_deploy', at),
  )
  return said
}
