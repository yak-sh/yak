#!/usr/bin/env -S deno run -A
// Deploy only a changed bundle, then require its queue canary to become a bug
// in a Tracker object that runs this bundle: objects move to a new version
// minutes after the Worker, and the deploy is live only once they have. A
// missing canary rolls back to the exact version saved before this deploy,
// unless a newer build has deployed since: that build answers for the Worker.
import { root, run } from './wrangler.ts'

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
  let until = hooks.now() + 600_000
  do {
    try {
      if (await hooks.canary()) return true
    } catch { /* rollback if unavailable */ }
    await hooks.wait()
  } while (hooks.now() < until)
  // A newer build that deployed meanwhile owns the Worker and its objects, so
  // this canary could never arrive; rolling back would undo that build.
  let now = await hooks.current()
  if (now.hash && now.hash != hash) return false
  if (previous.version) await hooks.rollback(previous.version)
  throw Error(
    previous.version
      ? 'tracker canary missing; rolled back'
      : 'tracker canary missing; no previous deployment to restore',
  )
}
// A fresh receipt proves this publication reached grouping, not an older one.
export let canary = (
  url: string,
  hash: string,
  send: typeof fetch = fetch,
  timeout: (ms: number) => AbortSignal = AbortSignal.timeout,
  now: () => number = Date.now,
) => {
  let eid: string | undefined
  let nonce = crypto.randomUUID()
  let at: string | undefined
  let next = -Infinity
  return async (): Promise<boolean> => {
    let probe = new URL('/canary', url)
    probe.searchParams.set('scope', 'platform')
    probe.searchParams.set('hash', hash)
    if (now() >= next) {
      at ??= new Date(now()).toISOString()
      next = now() + 30_000
      let publication = new URL(probe)
      publication.searchParams.set('nonce', nonce)
      publication.searchParams.set('at', at)
      let response = await send(publication, {
        method: 'POST',
        signal: timeout(5000),
      })
      if (response.ok) eid = (await response.json()).eid
    }
    if (!eid) return false
    probe.searchParams.set('eid', eid)
    let response = await send(probe, { signal: timeout(5000) })
    return response.ok && (await response.json()).arrived === true
  }
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
  let url = Deno.env.get('TRACKER_URL')
  if (!url) throw Error('build needs TRACKER_URL')
  let scratch = await Deno.makeTempDir({ prefix: 'tracker-bundle-' })
  try {
    if (await run(['deploy', '--dry-run', '--outdir', scratch])) Deno.exit(1)
    let bytes = await Deno.readFile(`${scratch}/index.js`)
    let hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')
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
        if (
          await run([
            'deploy',
            '--var',
            `BUNDLE_HASH:${hash}`,
            '--message',
            `tracker-bundle:${hash}`,
          ])
        ) {
          throw Error('tracker deploy failed')
        }
      },
      canary: canary(url, hash),
      rollback: async (version) => {
        if (
          await run([
            'rollback',
            version,
            '--yes',
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
