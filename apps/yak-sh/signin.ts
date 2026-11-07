// The one write on yak.sh that leaves the tab (D-138669): the address typed
// into "Get set up on yaks.app" is a `signin_request` in the page's graph, a
// rule fills in yaks.app's sign-in door, and after the commit an effect posts
// the address to that door, which sends the Operator's letter. Its vocabulary
// and its effect, as a package's facets, for yak.ts to compose.
import type { Handlers } from '@yaks/effects'
import type { Host } from '@yaks/host'
import type { Comp } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'

/** yaks.app's sign-in door: `POST /login`, which admits yak.sh's origin
 * (workers/yak/route.ts `askable`). */
export const DOOR = 'https://yaks.app/login'

/** Where the person types, for their draft (@yaks/draft). */
export const PLACE = 'yak.sh:setup'

// A mark's properties, which apply() fills in the first time it is written.
let mark = (when: string) => ({
  at: { type: 'string', format: 'date-time', stamped: true, description: when },
  by: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
  via: { type: 'string', ref: 'entity', death: 'keep', stamped: true },
})

export let signinDoc = {
  title: 'signin',
  $defs: {
    signin_request: {
      component: true,
      type: 'object',
      description: "an ask for yaks.app's sign-in letter, typed on yak.sh",
      properties: {
        address: {
          type: 'string',
          description: 'the email address typed, which the letter goes to',
          examples: ['you@example.com'],
        },
        door: {
          type: 'string',
          format: 'uri',
          description: 'the sign-in door asked for the letter',
        },
      },
    },
    signin_sent: {
      component: true,
      type: 'object',
      description:
        'the door took the ask: its letter goes to the address, if it is one',
      properties: mark('when it was taken'),
    },
    signin_refused: {
      component: true,
      type: 'object',
      description: "the door refused the ask: what was typed isn't an address",
      properties: {
        ...mark('when it was refused'),
        status: { type: 'integer', description: "the door's HTTP status" },
      },
    },
    signin_door: {
      rule: true,
      match:
        `.signin_request !signin_request.door, *signin_request.door="${DOOR}"`,
      description: "An ask that names no door goes to yaks.app's sign-in door.",
    },
    signin_ask: {
      effect: true,
      created: ['signin_request'],
      tries: 6,
      description:
        "Post the address to the door, which sends yaks.app's sign-in letter, and record whether it took the ask. A door out of reach or busy is tried again.",
    },
  },
} as unknown as VocabDoc

/** The vocabulary facet. */
export let vocab = { docs: [signinDoc] }

/** An answer the door gave that asks to be tried again later. */
let again = (said: string) => Object.assign(new Error(said), { retry: {} })

/** The effects facet: `signin_ask`, posting through the host's `fetch`. */
export let effects = {
  effects: (host?: Pick<Host, 'fetch'>): Handlers => ({
    signin_ask: async (event, tx, write) => {
      let [b] = await tx.get([event.entity.eid])
      let ask = b?.signin_request as Comp | undefined
      if (!ask || b.signin_sent || b.signin_refused) return
      let post = host?.fetch ?? fetch
      let res = await post(String(ask.door), {
        method: 'POST',
        body: new URLSearchParams({ address: String(ask.address) }),
      }).catch((e) => {
        throw again(`yak.sh: ${ask.door} is out of reach: ${e?.message ?? e}`)
      })
      await res.body?.cancel()
      // The door's answer to what was typed: not an address. Expected, so
      // nothing is reported, and asking again would get the same answer.
      if (res.status == 400) {
        return await write([{
          entity: event.entity,
          signin_refused: { status: res.status },
        }])
      }
      if (!res.ok) throw again(`yak.sh: ${ask.door} answered ${res.status}`)
      await write([{ entity: event.entity, signin_sent: {} }])
    },
  }),
}
