// Carrier work stays in the directory through timeouts and worker restarts.
import { type Bundle, token } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { CallStopError } from '@yaks/phone'
import { Unsent } from '@yaks/host/senders'
import { line as q } from '@yaks/query'
import { caught } from './defects.ts'
import { directoryOf, idOf, lineOf, type Row, stamp } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { syncVoice, voiceOf } from './number-voice.ts'
import { spaceNow } from './model-spend.ts'
import { released } from './numbers.ts'

type Release = {
  line: string
  at: string
  permanent: boolean
  stopped_in?: string
  stopped_out?: string
  reported?: string
}

let eidOf = (line: string) => derivedEid(`phone-release|${line}`)
let nowOf = (env: Env) => new Date(env.CLOCK?.now() ?? Date.now())

export let releaseWork = (line: string, permanent: boolean, now: Date) => ({
  entity: { eid: eidOf(line) },
  phone_release: {
    line,
    at: now.toISOString(),
    permanent,
    reported: null,
    ...permanent ? {} : { stopped_in: null, stopped_out: null },
  },
  wake: {
    at: new Date(now.getTime() + 60_000).toISOString(),
    every: '1m',
    note: 'Finish releasing a phone number',
  },
})

let read = async (env: Env, eid: string) => {
  let [row] = await meta(env).query(q`.entity.eid=${eid}&?phone_release`, {
    live: true,
  })
  return row?.phone_release as Release | undefined
}

export let returning = async (env: Env, line: string) =>
  !!(await read(env, eidOf(line)))?.permanent

let describeCalls = (work?: Release) => {
  if (!work || work.stopped_in && work.stopped_out) {
    return 'Incoming and outgoing calls have stopped.'
  }
  let incoming = work.stopped_in
    ? 'Incoming calls have stopped.'
    : 'Incoming calls should stop shortly.'
  let outgoing = work.stopped_out
    ? 'Outgoing calls have stopped.'
    : 'Outgoing calls should stop shortly.'
  return `${incoming} ${outgoing} We will retry automatically.`
}

export let releaseStatus = async (env: Env, line: string) => {
  let work = await read(env, eidOf(line))
  return { calls: describeCalls(work), returning: !!work?.permanent }
}

let held = async (env: Env, id: string) => {
  let [row] = await meta(env).query(q`.entity.eid=${id}&?phone_line&?trashed`, {
    live: true,
  })
  return row?.phone_line ? lineOf(row as Row) : undefined
}

let retire = async (env: Env, work: Release) => {
  let id = idOf(work.line)
  let line = await held(env, id)
  let dir = directoryOf(env.STORE)
  if (work.permanent) {
    if (line) await released(env, line)
    await dir.purgeTrashEntities([id])
    return
  }
  if (!line?.trashed) return
  try {
    await syncVoice(env, line, { in: false, out: false })
  } finally {
    let standing = await dir.heldLine(line.number)
    if (standing?.line.eid == id && !standing.line.trashed) {
      let space = await spaceNow(env, line.space)
      await syncVoice(env, standing.line, voiceOf(false, space, nowOf(env)))
    }
  }
}

let current = (work: Release) => ({
  phone_release: { permanent: token(work.permanent), at: token(work.at) },
})

let patch = async (
  env: Env,
  eid: string,
  work: Release,
  change: Partial<Bundle>,
) => {
  try {
    await stamp(env, {
      entities: [{ entity: { eid }, $was: current(work), ...change }],
    })
  } catch (error) {
    if (!(error instanceof Stale)) throw error
  }
}

let retrying = async (
  env: Env,
  eid: string,
  work: Release,
  error: unknown,
  now: Date,
) => {
  if (error instanceof Stale) return
  let reasons: unknown[] = error instanceof CallStopError
    ? error.errors
    : [error]
  let due = now.getTime() - Date.parse(work.at) >= 3_600_000
  let report = !work.reported &&
    (due || reasons.some((e) => !(e instanceof Unsent)))
  let at = now.toISOString()
  let progress = {
    ...error instanceof CallStopError && error.stopped.in && !work.stopped_in
      ? { stopped_in: at }
      : {},
    ...error instanceof CallStopError && error.stopped.out && !work.stopped_out
      ? { stopped_out: at }
      : {},
    ...report ? { reported: at } : {},
  }
  if (report) {
    caught(
      error instanceof Unsent
        ? new Error(
          'The phone company has not finished releasing the number for an hour',
          { cause: error },
        )
        : error,
      { request: 'finish phone release' },
    )
  }
  if (Object.keys(progress).length) {
    await patch(env, eid, work, { phone_release: progress })
  }
}

export let finishRelease = async (
  env: Env,
  eid: string,
  now = nowOf(env),
): Promise<boolean> => {
  let work = await read(env, eid)
  if (!work) return true
  try {
    await retire(env, work)
  } catch (error) {
    await retrying(env, eid, work, error, now)
    return false
  }
  await patch(env, eid, work, { tombstone: {} })
  return true
}

export let stopCalls = (env: Env, line: string) =>
  finishRelease(env, eidOf(line))

export let returnNumber = async (env: Env, line: string) => {
  let work = await read(env, eidOf(line))
  if (!work?.permanent) {
    let next = releaseWork(line, true, nowOf(env))
    let at = next.phone_release.at
    await stamp(env, {
      entities: [{
        ...next,
        phone_release: {
          ...next.phone_release,
          ...!work ? { stopped_in: at, stopped_out: at } : {},
        },
      }],
    })
  }
  if (await stopCalls(env, line)) return true
  let standing = await held(env, line)
  return !standing || !!standing.returned
}
