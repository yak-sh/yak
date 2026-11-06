// One name selects one sender. The host lends its senders by name, a provider
// among them by naming its plugin in the config (@yaks/resend,
// @yaks/cloudflare-mail); mail owns the selection and leaves a letter waiting
// while its sender cannot send.
import type { Host } from '@yaks/host'
import type { Built } from '@yaks/host/senders'
import type { Transport } from './options.ts'
import { stash } from './stash.ts'

/** The sender a name selects from the host's, or why it cannot send yet.
 * `stash` is the built-in one that keeps letters in memory. */
export let post = (
  said: Transport,
  host?: Pick<Host, 'senders'> | null,
): Built => {
  if (host?.senders && Object.hasOwn(host.senders, said.via)) {
    let sender = host.senders[said.via]
    let waiting = sender.waiting?.()
    return waiting ? { waiting } : { sender }
  }
  return said.via == 'stash'
    ? { sender: stash() }
    : { waiting: `no sender called ${JSON.stringify(said.via)}` }
}
