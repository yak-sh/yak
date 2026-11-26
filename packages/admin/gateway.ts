// Observe the stateless kernel through the same public gateway people use.
// Promotion records describe intent; this response names the code that answered.
import { Interrupted } from '@yaks/tools/errors'

export type Gateway = { kernel: string; front: string; at: string }

/** What the public gateway says it serves. A read the host's stop cut short
 * is interrupted, as a platform command it stops is (./subprocess.ts), not a
 * failure of the gateway. */
export let gateway = async (
  stopping: AbortSignal,
  go: typeof fetch = fetch,
): Promise<Gateway> => {
  try {
    return await observe(stopping, go)
  } catch (error) {
    if (stopping.aborted) {
      throw new Interrupted('the gateway read was interrupted', 'signal')
    }
    throw error
  }
}

let observe = async (
  stopping: AbortSignal,
  go: typeof fetch,
): Promise<Gateway> => {
  let res = await go('https://yaks.app/_yak/version', {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.any([stopping, AbortSignal.timeout(10_000)]),
  })
  if (!res.ok) {
    await res.body?.cancel()
    throw Error(`Public gateway version: HTTP ${res.status}`)
  }
  let { kernel } = await res.json()
  let front = res.headers.get('x-yak-front-version')
  if (typeof kernel != 'string' || !kernel || !front) {
    throw Error('Public gateway did not identify its kernel and front versions')
  }
  return { kernel, front, at: new Date().toISOString() }
}
