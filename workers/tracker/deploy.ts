#!/usr/bin/env -S deno run -A
// Deploy only a changed bundle, then wait for its queue canary to become a bug
// in a Tracker object that runs this bundle: objects move to a new version
// minutes after the Worker, and the deploy is confirmed only once they have.
// A canary the tracker says failed, or one still missing after ten minutes, is
// reported to the tracker and fails the build. The new version stays live:
// whether to roll back or fix forward is an agent's call, never this script's.
import { root, run } from './wrangler.ts'

/** The tracker's answer that this build's canary failed, not still on its way. */
export class Failed extends Error {}
export type Hooks = {
  current: () => Promise<{ hash?: string }>
  deploy: (hash: string) => Promise<void>
  /** Whether the canary arrived; throws {@link Failed} when it failed. */
  canary: () => Promise<boolean>
  /** Tell the tracker this build's canary did not arrive. */
  report: () => Promise<void>
  now: () => number
  wait: () => Promise<void>
}
let confirmed = async (hooks: Hooks) => {
  let until = hooks.now() + 600_000
  do {
    try {
      if (await hooks.canary()) return true
    } catch (error) {
      if (error instanceof Failed) return false
      // An unavailable tracker is asked again.
    }
    await hooks.wait()
  } while (hooks.now() < until)
  return false
}
export let deploy = async (hash: string, hooks: Hooks): Promise<boolean> => {
  if ((await hooks.current()).hash == hash) return false
  await hooks.deploy(hash)
  if (await confirmed(hooks)) return true
  // A newer build that deployed meanwhile owns the Worker and its objects, so
  // this canary could never arrive; that build answers for itself.
  let now = await hooks.current()
  if (now.hash && now.hash != hash) return false
  await hooks.report()
  throw Error('tracker canary missing; reported, and this build stays live')
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
  let door = (path: string) => {
    let address = new URL(path, url)
    address.searchParams.set('scope', 'platform')
    address.searchParams.set('hash', hash)
    return address
  }
  return {
    arrived: async (): Promise<boolean> => {
      if (now() >= next) {
        at ??= new Date(now()).toISOString()
        next = now() + 30_000
        let publication = door('/canary')
        publication.searchParams.set('nonce', nonce)
        publication.searchParams.set('at', at)
        let response = await send(publication, {
          method: 'POST',
          signal: timeout(5000),
        })
        if (response.ok) eid = (await response.json()).eid
      }
      if (!eid) return false
      let probe = door('/canary')
      probe.searchParams.set('eid', eid)
      let response = await send(probe, { signal: timeout(5000) })
      if (!response.ok) return false
      let answer = await response.json()
      if (answer.failed) throw new Failed('tracker canary failed')
      return answer.arrived === true
    },
    // The tracker reads why itself; the build says only which canary.
    report: async () => {
      let missing = door('/canary/missing')
      missing.searchParams.set('nonce', nonce)
      let response = await send(missing, {
        method: 'POST',
        signal: timeout(30_000),
      })
      if (!response.ok) {
        throw Error(
          `tracker canary missing, and reporting it failed: ${response.status}`,
        )
      }
    },
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
    let probe = canary(url, hash)
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
        return { hash: message.match(/tracker-bundle:([0-9a-f]{64})/)?.[1] }
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
      canary: probe.arrived,
      report: probe.report,
      now: Date.now,
      wait: () => new Promise((done) => setTimeout(done, 1000)),
    })
  } finally {
    await Deno.remove(scratch, { recursive: true })
  }
}
