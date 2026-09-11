/** Host-local client vault. Draft bytes never pass through the backend worker. */
import type { Saved, Vault } from '@yaks/client'
import { join, resolve } from '@std/path'
import { frontend } from './frontend.ts'

export let draftVault = async (directory: string): Promise<Vault> => {
  await Deno.mkdir(directory, { recursive: true, mode: 0o700 })
  await Deno.chmod(directory, 0o700)
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
  return {
    load: async () => {
      const rows: Saved[] = []
      for await (const file of Deno.readDir(directory)) {
        if (!file.isFile || !file.name.endsWith('.json')) continue
        const row = JSON.parse(
          await Deno.readTextFile(join(directory, file.name)),
        ) as Saved
        if (typeof row.eid != 'string' || !row.comps) {
          throw new Error('Invalid draft vault record')
        }
        rows.push(row)
      }
      return rows
    },
    save: async (rows) => {
      for (const row of rows) {
        const target = await path(row.eid)
        const temporary = target + '.' + crypto.randomUUID() + '.tmp'
        await Deno.writeTextFile(temporary, JSON.stringify(row), {
          mode: 0o600,
          createNew: true,
        })
        await Deno.rename(temporary, target)
      }
    },
    drop: async (ids) => {
      for (const id of ids) {
        try {
          await Deno.remove(await path(id))
        } catch (e) {
          if (!(e instanceof Deno.errors.NotFound)) throw e
        }
      }
    },
    clear: async () => {
      for await (const file of Deno.readDir(directory)) {
        if (file.name.endsWith('.json')) {
          await Deno.remove(join(directory, file.name))
        }
      }
    },
  }
}

/** Stable per-terminal identity, overridable for moving between terminals. */
export let openDrafts = async () => {
  let terminal = Deno.env.get('HARNESS_FRONTEND') ?? Deno.env.get('TMUX_PANE')
  if (!terminal) {
    try {
      terminal = await Deno.readLink('/proc/self/fd/0')
    } catch {
      terminal = 'default'
    }
  }
  const database = Deno.env.get('HARNESS_DB') ??
    join(Deno.env.get('HOME')!, '.harness/harness.db')
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(resolve(database) + '\n' + terminal),
  )
  const id = Array.from(
    new Uint8Array(hash),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('')
  const directory = join(
    Deno.env.get('HARNESS_DRAFT_DIR') ??
      join(Deno.env.get('HOME')!, '.harness/drafts'),
    id,
  )
  const vault = await draftVault(directory)
  // Refuse concurrent use of the same profile rather than overwrite its drafts.
  const lockPath = join(directory, 'owner')
  const lock = await Deno.open(lockPath, {
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
