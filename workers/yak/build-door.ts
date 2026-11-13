// The kernel's door to a space's Builder: its request protocol and socket
// frames, independent of the Durable Object that keeps the conversation.
import { jittered } from '@yaks/durable-object/resets'
import { type Level, level } from '@yaks/member'
import { ahead, fetchOf, WAKE } from './door.ts'
import type { Space } from './directory.ts'
import { type Settings, worn } from './operator-persona.ts'
import type { Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { answered } from './meta.ts'

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
export let carried = (url: string, req: Request): Request => {
  let out = new Request(url, req)
  for (let [h] of [...out.headers]) {
    if (h == SPACE || h.startsWith('x-yak-')) out.headers.delete(h)
  }
  return out
}

/** Where the page finds it: a space's own address, ahead of every app in it
 * (router.ts PLATFORM_PATHS `/api/*`), because a person with no app yet is
 * exactly who the builder is for. */
export let BUILD = '/api/build'

/** A line said while a build is running (build.ts `#hold`): kept, and
 * taken up once the build ends, said as the builder says everything: a
 * sentence. */
export let WAIT =
  'I am still building the last thing you asked for. I have kept what you ' +
  'said, and I will take it up as soon as I finish.'

/** A line said while the space's Builder is stopped for the rows it spent,
 * `s` seconds more (build.ts `#hold`): kept, and taken up then. */
export let HELD = (s: number) =>
  `Building is paused here for ${s} s. I have kept what you said, and I ` +
  'will take it up then.'

/** A person's line to a space's Builder, as its `/say` door takes it: what
 * the form with no script posts (`posting`), and what the Builder keeps of a
 * line it cannot answer yet (build.ts `#hold`). */
export let saying = (held: Held, text: string): Request =>
  new Request('http://builder/say', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SPACE]: held.space,
      'x-yak-person': held.person,
      'x-yak-role': held.role ?? '',
    },
    body: JSON.stringify({ say: text }),
  })

/** Who said a line `saying` made, as its headers say. */
export let sayer = (headers: Headers): Held => {
  let role = headers.get('x-yak-role')
  return {
    person: headers.get('x-yak-person') ?? '',
    role: role ? level(role) : null,
    space: headers.get(SPACE) ?? '',
  }
}

/** Nobody is refused at the handshake rather than mid-conversation. */
export let NOBODY = 'sign in to build here'
export let NOT_A_WRITER = 'only a member who writes can build here'

/** A frame, as it goes down the socket. One key names it. */
export type Frame =
  | { said: 'person' | 'builder'; text: string }
  | { tool: string; call: string; line: string }
  | { ran: string; call: string; line: string; ok: boolean }
  | { built: string }
  | { done: string; refused?: string }
  | { ready: true; building: boolean }
  | { busy: string }

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
 * knows when the answer has arrived. A socket's 101, or a stream, has arrived
 * as it is answered. */
export let builderOf = (env: Env, space: string) => {
  let ask = fetchOf(env.BUILDER, space, jittered(env.CLOCK), 'operator_wait')
  return async (make: () => Request): Promise<Response> => {
    let answer = await ask(make)
    if (!answer.headers.has(OWED)) return answer
    let had = !answer.body || answer.status == 101 ||
        /ndjson|event-stream/.test(answer.headers.get('content-type') ?? '')
      ? answer
      : new Response(await answer.arrayBuffer(), answer)
    woken(env, space)
    return had
  }
}

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
    () =>
      fetchOf(env.BUILDER, space, jittered(env.CLOCK))(() =>
        new Request('https://builder' + WAKE, {
          method: 'POST',
          headers: { 'x-yak-kernel': '1' },
        })
      ),
    { request: 'operator wake', space },
    retain,
  )

/**
 * The handshake, carried to the object with the kernel's own vouch on it and
 * nothing of the client's. apps.ts is the only caller: `/api/build` on a
 * space's hostname. The upgrade request is the init, which is how the
 * `Upgrade` header reaches the object (door.ts, same reason).
 */
export let joining = (env: Env, space: string, req: Request, who: Who) =>
  builderOf(env, space)(() => {
    let out = carried('http://builder/ws', req)
    out.headers.set(SPACE, space)
    if (who.person) out.headers.set('x-yak-person', who.person)
    if (who.role) out.headers.set('x-yak-role', who.role)
    return out
  })

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
 * The other door on the same address (T-34242): a plain form POST, from a
 * browser that ran no script. One line, the round waited for, and a page back
 * — the way a drop answers a page rather than a code (drop.ts, same reason).
 *
 * apps.ts is the only caller, and it has already said who is asking.
 */
export let posting = async (
  env: Env,
  space: Space,
  req: Request,
  who: Who,
): Promise<Response> => {
  // The page it answers is the gateway's, loaded there already; the
  // builder's object, which shares this module's words, never draws one.
  let { building } = await import('./pages.ts')
  let form = await req.formData()
  let text = String(form.get('say') ?? '').trim()
  if (!text) {
    return building({ space: space.slug, why: 'Say what you want built.' }, env)
  }
  let asked = await builderOf(env, space.eid)(() =>
    saying({
      person: who.person ?? '',
      role: who.role ? level(who.role) : null,
      space: space.eid,
    }, text)
  )
  if (!asked.ok) {
    let said = await asked.json() as { message?: string }
    return building({ space: space.slug, why: said.message ?? NOBODY }, env)
  }
  let { frames } = await asked.json() as { frames: Frame[] }
  return building({ space: space.slug, frames }, env)
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
