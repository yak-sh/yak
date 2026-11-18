/** Host-local client vault. Draft bytes never pass through the backend worker. */

import * as fs from '@yaks/file/io'
import * as systemProcess from '@yaks/process/system'
import {
  recover,
  removed,
  type Saved,
  type Trashed,
  type Vault,
} from '@yaks/client'
import { trash } from '@yaks/process/trash'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { frontend } from './frontend.ts'

let home = (env: (name: string) => string | undefined) =>
  env('HARNESS_HOME') || `${env('HOME') || '.'}/.yak`

export let draftVault = async (directory: string): Promise<Vault> => {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  await fs.chmod(directory, 0o700)
  const path = async (id: string) => {
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(id),
    )
    return join(
      directory,
      Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, '0'))
        .join('') + '.json',
    )
  }
  let trashDirectory = join(directory, '.trash')
  let read = async (target: string): Promise<Saved | undefined> => {
    try {
      return JSON.parse(await fs.readTextFile(target)) as Saved
    } catch (error) {
      if (fs.isNotFound(error)) return undefined
      throw error
    }
  }
  let save = async (rows: Saved[]) => {
    for (const row of rows) {
      const target = await path(row.eid)
      const temporary = target + '.' + crypto.randomUUID() + '.tmp'
      await fs.writeTextFile(temporary, JSON.stringify(row), {
        mode: 0o600,
        createNew: true,
      })
      let before = await read(target)
      if (before && removed(before.comps, row.comps)) {
        await trash(target, trashDirectory)
      }
      await fs.rename(temporary, target)
    }
  }
  return {
    trash: async () => {
      let rows: Trashed[] = []
      try {
        for await (let file of fs.readDir(trashDirectory)) {
          if (!file.isDirectory) continue
          let record = join(trashDirectory, file.name)
          let row = await read(join(record, 'data'))
          let source = JSON.parse(
            await fs.readTextFile(join(record, 'source.json')),
          )
          if (row) rows.push({ id: file.name, at: source.at, row })
        }
      } catch (error) {
        if (!fs.isNotFound(error)) throw error
      }
      return rows
    },
    restore: async (id) => {
      // The record id is a basename, never a path into another profile.
      if (!/^[a-f0-9-]{36}$/.test(id)) return undefined
      let row = await read(join(trashDirectory, id, 'data'))
      if (!row) return undefined
      let restored = recover(row, await read(await path(row.eid)))
      await save([restored])
      return restored
    },
    load: async () => {
      const rows: Saved[] = []
      for await (const file of fs.readDir(directory)) {
        if (!file.isFile || !file.name.endsWith('.json')) continue
        const row = JSON.parse(
          await fs.readTextFile(join(directory, file.name)),
        ) as Saved
        if (typeof row.eid != 'string' || !row.comps) {
          throw new Error('Invalid draft vault record')
        }
        rows.push(row)
      }
      return rows
    },
    save,
    drop: async (ids) => {
      for (const id of ids) await trash(await path(id), trashDirectory)
    },
    clear: async () => {
      for await (const file of fs.readDir(directory)) {
        if (file.name.endsWith('.json')) {
          await trash(join(directory, file.name), trashDirectory)
        }
      }
    },
  }
}

/** Stable per-terminal identity, overridable for moving between terminals. */
export let openDrafts = async (
  database: string,
  env: (name: string) => string | undefined = systemProcess.env.get,
) => {
  database = env('HARNESS_DB') || database
  let terminal = env('HARNESS_FRONTEND') ?? env('TMUX_PANE')
  if (!terminal) {
    try {
      terminal = await fs.readLink('/proc/self/fd/0')
    } catch {
      terminal = 'default'
    }
  }
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(resolve(database) + '\n' + terminal),
  )
  const id = Array.from(
    new Uint8Array(hash),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('')
  const directory = join(
    env('HARNESS_DRAFT_DIR') ?? join(home(env), 'drafts'),
    id,
  )
  const vault = await draftVault(directory)
  // Refuse concurrent use of the same profile rather than overwrite its drafts.
  const lockPath = join(directory, 'owner')
  const lock = await fs.open(lockPath, {
    create: true,
    write: true,
    mode: 0o600,
  })
  // Non-blocking lock prevents two frontends from editing the same profile.
  try {
    if (!lock.tryLockSync(true)) throw new Error('profile locked')
  } catch (e) {
    lock.close()
    throw new Error(
      'Draft profile already open; choose a different HARNESS_FRONTEND',
      { cause: e },
    )
  }
  const ui = frontend(vault)
  try {
    await ui.ready
  } catch (e) {
    lock.close()
    ui.close()
    throw e
  }
  return {
    ui,
    close: async () => {
      try {
        await ui.flush()
      } finally {
        ui.close()
        lock.close()
      }
    },
  }
}
