// Carrier work stays in the directory through timeouts and worker restarts.
import { token } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
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
  reported?: string
}

let eidOf = (line: string) => derivedEid(`phone-release|${line}`)
let nowOf = (env: Env) => new Date(env.CLOCK?.now() ?? Date.now())

export let releaseWork = (line: string, permanent: boolean, now: Date) => ({
  entity: { eid: eidOf(line) },
  phone_release: { line, at: now.toISOString(), permanent },
  wake: {
    at: new Date(now.getTime() + 90_000).toISOString(),
    every: '*/2 * * * *',
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

let retire = async (env: Env, work: Release) => {
  let id = idOf(work.line)
  let [row] = await meta(env).query(q`.entity.eid=${id}&?phone_line&?trashed`, {
    live: true,
  })
  let dir = directoryOf(env.STORE)
  if (!row?.phone_line) {
    if (work.permanent) await dir.purgeTrashEntities([id])
    return
  }
  let line = lineOf(row as Row)
  if (!line.trashed) return
  if (work.permanent) {
    await released(env, line)
    await dir.purgeTrashEntities([id])
    return
  }
  await syncVoice(env, line, { in: false, out: false })
  let standing = await dir.heldLine(line.number)
  if (standing?.line.eid == id && !standing.line.trashed) {
    let space = await spaceNow(env, line.space)
    await syncVoice(env, standing.line, voiceOf(false, space, nowOf(env)))
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
    if (!work.reported && now.getTime() - Date.parse(work.at) >= 3_600_000) {
      caught(error, { request: 'finish phone release' })
      await stamp(env, {
        entities: [{
          entity: { eid },
          phone_release: { reported: now.toISOString() },
        }],
      })
    }
    return false
  }
  try {
    await stamp(env, {
      entities: [{
        entity: { eid },
        $was: {
          phone_release: {
            permanent: token(work.permanent),
            at: token(work.at),
          },
        },
        tombstone: {},
      }],
    })
  } catch (error) {
    if (!(error instanceof Stale)) throw error
  }
  return true
}

export let stopCalls = (env: Env, line: string) =>
  finishRelease(env, eidOf(line))

export let returnNumber = async (env: Env, line: string) => {
  if (!await returning(env, line)) {
    await stamp(env, { entities: [releaseWork(line, true, nowOf(env))] })
  }
  return stopCalls(env, line)
}
