// What Workers Builds answers a POST to a deploy hook, read once for both
// places that ask: the kernel's rebuild of a failed build (builds.ts) and the
// box's deploy catch-up (@yaks/admin catchup.ts). The hook starts no build
// while one of the branch is queued or initializing: it answers 200,
// `success`, `already_exists`, and the pending build is the one that deploys.
// That answer started nothing, so neither place counts it as a start.

type Answer = {
  success?: boolean
  errors?: { message?: string }[]
  result?: { already_exists?: boolean; build_uuid?: string; status?: string }
}

/** What the deploy hook says when a build of main is already queued or
 * running: the head's build exists and is only slow. */
export let PENDING = 'a pending build of main already exists'

/** What a deploy hook answered: whether it started a build, the build it
 * started, and in words. */
export type Hooked = { started: boolean; said: string; build?: string }

/// hooked(200, { success: true, result: { build_uuid: 'aa194fb5-5e63', status: 'queued' } }) -> { started: true, said: 'build aa194fb5 queued', build: 'aa194fb5-5e63' }
/// hooked(200, { success: true, result: { already_exists: true } }) -> { started: false, said: PENDING }
/// hooked(404, { success: false, errors: [{ message: 'Not found' }] }) -> { started: false, said: 'refused 404: Not found' }
/// hooked(200, null) -> { started: false, said: 'refused 200' }
/** Read Workers Builds' answer to a deploy hook. */
export let hooked = (status: number, body: unknown): Hooked => {
  let a = (body && typeof body == 'object' ? body : {}) as Answer
  let why = a.errors?.map((e) => e.message).filter(Boolean).join('; ')
  return status >= 300 || !a.success
    ? { started: false, said: `refused ${status}${why ? `: ${why}` : ''}` }
    : a.result?.already_exists
    ? { started: false, said: PENDING }
    : {
      started: true,
      said: `build ${a.result?.build_uuid?.slice(0, 8) ?? '(no id)'} ${
        a.result?.status ?? 'started'
      }`,
      build: a.result?.build_uuid,
    }
}
