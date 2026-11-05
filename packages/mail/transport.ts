// One name selects one sender. Providers own their configuration; mail owns
// the selection and leaves unavailable senders' durable letters waiting.
import type { Host } from '@yaks/host'
import type { Transport } from './options.ts'
import type { Sender } from './send.ts'
import { configured as cloudflare } from '@yaks/cloudflare-mail/sender'
import { configured as resend } from '@yaks/resend/sender'
import { stash } from './stash.ts'

type Selected = { sender?: Sender; waiting?: string }
let providers: Record<string, (options: Transport) => Selected> = {
  cloudflare,
  resend,
  stash: () => ({ sender: stash() }),
}

/** A selected host capability or provider, or why it cannot be built yet. */
export let post = (
  said: Transport,
  host?: Pick<Host, 'senders'> | null,
): Selected => {
  if (host?.senders && Object.hasOwn(host.senders, said.via)) {
    return { sender: host.senders[said.via] }
  }
  return Object.hasOwn(providers, said.via)
    ? providers[said.via]({ ...said, ...said.providers?.[said.via] })
    : { waiting: `no sender called ${JSON.stringify(said.via)}` }
}
