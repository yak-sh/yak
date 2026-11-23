// The kernel's door to a space's Builder, the object its Operator runs in:
// its request protocol, independent of the Durable Object itself.
import { audit } from './admin-action.ts'
import { jittered } from '@yaks/durable-object/resets'
import { type Level, level } from '@yaks/member'
import { ahead, fetchOf, HEARD, WAKE } from './door.ts'
import type { Space } from './directory.ts'
import { type Settings, worn } from './operator-persona.ts'
import type { Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { url } from '@yaks/platform/host'
import { chatPath, managePath } from '@yaks/platform/routes'
import { answered } from './meta.ts'
import { type Call, type Door, finite } from '@yaks/durable-object/door'

/** What a socket remembers about itself across a hibernation: who is on the
 * other end, and which space they opened it in. The attachment is the only
 * memory a socket has, and 2KB is far more than these three want. */
export type Held = {
  person: string
  role: Level | null
  space: string
  administrative?: boolean
  // What the space's Operator is called, and where a conversation opens by
  // its id, for a page watching it.
  called?: string
  opens?: string
}

/** Whether a socket's attachment is one its Operator store's @yaks/api door
 * holds (operator-api.ts): the read it was opened with, as
 * @yaks/durable-object's `sockets` keeps it, rather than a `Held`. */
export let paged = (attached: unknown): boolean =>
  !!attached && typeof attached == 'object' && 'read' in attached

/** The header the kernel names the space with at the handshake — the object's
 * own name is that eid, and this is how it learns it. */
export let SPACE = 'x-space-eid'

/** The header the kernel says the space it read in, beside its vouch for the
 * asker's seat there (session.ts `vouched`): the object takes the kernel's
 * word for both, as a store does, rather than reading them again. */
export let SEAT = 'x-yak-seat'

/** The headers saying `space` and `who`'s seat in it (`SEAT`). */
export let seated = (space: Space, who: Who): Record<string, string> => ({
  [SPACE]: space.eid,
  // A header holds Latin-1 alone, and a title or a name may not.
  [SEAT]: encodeURIComponent(JSON.stringify(space)),
  ...vouched(who),
})

/** The space and seat the kernel said (`seated`), or null where it said
 * none: a caller that read no seat, whose word is only who is asking. */
export let seatOf = (headers: Headers) => {
  let space = headers.get(SEAT)
  let role = headers.get('x-yak-role')
  return space == null ? null : {
    space: JSON.parse(decodeURIComponent(space)) as Space,
    role: role ? level(role) : null,
    administrative: headers.get('x-yak-administrative') == '1',
  }
}

/** A request carried on to the object, with none of the words the kernel
 * vouches in left from its caller: the kernel says those itself. */
export let carried = (to: string, req: Request): Request => {
  let out = new Request(to, req)
  for (let [h] of [...out.headers]) {
    if (h == SPACE || h.startsWith('x-yak-')) out.headers.delete(h)
  }
  return out
}

/** Nobody is refused at the handshake rather than mid-conversation. */
export let NOBODY = 'sign in to build here'
export let NOT_A_WRITER = 'only a member who writes can build here'

/** The header an answer says its object owes work in: what an incarnation
 * takes up from the one before it (build.ts `#owed`), which the object starts
 * on a wake, never behind an answer someone waits for. */
export let OWED = 'x-yak-owed'

/** This space's object. The name is the space's eid, which never moves — a
 * slug does. A request's waits on it are its `operator_wait` (timing.ts).
 *
 * An answer that says the object owes work (`OWED`) is had whole here, and the
 * object woken behind it (`woken`): the runtime sends an answer on in turns
 * of the object's event loop, so work the object began as its code let the
 * answer go held a first chat page 81-140 ms (T-149700), and only the caller
 * knows when the answer has arrived. A socket's 101, or a live stream, has
 * arrived as it is answered; a file, never held whole (door.ts `finite`),
 * once its last byte has passed. */
export let builderOf = (env: Env, space: string) => {
  let ask = fetchOf(env.BUILDER, space, jittered(env.CLOCK), 'operator_wait')
  return async (make: () => Request, options?: Call): Promise<Response> => {
    let answer = await ask(make, options)
    if (!answer.headers.has(OWED)) return answer
    let live = !answer.body || answer.status == 101 ||
      /ndjson|event-stream/.test(answer.headers.get('content-type') ?? '')
    if (live) {
      woken(env, space)
      return answer
    }
    if (finite(answer)) {
      let had = new Response(await answer.arrayBuffer(), answer)
      woken(env, space)
      return had
    }
    // A file has arrived once its last byte has passed.
    return new Response(
      answer.body!.pipeThrough(
        new TransformStream({ flush: () => woken(env, space) }),
      ),
      answer,
    )
  }
}

type Wiring = Pick<Env, 'BUILDER' | 'CLOCK'>

let signal = (env: Wiring, space: string, path: string) =>
  fetchOf(env.BUILDER, space, jittered(env.CLOCK))(() =>
    new Request('https://builder' + path, {
      method: 'POST',
      headers: { 'x-yak-kernel': '1' },
    })
  )

/** Wake the space's object (door.ts `WAKE`), ahead of what a person will ask
 * its Operator or behind an answer that says it owes work: it comes up as any
 * request brings it, makes what a read of the Operator needs, and takes up
 * what its incarnation owes, since nobody waits on this answer. */
export let woken = (
  env: Env,
  space: string,
  retain?: (work: Promise<void>) => void,
): void =>
  ahead(
    () => signal(env, space, WAKE),
    { request: 'operator wake', space },
    retain,
  )

/** An app the space's Operator watches committed (graph.ts `#herald`): its
 * subscriptions over the space look again a beat later (build.ts `HEARD`).
 * 204 while one watches the space, 410 once none does. */
export let heard = (env: Wiring, space: string) => signal(env, space, HEARD)

/** A restored space's pending Operator work is due again. */
export let reviveBuilder = async (env: Wiring, space: string) => {
  let response = await signal(env, space, '/revive')
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`)
  }
  await response.body?.cancel()
}

/**
 * A space's conversation, buried (T-34371). erase.ts is the only caller, and
 * it makes this call before the directory tombstone like everything else
 * outside the directory: a wipe that fails leaves the space still named, and
 * asking again finishes it, where a wipe after the row would leave a
 * transcript nothing points at and nobody could ask about again.
 *
 * It throws on a refusal for that reason — a delete that says a space is gone
 * has to have taken the conversation with it.
 */
export let wiped = async (env: Env, space: string) => {
  let r = await builderOf(env, space)(
    () =>
      new Request('http://builder/wipe', {
        method: 'POST',
        headers: { 'x-yak-kernel': '1' },
      }),
  )
  if (!r.ok) throw new Error(await r.text())
  await r.body?.cancel()
}

/**
 * The space's Operator as a restore asks it (recover.ts `putBack`): its own
 * `/restore` and `/restart` (build.ts), with the kernel's word on each and
 * nothing of any client's. Never sent twice: a restart's reset is its answer.
 */
export let operatorRecovery = (
  env: Env,
  space: string,
): Pick<Door, 'consume'> => ({
  consume: async (path, read, init, headers) =>
    read(
      await builderOf(env, space)(() =>
        new Request('http://builder' + path, {
          ...init as RequestInit,
          headers: { ...headers, 'x-yak-kernel': '1', [SPACE]: space },
        }), { replayable: false }),
    ),
})

/**
 * A line posted to a space's old builder door, `/api/build` (ladder.ts
 * `BUILD`), by a page drawn before the New app screen sent its words to the
 * Operator (M-37853): said in the person's conversation as that screen says
 * it, and the person sent to that conversation.
 *
 * apps.ts is the only caller, and it has already said who is asking.
 */
export let forwarded = async (
  env: Env,
  space: Space,
  req: Request,
  who: Who,
): Promise<Response> => {
  let form = await req.formData()
  let say = String(form.get('say') ?? '').trim()
  let request = crypto.randomUUID()
  if (say) {
    await operatorDoor(env, space, who, 'receive', {
      say,
      request: {
        channel: 'chat',
        files: [],
        page: url(env, managePath('new', space.slug)),
        new_app: true,
      },
      options: { id: request },
    })
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: url(env, chatPath(space.slug, say ? request : undefined)),
    },
  })
}

/** A request to a space's Operator, in its builder object, as `who` in
 * `space`, both as the caller read them (operator-host.ts
 * `operatorRequest`): its answer, or the refusal thrown. */
export let operatorDoor = async (
  env: Env,
  space: Space,
  who: Who,
  path: string,
  args: unknown,
) => {
  if (who.administrative && ['read', 'work', 'conversation'].includes(path)) {
    let asked = (args ?? {}) as { task?: string; open?: string }
    let target = asked.task || asked.open
    await audit(env, who, {
      operation: `operator_${path}`,
      space: space.eid,
      ...target ? { target } : {},
    })
  }
  let response = await builderOf(env, space.eid)(() =>
    new Request(`https://builder/operator/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...seated(space, who),
      },
      body: JSON.stringify(args),
    })
  )
  if (!response.ok) throw await answered(response)
  return response.json()
}

/** `space` as its Operator's settings say, read off its persona in its
 * store after writing `set` there, when given (operator-persona.ts
 * `setting`). A caller that read no seat sends none, and the object reads
 * it. */
export let settingsAt = async (
  env: Env,
  space: Space,
  who: Who,
  set?: Settings,
): Promise<Space> => {
  let response = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/settings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...who.role ? seated(space, who) : { [SPACE]: space.eid },
        ...vouched(who),
      },
      body: JSON.stringify(set ? { set } : {}),
    })
  )
  if (!response.ok) throw await answered(response)
  return worn(space, await response.json())
}

/** The kernel has checked the app's public access or the caller's membership. */
export let resultDoor = async (
  env: Env,
  space: Pick<Space, 'eid'>,
  reader: string,
  path: string,
  args: Record<string, unknown>,
) => {
  let response = await builderOf(env, space.eid)(() =>
    new Request(`https://builder/result/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        [SPACE]: space.eid,
      },
      body: JSON.stringify({ ...args, reader }),
    })
  )
  if (!response.ok) throw await answered(response)
  return response.json()
}
