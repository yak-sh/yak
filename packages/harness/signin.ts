/** What the harness signs in to, a model provider or an MCP server, as a
 * connection (@yaks/connections) the entity configuring it owns. The attempt
 * in flight is held here, in memory, per owner: nothing of it reaches the graph
 * or a transcript. */
import {
  begin,
  connect,
  CONNECTION,
  credential,
  type Ctx,
  need,
} from '@yaks/connections'
import type { Comp, Eid } from '@yaks/graph'
import type { Attempt } from '@yaks/oauth'
import type { Harness } from './store.ts'

/** Where a service sends the person back. Nothing listens there: they paste
 * the address the browser shows. */
export const REDIRECT = 'http://localhost:8765/oauth/callback'

export type SignIns = ReturnType<typeof signins>

export const signins = (h: Pick<Harness, 'g' | 'vault'>) => {
  const ctx = (redirect: string): Ctx => ({
    graph: h.g,
    vault: h.vault,
    redirect,
    // A client the harness registered is kept on the integration itself.
    client: (i) => i.client ? { id: i.client } : undefined,
  })
  const pending = new Map<Eid, { attempt: Attempt; redirect: string }>()
  // The integration is compared after the read: its name may be a URL.
  const held = async (owner: Eid, integration: string) =>
    (await h.g.read(`.${CONNECTION}.owner=${owner}`)).find((b) =>
      (b[CONNECTION] as Comp).integration == integration
    )?.entity.eid
  return {
    /** The credential `owner` signed in with, once it has. */
    key: async (owner: Eid, integration: string) => {
      const eid = await held(owner, integration)
      return eid ? await credential(ctx(REDIRECT), eid) : undefined
    },
    begin: async (owner: Eid, integration: string, redirect = REDIRECT) => {
      const eid = await held(owner, integration) ??
        (await h.g.apply(await need(h.g.read, { owner, integration })))
          .find((b) => b[CONNECTION])!.entity.eid
      const { url, attempt } = await begin(ctx(redirect), eid)
      pending.set(owner, { attempt, redirect })
      return { url, redirectUrl: redirect }
    },
    complete: async (owner: Eid, integration: string, callback: string) => {
      const was = pending.get(owner)
      pending.delete(owner)
      const eid = await held(owner, integration)
      if (!was || !eid) {
        throw new Error('Authorization expired or not started; begin again')
      }
      await connect(ctx(was.redirect), eid, {
        attempt: was.attempt,
        callback: callback.trim(),
      })
    },
    cancel: (owner?: Eid) => owner ? pending.delete(owner) : pending.clear(),
  }
}
