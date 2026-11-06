/// <reference types="chrome" />
// The extension's service worker: it signs the person in, holds the socket to
// their space, and answers each call from the tab they are on. Every decision
// is a pure module's; this file only reaches the browser. The build bundles it
// with a line that calls `start` with the configuration.

import { backoff } from '@yaks/fp'
import { client as oauth, OAuthError } from '@yaks/oauth'
import { answer, type Call, callOf, PING } from './wire.ts'
import { answering, asks, lends, needs, type Seen } from './answer.ts'
import { allowed, ask, NONE, site } from './consent.ts'
import { type Config, socket } from './connect.ts'
import { aims } from './act.ts'
import { GIVE, pop } from './give.ts'
import { kept, provider, register } from './signin.ts'
import { asked } from './screen.ts'
import { PERSON } from './tools.ts'
import { badge, keep, local, said, stored, until } from './chrome.ts'

// Often enough that neither the socket nor the service worker goes idle.
let BEAT = 20_000

let SIGNED_OUT = (config: Config) =>
  `${config.name} no longer accepts this sign-in. Sign in again.`

/** What the tab the person is on gives for a call, on a site they allowed,
 * waiting on the person until `by`: a site not allowed is asked about, and a
 * screenshot Chrome refuses until the person clicks the extension's button
 * waits for that click, which opening the popup is. */
let look = async (
  call: Call['call'],
  by = Date.now() + PERSON,
): Promise<Seen> => {
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  let { consent = NONE } = await stored()
  let url = tab?.url ?? ''
  let on = site(aims(call, url))
  let seen: Seen = {
    url,
    title: tab?.title,
    allowed: !!on && allowed(on)(consent),
  }
  let asking = asks(call, seen)
  if (asking) {
    await keep({ consent: ask(asking)(consent) })
    pop()
    let yes = await until(
      ({ consent = NONE }) =>
        allowed(asking)(consent)
          ? true
          : consent.asking != asking
          ? false
          : undefined,
      by - Date.now(),
    )
    return yes
      ? look(call, by)
      : { ...seen, answered: yes == false ? 'no' : 'none' }
  }
  let need = needs(call.tool)
  if (seen.allowed && need && tab?.id != null) {
    let given = GIVE[need](
      call,
      { id: tab.id, windowId: tab.windowId, url },
      by,
    )
    Object.assign(seen, await given.catch((e) => ({ failed: said(e) })))
  }
  let lend = lends(call, seen)
  if (!lend || Date.now() >= by) return seen
  await keep({ lend })
  let clicked = await until((s) => s.lend ? undefined : true, by - Date.now())
  if (clicked) return look(call, by)
  await keep({ lend: undefined })
  return seen
}

export let start = (config: Config): void => {
  let store = kept(local)
  let redirect = chrome.identity.getRedirectURL()
  let grant = (id: string) =>
    oauth(provider(config, id), { store, key: 'grant', redirect })

  let ws: WebSocket | undefined
  let tries = 0
  let retry: ReturnType<typeof setTimeout> | undefined

  // Each close ends a turn, and a connect that a close overtook while it
  // waited on storage or the token opens no socket.
  let turn = 0

  let close = () => {
    turn++
    clearTimeout(retry)
    let was = ws
    ws = undefined
    was?.close()
  }

  let later = () => {
    keep({ link: 'offline' })
    retry = setTimeout(connect, backoff(++tries))
  }

  let connect = async (): Promise<void> => {
    close()
    let mine = turn
    let { client, space } = await stored()
    if (!client || !space) return keep({ link: undefined })
    let token: string | undefined
    try {
      token = await grant(client.id).token()
    } catch (e) {
      // A grant the host refused is gone, and the person signs in again; any
      // other failure is the network's, and a later try may get through.
      return e instanceof OAuthError && e.code == 'invalid_grant'
        ? keep({ grant: undefined, link: undefined, error: SIGNED_OUT(config) })
        : later()
    }
    if (!token) return keep({ link: undefined })
    if (mine != turn) return
    let { url, protocols } = socket(config, { token, space })
    let s = ws = new WebSocket(url, protocols)
    let beat = setInterval(
      () => s.readyState == WebSocket.OPEN && s.send(PING),
      BEAT,
    )
    s.onopen = () => {
      tries = 0
      keep({ link: 'connected', error: undefined })
    }
    s.onmessage = async (e) => {
      let call = callOf(e.data)
      if (call) s.send(answer(answering(call, await look(call)).answer))
    }
    s.onclose = () => {
      clearInterval(beat)
      if (ws != s) return
      ws = undefined
      later()
    }
    await keep({ link: 'connecting' })
  }

  let signin = async () => {
    let { client } = await stored()
    let id = client?.redirect == redirect
      ? client.id
      : await register(config, redirect)
    await keep({ client: { redirect, id } })
    let { url, attempt } = await grant(id).begin()
    let back = await chrome.identity.launchWebAuthFlow({
      url,
      interactive: true,
    })
    if (!back) throw new Error('Signing in was cancelled.')
    await grant(id).complete(attempt, back)
    await connect()
  }

  let signout = async () => {
    close()
    await keep({ grant: undefined, space: undefined, link: undefined })
  }

  // What the popup asks for, by name.
  let DOES: Record<string, () => Promise<unknown>> = {
    signin,
    signout,
    connect,
  }

  chrome.runtime.onMessage.addListener((m, _, reply) => {
    let does = DOES[m?.do]
    if (!does) return false
    keep({ error: undefined }).then(does)
      .catch((e) => keep({ error: said(e) }))
      .finally(() => reply({}))
    return true
  })
  // The badge says whether anything waits on the person.
  chrome.storage.onChanged.addListener(async () => {
    let { consent = NONE, lend, confirm } = await stored()
    await badge(asked({ consent, lend, confirm }))
  })
  // A service worker sleeps when idle, and this wakes it to reconnect.
  chrome.alarms.create('wake', { periodInMinutes: 1 })
  chrome.alarms.onAlarm.addListener(() => ws || connect())
  connect()
}
