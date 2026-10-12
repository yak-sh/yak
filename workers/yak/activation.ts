// One serialized door to activating the platform's Workers. Credentials pass
// through this request alone; an unfinished activation keeps its durable mark
// until Cloudflare proves that activation reached the serving deployment.
import type { Env } from './env.ts'

let API = 'https://api.cloudflare.com/client/v4'
let COMMIT = /(?:^|\n)([a-f0-9]{40})\b/
let WORKER = /^yak(?:-out|-esbuild)?(?:-staging)?$/

/** The platform Worker named by an exact Cloudflare activation request. */
export let activationPath = (method: string, path: string, account: string) => {
  path = path.split('?')[0]
  let prefix = `/accounts/${account}/workers/scripts/`
  if (!account || !path.startsWith(prefix)) return
  let tail = path.slice(prefix.length)
  let worker = method == 'PUT'
    ? tail
    : method == 'POST' && tail.endsWith('/deployments')
    ? tail.slice(0, -'/deployments'.length)
    : ''
  return WORKER.test(worker) ? worker : undefined
}

class Refused extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

let refusal = (status: number, message: string, conflict = false) =>
  Response.json({ success: false, errors: [{ code: 10000, message }] }, {
    status,
    headers: conflict ? { 'x-yak-activation-conflict': '1' } : {},
  })

type Version = { version_id: string; percentage: number }
type Deployment = {
  id: string
  created_on: string
  versions: Version[]
  annotations?: Record<string, string>
}

/** The authenticated serving deployment and every commit receiving traffic.
 * Missing metadata is refused: it cannot establish deployment ordering. */
export let current = async (
  path: string,
  headers: Headers,
  ask: typeof fetch = fetch,
): Promise<{ id: string; commits: string[]; versions: string[] }> => {
  let script = path.split('?')[0].replace(/\/deployments$/, '')
  let read = async <T>(at: string): Promise<T> => {
    let response = await ask(`${API}${at}`, {
      headers: { authorization: headers.get('authorization') ?? '' },
      redirect: 'error',
    })
    if (!response.ok) {
      await response.arrayBuffer()
      throw new Refused(
        response.status,
        'Cloudflare refused deployment inspection',
      )
    }
    let body = await response.json() as { success?: boolean; result?: T | null }
    if (body.success !== true || body.result == null) {
      throw new Refused(
        502,
        'Cloudflare did not establish the serving deployment',
      )
    }
    return body.result
  }
  let { deployments } = await read<{
    deployments: Deployment[]
  }>(`${script}/deployments`)
  if (!Array.isArray(deployments)) throw new Refused(502, 'Invalid deployments')
  if (!deployments.length) return { id: '', commits: [], versions: [] }
  if (
    deployments.some((d) =>
      !d || typeof d.id != 'string' || !d.id ||
      !Number.isFinite(Date.parse(d.created_on)) || !Array.isArray(d.versions)
    )
  ) throw new Refused(502, 'Invalid deployment metadata')
  let live =
    deployments.toSorted((a, b) =>
      Date.parse(b.created_on) - Date.parse(a.created_on)
    )[0]
  let versions = live.versions.filter((v) => v.percentage > 0)
  if (!versions.length) throw new Refused(502, 'No serving versions identified')
  if (versions.some((v) => typeof v.version_id != 'string' || !v.version_id)) {
    throw new Refused(502, 'Invalid serving version')
  }
  let summary = COMMIT.exec(live.annotations?.['workers/message'] ?? '')?.[1]
  let commits = await Promise.all(versions.map(async (v) => {
    if (versions.length == 1 && summary) return summary
    let version = await read<{ annotations?: Record<string, string> }>(
      `${script}/versions/${v.version_id}`,
    )
    let commit = COMMIT.exec(version.annotations?.['workers/message'] ?? '')
      ?.[1]
    if (!commit) {
      throw new Refused(502, 'Serving version has no commit annotation')
    }
    return commit
  }))
  return { id: live.id, commits, versions: versions.map((v) => v.version_id) }
}

type Pending = { commit: string; deployment: string; versions?: string[] }
let sameVersions = (a: string[], b: string[]) => {
  let ids = new Set(a)
  return ids.size == new Set(b).size && b.every((id) => ids.has(id))
}
export type Storage = {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
}

