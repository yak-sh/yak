/// <reference types="chrome" />
// The extension's service worker: it signs the person in, holds the socket to
// their space, and answers each call from the tab they are on. Every decision
// is a pure module's; this file only reaches the browser. The build bundles it
// with a line that calls `start` with the configuration.

import { backoff } from '@yaks/fp'
import { client as oauth, OAuthError } from '@yaks/oauth'
import { answer, type Call, callOf, PING } from './wire.ts'
import { answering, asks, needs, type Seen } from './answer.ts'
import { allowed, ask, NONE, site } from './consent.ts'
import { type Config, socket } from './connect.ts'
import { read } from './read.ts'
import { kept, provider, register } from './signin.ts'
import { badge, keep, local, said, stored } from './chrome.ts'

// Often enough that neither the socket nor the service worker goes idle.
let BEAT = 20_000

let SIGNED_OUT = (config: Config) =>
  `${config.name} no longer accepts this sign-in. Sign in again.`

type Tab = { id: number; windowId: number }

// What each need asks of the tab.
let GIVE: Record<string, (tab: Tab) => Promise<Partial<Seen>>> = {
  page: async (tab) => ({
    page: (await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: read,
    }))[0]?.result,
  }),
  shot: async (tab) => ({
    shot: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }),
  }),
}

/** What the tab the person is on gives for a call, on a site they allowed. */
let look = async (call: Call['call']): Promise<Seen> => {
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  let { consent = NONE } = await stored()
  let on = site(tab?.url ?? '')
  let seen: Seen = {
    url: tab?.url ?? '',
    title: tab?.title,
    allowed: !!on && allowed(on)(consent),
  }
  let need = needs(call.tool)
  if (seen.allowed && need && tab?.id != null) {
    let given = GIVE[need]({ id: tab.id, windowId: tab.windowId })
    Object.assign(seen, await given.catch((e) => ({ failed: said(e) })))
  }
  let asked = asks(call, seen)
  if (asked) {
    await Promise.all([keep({ consent: ask(asked)(consent) }), badge(true)])
  }
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
  // A service worker sleeps when idle, and this wakes it to reconnect.
  chrome.alarms.create('wake', { periodInMinutes: 1 })
  chrome.alarms.onAlarm.addListener(() => ws || connect())
  connect()
}
