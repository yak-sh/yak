// Platform letters at the portable Sender boundary. Sign-in codes are never
// stored, so only a transport's definite Unsent refusal retries in this call.
import type { Env } from './env.ts'
import { esc } from './html.ts'
import { type Sender, Unsent } from '@yaks/mail'
import { FROM } from './mail-config.ts'
import { type Delivery, sink, transport } from './post.ts'
import { posts } from './config.ts'
import { type Host, replyTo } from './host.ts'
export { FROM, REPLY_TO } from './mail-config.ts'

export type Letter = {
  to: string | string[]
  subject: string
  body: string
  replyTo?: string
}
export type Mail = (l: Letter) => Promise<void>

// Explicitly local only: a deploy with no sender must never log sign-in codes.
export let printed = (): Mail => (l) => {
  console.log(`yak-mail ${JSON.stringify({ from: FROM, ...l })}`)
  return Promise.resolve()
}

let TRIES = 3
let PAUSE = 2000
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export let sending = (
  sender: Sender,
  env: Host = {},
  pause = sleep,
): Mail =>
async (l) => {
  let message = {
    from: FROM,
    name: 'yaks.app',
    to: l.to,
    replyAddress: l.replyTo ?? replyTo(env),
    subject: l.subject,
    text: l.body,
    html: `<p>${esc(l.body).replaceAll('\n\n', '</p><p>')}</p>`,
  }
  for (let tried = 1;; tried++) {
    try {
      await sender.send(message)
      return
    } catch (e) {
      if (!(e instanceof Unsent) || tried >= TRIES) throw e
      await pause(Math.min(e.retry.after, PAUSE))
    }
  }
}

type Posting = Delivery & Pick<Env, 'MAIL_DEV' | 'APEX' | 'LOCAL_DEV'>

export let mailable = async (env: Posting) =>
  env.MAIL_DEV == '1' || !!(await transport(env, posts.platform)).sender

export let mail = (env: Posting): Mail => {
  let send: Mail = env.MAIL_DEV == '1' ? printed() : async (letter) => {
    let { sender, waiting } = await transport(env, posts.platform)
    if (!sender) throw new Error(`mail is not configured: ${waiting}`)
    return sending(sender, env)(letter)
  }
  return (letter) =>
    send({ ...letter, ...sink(env, letter.to, letter.subject) })
}
