// One name selects one sender: host capabilities take precedence over the
// built-ins. A missing credential keeps queued letters waiting, untried.
import type { Host } from '@yaks/host'
import type { Transport } from './options.ts'
import type { Sender } from './send.ts'
import { cloudflare } from './cloudflare.ts'
import { resend } from './resend.ts'
import { stash } from './stash.ts'

/** A selected sender or the reason it cannot be constructed yet. */
export let post = (
  said: Transport,
  host?: Pick<Host, 'senders'> | null,
): { sender?: Sender; waiting?: string } => {
  if (host?.senders && Object.hasOwn(host.senders, said.via)) {
    return { sender: host.senders[said.via] }
  }
  if (said.via == 'stash') return { sender: stash() }
  if (said.via == 'resend') {
    return said.token
      ? { sender: resend({ ...said, token: said.token }) }
      : { waiting: 'waiting for credentials: a resend sender needs `token`' }
  }
  if (said.via == 'cloudflare') {
    return said.account && said.token
      ? {
        sender: cloudflare({
          ...said,
          account: said.account,
          token: said.token,
        }),
      }
      : {
        waiting:
          'waiting for credentials: a cloudflare sender needs `account` and `token`',
      }
  }
  return { waiting: `no sender called ${JSON.stringify(said.via)}` }
}
