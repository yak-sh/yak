/// <reference lib="deno.ns" />
/** Private local OAuth records. Portable callers can supply another AuthorizationStore. */
import type { AuthorizationRecord, AuthorizationStore } from './oauth.ts'

export const fileAuthorizationStore = (path: string): AuthorizationStore => {
  const dir = path.slice(0, path.lastIndexOf('/')) || '.'
  const load = async (): Promise<
    { version: 1; records: Record<string, AuthorizationRecord> }
  > => {
    try {
      const stat = await Deno.lstat(path)
      if (!stat.isFile || stat.isSymlink) {
        throw new Error('OAuth store must be a regular file')
      }
      if (stat.mode != null && (stat.mode & 0o077)) {
        throw new Error('OAuth store must have private permissions (0600)')
      }
      let data
      try {
        data = JSON.parse(await Deno.readTextFile(path))
      } catch {
        throw new Error('Cannot read OAuth credential file')
      }
      if (
        data.version !== 1 || !data.records ||
        typeof data.records !== 'object' || Array.isArray(data.records)
      ) {
        throw new Error('Unsupported OAuth store format')
      }
      return data
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return { version: 1, records: {} }
      throw e
    }
  }
  return {
    read: async (key) => (await load()).records[key],
    update: async (key, fn) => {
      await Deno.mkdir(dir, { recursive: true, mode: 0o700 })
      const lock = await Deno.open(path + '.lock', {
        create: true,
        write: true,
        mode: 0o600,
      })
      try {
        await lock.lock(true)
        const data = await load()
        const before = JSON.stringify(data)
        const record = data.records[key] ??= {}
        let result
        try {
          result = await fn(record)
        } finally {
          if (JSON.stringify(data) !== before) {
            const temp = await Deno.makeTempFile({ dir, prefix: '.oauth-' })
            try {
              await Deno.chmod(temp, 0o600)
              await Deno.writeTextFile(temp, JSON.stringify(data) + '\n')
              const file = await Deno.open(temp, { write: true })
              try {
                await file.sync()
              } finally {
                file.close()
              }
              await Deno.rename(temp, path)
            } finally {
              await Deno.remove(temp).catch(() => {})
            }
          }
        }
        return result
      } finally {
        lock.close()
      }
    },
  }
}