/** Serialize inspection and activation, retaining uncertain results on disk. */
export let activation = (
  storage: Storage,
  account: string,
  ask: typeof fetch = fetch,
  report: (stage: string) => void = () => {},
) => {
  let tail = Promise.resolve()
  let activate = async (request: Request): Promise<Response> => {
    let path = request.headers.get('x-yak-activation-path') ?? ''
    let commit = request.headers.get('x-yak-commit') ?? ''
    let expected = request.headers.get('x-yak-deployment')
    if (
      !activationPath(request.method, path, account) ||
      !/^[a-f0-9]{40}$/.test(commit) || expected == null
    ) return refusal(400, 'Invalid platform activation request')
    if (!request.headers.get('authorization')) {
      return refusal(401, 'Cloudflare authorization is required')
    }
    let stage = 'inspect serving deployment'
    try {
      let live = await current(path, request.headers, ask)
      stage = 'read pending activation'
      let pending = await storage.get<Pending | null>('activation')
      if (pending) {
        if (
          live.id == pending.deployment ||
          !(pending.versions
            ? sameVersions(live.versions, pending.versions)
            : live.commits.every((commit) => commit == pending.commit))
        ) return refusal(503, 'An earlier activation has an unresolved outcome')
        await storage.put('activation', null)
      }
      if (live.id != expected) {
        return refusal(
          409,
          'The serving deployment changed before activation',
          true,
        )
      }
      let body = await request.arrayBuffer()
      let versions: string[] | undefined
      if (request.method == 'POST') {
        let target: { versions?: Version[] }
        try {
          target = JSON.parse(new TextDecoder().decode(body))
        } catch {
          return refusal(400, 'Invalid deployment activation body')
        }
        if (
          !Array.isArray(target?.versions) ||
          target.versions.some((v) =>
            !v || typeof v.version_id != 'string' || !v.version_id ||
            !Number.isFinite(v.percentage)
          )
        ) return refusal(400, 'Invalid deployment activation versions')
        versions = target.versions.filter((v) => v.percentage > 0).map((v) =>
          v.version_id
        )
        if (!versions.length) {
          return refusal(400, 'No activation versions identified')
        }
      }
      stage = 'record pending activation'
      await storage.put('activation', {
        commit,
        deployment: live.id,
        ...versions ? { versions } : {},
      })
      let headers = new Headers()
      for (let name of ['authorization', 'content-type']) {
        let value = request.headers.get(name)
        if (value) headers.set(name, value)
      }
      stage = 'send activation'
      let response = await ask(`${API}${path}`, {
        method: request.method,
        headers,
        body,
        redirect: 'error',
      })
      // Consume the whole response before releasing the next activation. A
      // broken stream is an uncertain outcome, just as a failed fetch is.
      stage = 'receive activation response'
      let bytes = await response.arrayBuffer()
      let succeeded = false
      if (response.ok) {
        try {
          succeeded =
            JSON.parse(new TextDecoder().decode(bytes)).success === true
        } catch { /* a malformed success does not prove activation */ }
      }
      if (succeeded || response.status >= 400 && response.status < 500) {
        stage = 'complete activation'
        await storage.put('activation', null)
      }
      return new Response(bytes, {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      })
    } catch (error) {
      if (!(error instanceof Refused) || error.status >= 500) report(stage)
      return error instanceof Refused
        ? refusal(error.status, error.message)
        : refusal(502, 'Cloudflare activation could not be confirmed')
    }
  }
  return (request: Request) => {
    let result = tail.then(() => activate(request))
    tail = result.then(() => {}, () => {})
    return result
  }
}

/** Route by Worker identity without starting a graph in the gate's object. */
export let fetchActivation = (
  request: Request,
  env: Env,
): Promise<Response> => {
  let worker = activationPath(
    request.method,
    request.headers.get('x-yak-activation-path') ?? '',
    env.CF_ACCOUNT ?? '',
  )
  if (!worker) {
    return Promise.resolve(refusal(400, 'Invalid platform activation path'))
  }
  let headers = new Headers(request.headers)
  headers.set('x-yak-activation', '1')
  return env.STORE.get(env.STORE.idFromName(`yak/activation/${worker}`)).fetch(
    new Request(request, { headers }),
  )
}
