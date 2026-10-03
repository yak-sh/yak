/** Private sign-in attempts; completed grants belong to connections in the vault. */
import {
  begin,
  connect,
  CONNECTION,
  credential,
  type Ctx,
  need,
  pick,
  refresh,
} from './connections.ts'
import type { Eid, Graph } from '@yaks/graph'
import type { Vault } from '@yaks/secrets'
import type { Attempt } from '@yaks/oauth'

/** Where a service sends the person back. Nothing listens there: they paste
 * the address the browser shows. */
export const REDIRECT = 'http://localhost:8765/oauth/callback'

export type SignIns = {
  key: (owner: Eid, integration: string) => Promise<string | undefined>
  refresh: (
    owner: Eid,
    integration: string,
    stale: string,
  ) => Promise<string | undefined>
  begin: (
    owner: Eid,
    integration: string,
    redirect?: string,
  ) => Promise<{ url: string; redirectUrl: string }>
  complete: (
    owner: Eid,
    integration: string,
    callback: string,
    session?: string,
  ) => Promise<void>
  cancel: (owner?: Eid) => void
}

export const signins = (h: { g: Graph; vault: Vault }): SignIns => {
  const ctx = (redirect: string): Ctx => ({
    graph: h.g,
    vault: h.vault,
    redirect,
  })
  const pending = new Map<
    string,
    { eid: Eid; attempt: Attempt; redirect: string }
  >()
  const slot = (owner: Eid, integration: string) =>
    JSON.stringify([owner, integration])
  const held = async (owner: Eid, integration: string) =>
    (await pick(h.g.read, owner, integration))?.entity.eid
  return {
    /** The credential `owner` signed in with, once it has. */
    key: async (owner: Eid, integration: string) => {
      const eid = await held(owner, integration)
      return eid ? await credential(ctx(REDIRECT), eid) : undefined
    },
    /** Rotate a rejected bearer unless another caller already replaced it. */
    refresh: async (owner: Eid, integration: string, stale: string) => {
      const eid = await held(owner, integration)
      return eid ? await refresh(ctx(REDIRECT), eid, stale) : undefined
    },
    begin: async (owner: Eid, integration: string, redirect = REDIRECT) => {
      const eid =
        (await h.g.apply(await need(h.g.read, { owner, integration })))
          .find((b) => b[CONNECTION])!.entity.eid
      const { url, attempt } = await begin(ctx(redirect), eid)
      pending.set(slot(owner, integration), { eid, attempt, redirect })
      return { url, redirectUrl: redirect }
    },
    complete: async (
      owner: Eid,
      integration: string,
      callback: string,
      session?: string,
    ) => {
      const was = pending.get(slot(owner, integration))
      if (!was) {
        throw new Error('Authorization expired or not started; begin again')
      }
      await connect(ctx(was.redirect), was.eid, {
        attempt: was.attempt,
        callback: callback.trim(),
        session,
      })
      pending.delete(slot(owner, integration))
    },
    cancel: (owner?: Eid) => {
      if (!owner) return pending.clear()
      for (const key of pending.keys()) {
        if (JSON.parse(key)[0] == owner) pending.delete(key)
      }
    },
  }
}
