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
import { saidBy } from './api.ts'

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

let call = async (ask: Ask, name: string, args: Record<string, unknown>) =>
  saidBy(
    await ask('tools/call', { name, arguments: args }) as {
      content?: { type: string; text?: string }[]
      isError?: boolean
    },
  )

/**
 * Make the app hold exactly `files`, then release them as a version. An app
 * that does not exist yet is created first: its file list is asked for, and a
 * list that fails is answered by `app_new`, whose own refusal says why when
 * that fails too.
 */
export let push = async (
  ask: Ask,
  files: File[],
  to: Target,
): Promise<string[]> => {
  if (!files.length) throw new CallError('dir', 'no files to push')
  let at = { app: to.app, ...to.space ? { space: to.space } : {} }
  let said: string[] = []
  let held: string[]
  try {
    held = (await call(ask, 'app_files', { ...at, op: 'list' }))
      .split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
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
