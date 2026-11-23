import { h } from 'preact'
import { shown } from '@yaks/phone'
import { Unsent } from '@yaks/host/senders'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { revealVoice } from './number-voice.ts'
import { nothingHere, page } from './pages.ts'

/** The browser owner can reveal only their own softphone sign-in. */
export let numberLogin = async (
  req: Request,
  env: Env,
  dir: Directory,
  space: Space,
  person: string,
  eid: string,
) => {
  let line = (await dir.lines(space)).find((l) =>
    l.eid == eid && l.voice && !l.ordering && !l.trashed
  )
  if (!line) return nothingHere(env)
  let title = `Softphone sign-in for ${shown(line.number)}`
  let headers = {
    'cache-control': 'private, no-store',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex',
  }
  if (req.method == 'HEAD') return new Response(null, { headers })
  if (req.method == 'GET') {
    return page(
      env,
      { title, lead: 'Use your sign-in in a SIP softphone.', headers },
      h(
        'form',
        { method: 'post' },
        h('button', { type: 'submit' }, 'Show my sign-in'),
      ),
    )
  }
  if (req.method != 'POST') return nothingHere(env)
  let pending = Symbol('pending sign-in')
  let login = await revealVoice(env, line, person).catch((error) => {
    if (error instanceof Unsent) return pending
    throw error
  })
  if (typeof login == 'symbol') {
    return page(
      env,
      {
        title,
        lead:
          'The phone company is still setting up your sign-in. Try again in a minute.',
        status: 202,
        headers,
      },
      h(
        'form',
        { method: 'post' },
        h('button', { type: 'submit' }, 'Try again'),
      ),
    )
  }
  if (!login) return nothingHere(env)
  return page(
    env,
    { title, lead: 'Enter these details in your SIP softphone.', headers },
    h(
      'dl',
      null,
      ...Object.entries({
        Server: login.server,
        Username: login.user,
        Password: login.password,
      }).flatMap((
        [label, value],
      ) => [h('dt', null, label), h('dd', null, h('code', null, value))]),
    ),
  )
}
