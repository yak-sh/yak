/// <reference types="chrome" />
// What the background and the popup keep in `chrome.storage.local`, and how
// they reach it. Both are thin glue over the pure modules beside this one;
// storage is the one place they share, and its change events are how the
// popup hears the background.

import type { Tokens } from '@yaks/oauth'
import type { Consent } from './consent.ts'
import type { Link } from './screen.ts'
import type { Area } from './signin.ts'

/** Everything the extension keeps, by key. */
export type Stored = {
  /** The client the extension registered, for the redirect it registered. */
  client?: { redirect: string; id: string }
  grant?: Tokens
  space?: string
  consent?: Consent
  link?: Link
  error?: string
}

/** What is kept now. */
export let stored = (): Promise<Stored> => chrome.storage.local.get<Stored>()

/** Keep a patch; a key given as undefined is forgotten. */
export let keep = async (patch: Stored): Promise<void> => {
  let all = Object.entries(patch)
  await chrome.storage.local.remove(
    all.filter(([, v]) => v == null).map(([k]) => k),
  )
  await chrome.storage.local.set(
    Object.fromEntries(all.filter(([, v]) => v != null)),
  )
}

/** Storage as an area for the grant store (./signin.ts `kept`). */
export let local: Area = {
  get: async (key) => (await chrome.storage.local.get(key))[key],
  set: (key, value) => chrome.storage.local.set({ [key]: value }),
}

/** A thrown thing, said to the person. */
export let said = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

/** The badge that says the agent is waiting on the person. */
export let badge = (on: boolean): Promise<void> =>
  chrome.action.setBadgeText({ text: on ? '!' : '' })
