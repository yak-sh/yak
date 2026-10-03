#!/usr/bin/env -S deno run -A
// Deploy only a changed bundle, then require its queue canary to become a bug.
// A missing canary rolls back to the exact version saved before this deploy.
import { root, run } from './wrangler.ts'
import { sign } from './auth.ts'
import { platform } from './core.ts'

export type Hooks = {
  current: () => Promise<{ version?: string; hash?: string }>
  deploy: (hash: string) => Promise<void>
  canary: () => Promise<boolean>
  rollback: (version: string) => Promise<void>
  now: () => number
  wait: () => Promise<void>
}
export let deploy = async (hash: string, hooks: Hooks): Promise<boolean> => {
  let previous = await hooks.current()
  if (previous.hash == hash) return false
  await hooks.deploy(hash)
  let until = hooks.now() + 60_000
  do {
    try {
      if (await hooks.canary()) return true
    } catch { /* rollback if unavailable */ }
    await hooks.wait()
  } while (hooks.now() < until)
  if (previous.version) await hooks.rollback(previous.version)
  throw Error(
    previous.version
      ? 'tracker canary missing; rolled back'
      : 'tracker canary missing; no previous deployment to restore',
  )
}
let command = async (...args: string[]) => {
  let process = new Deno.Command('deno', {
    args: ['run', '-A', `${root}/wrangler.ts`, ...args],
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  let out = await process
  if (!out.success) throw Error(`tracker wrangler ${args[0]} failed`)
  return JSON.parse(new TextDecoder().decode(out.stdout))
}
if (import.meta.main) {
  let scratch = await Deno.makeTempDir({ prefix: 'tracker-bundle-' })
  try {
    if (await run(['deploy', '--dry-run', '--outdir', scratch])) Deno.exit(1)
    let bytes = await Deno.readFile(`${scratch}/index.js`)
    let hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')
    // Workers Builds supplies a scoped grant. These are never graph secrets
    // or owner credentials; activation configures the build's own variables.
    let url = Deno.env.get('TRACKER_URL')
    let secret = Deno.env.get('TRACKER_SECRET')
    let ticket = secret
      ? await sign({
        scope: platform,
        person: platform,
        admin: true,
        exp: Date.now() / 1000 + 300,
      }, secret)
      : undefined
    if (!url || !ticket) {
      throw Error('build needs TRACKER_URL and TRACKER_SECRET')
    }
    let eid = ''
    let published = false
    await deploy(hash, {
      current: async () => {
        let all = await command('deployments', 'list', '--json')
        let latest =
          all.sort((a: { created_on: string }, b: { created_on: string }) =>
            b.created_on.localeCompare(a.created_on)
          )[0]
        let version = latest?.versions?.find((v: { percentage: number }) =>
          v.percentage == 100
        )?.version_id
        if (!version) return {}
        let detail = await command('versions', 'view', version, '--json')
        let message = detail.annotations?.['workers/message'] ?? ''
        return {
          version,
          hash: message.match(/tracker-bundle:([0-9a-f]{64})/)?.[1],
        }
      },
      deploy: async (hash) => {
        if (await run(['deploy', '--message', `tracker-bundle:${hash}`])) {
          throw Error('tracker deploy failed')
        }
      },
      canary: async () => {
        if (!published) {
          let canary = new URL('/canary', url)
          canary.searchParams.set('scope', 'platform')
          canary.searchParams.set('hash', hash)
          let response = await fetch(canary, {
            method: 'POST',
            headers: { authorization: `Bearer ${ticket}` },
          })
          if (!response.ok) return false
          eid = (await response.json()).eid
          published = true
        }
        try {
          let query = new URL('/query', url)
          query.searchParams.set('scope', 'platform')
          query.searchParams.set('q', `.error.bug .entity.eid=${eid}`)
          let response = await fetch(query, {
            headers: { authorization: `Bearer ${ticket}` },
          })
          let rows = response.ok ? await response.json() : []
          return rows.length == 1
        } catch {
          return false
        }
      },
      rollback: async (version) => {
        if (
          await run([
            'rollback',
            version,
            '--message',
            'tracker canary missing',
          ])
        ) throw Error('tracker rollback failed')
      },
      now: Date.now,
      wait: () => new Promise((done) => setTimeout(done, 1000)),
    })
  } finally {
    await Deno.remove(scratch, { recursive: true })
  }
}
