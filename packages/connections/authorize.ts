/** Terminal authorization over integration data. Discovery and unattended
 * callbacks can be supplied by a CLI host without depending on the harness. */
import type { Eid, Graph } from '@yaks/graph'
import { Refused } from '@yaks/graph'
import type { Vault } from '@yaks/secrets'
import { install, type Integration } from './integrations.ts'
import { REDIRECT, signins } from './signin.ts'

export type AuthAction = 'list' | 'begin' | 'complete' | 'cancel'
export type Callback = { callback: string; session?: string }
export type AuthReply = {
  servers?: string[]
  message?: string
  url?: string
  redirectUrl?: string
}
export type AuthTarget = { integration: string; redirect?: string }
export type AuthOptions = {
  /** Discover/register an unknown integration, returning its name and redirect. */
  prepare?: (name: string, as?: string) => Promise<AuthTarget | undefined>
  /** An unattended sign-in returns its private callback and optional website session. */
  callback?: (
    target: AuthTarget,
    url: string,
    as?: string,
  ) => Promise<Callback | undefined>
}
export let authorize = (
  h: { graph: Graph; vault: Vault; owner?: Eid },
  options: AuthOptions = {},
) => {
  let signin = signins({ g: h.graph, vault: h.vault })
  let targets = new Map<string, AuthTarget>()
  let replies = new Map<string, Callback>()
  let seed = async () => {
    let batch = await install(h.graph.read)
    if (batch.length) await h.graph.apply(batch, { trusted: true })
  }
  let run = async (
    action: AuthAction,
    name?: string,
    callback?: string | Callback,
    as?: string,
  ): Promise<AuthReply> => {
    await seed()
    let integrations = (await h.graph.read('.integration')).map((b) =>
      b.integration as Integration
    )
    if (action == 'list') {
      return { servers: integrations.map((i) => i.title ?? i.name) }
    }
    if (!h.owner) {
      throw new Refused('A configured person is required to sign in')
    }
    if (!name) throw new Refused('Name an integration to sign in')
    let target = targets.get(name)
    if (action == 'begin') {
      target = await options.prepare?.(name, as)
      if (!target) {
        let found = integrations.find((i) => i.name == name || i.title == name)
        if (found) target = { integration: found.name }
      }
      if (!target) throw new Refused('Unknown integration')
      target = {
        ...target,
        redirect: target.redirect ??
          (target.integration == 'openai'
            ? 'http://127.0.0.1:1455/auth/callback'
            : REDIRECT),
      }
      targets.set(name, target)
      let begun = await signin.begin(
        h.owner,
        target.integration,
        target.redirect,
      )
      let automatic = await options.callback?.(target, begun.url, as)
      if (automatic) replies.set(name, automatic)
      return begun
    }
    if (action == 'cancel') {
      signin.cancel(h.owner)
      targets.clear()
      replies.clear()
      return { message: 'Authorization cancelled' }
    }
    if (!target) {
      throw new Refused('Authorization expired or not started; begin again')
    }
    let returned = replies.get(name) ??
      (typeof callback == 'string' ? { callback } : callback)
    if (!returned) throw new Refused('Paste the complete return URL')
    await signin.complete(
      h.owner,
      target.integration,
      returned.callback,
      returned.session,
    )
    targets.delete(name)
    replies.delete(name)
    return {
      message: `${
        integrations.find((i) => i.name == target!.integration)?.title ??
          target.integration
      } connected.`,
    }
  }
  return {
    run,
    /** A bot callback is already held privately and needs no terminal paste. */
    returned: (name: string) => replies.has(name),
    close: () => {
      signin.cancel()
      targets.clear()
      replies.clear()
      return Promise.resolve()
    },
  }
}
