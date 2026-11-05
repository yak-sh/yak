// The kernel's door to a space's Builder: its request protocol and socket
// frames, independent of the Durable Object that keeps the conversation.
import { jittered } from '@yaks/durable-object'
import type { Level } from '@yaks/member'
import { fetchOf } from './door.ts'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { building } from './pages.ts'
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
}

/** The header the kernel names the space with at the handshake — the object's
 * own name is that eid, and this is how it learns it. */
export let SPACE = 'x-space-eid'

/** Where the page finds it: a space's own address, ahead of every app in it
 * (router.ts PLATFORM_PATHS `/api/*`), because a person with no app yet is
 * exactly who the builder is for. */
export let BUILD = '/api/build'

/** A second build, asked for while the first is running. A wait, said as the
 * builder says everything: a sentence. */
export let WAIT =
  'I am still building the last thing you asked for — let me finish, and ' +
  'then say that again.'

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

/** This space's object. The name is the space's eid, which never moves — a
 * slug does. */
export let builderOf = (env: Env, space: string) =>
  fetchOf(env.BUILDER, space, jittered(env.CLOCK))

/**
 * The handshake, carried to the object with the kernel's own vouch on it and
 * nothing of the client's. apps.ts is the only caller: `/api/build` on a
 * space's hostname. The upgrade request is the init, which is how the
 * `Upgrade` header reaches the object (door.ts, same reason).
 */
export let joining = (env: Env, space: string, req: Request, who: Who) =>
  builderOf(env, space)(() => {
    let out = new Request('http://builder/ws', req)
    for (let h of [SPACE, 'x-yak-person', 'x-yak-role', 'x-yak-kernel']) {
      out.headers.delete(h)
    }
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
  let form = await req.formData()
  let text = String(form.get('say') ?? '').trim()
  if (!text) {
    return building({ space: space.slug, why: 'Say what you want built.' }, env)
  }
  let asked = await builderOf(env, space.eid)(
    () =>
      new Request('http://builder/say', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SPACE]: space.eid,
          'x-yak-person': who.person ?? '',
          'x-yak-role': who.role ?? '',
        },
        body: JSON.stringify({ say: text }),
      }),
  )
  if (!asked.ok) {
    let said = await asked.json() as { message?: string }
    return building({ space: space.slug, why: said.message ?? NOBODY }, env)
  }
  let { frames } = await asked.json() as { frames: Frame[] }
  return building({ space: space.slug, frames }, env)
}

/** A request to a space's Operator, in its builder object, as `who`
 * (operator-host.ts `operatorRequest`): its answer, or the refusal thrown. */
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
        [SPACE]: space.eid,
        ...vouched(who),
      },
      body: JSON.stringify(args),
    })
  )
  if (!response.ok) throw await answered(response)
  return response.json()
}
