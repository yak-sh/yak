/// <reference types="chrome" />
// The popup: it draws ./screen.ts from what storage holds, and runs what its
// buttons name. A site's permission is asked for here, because the browser
// grants one only during a click; signing in is the background's, because a
// sign-in window closes the popup. The build bundles it with a line that
// calls `popup` with the configuration.

import {
  allow,
  type Consent,
  dismiss,
  NONE,
  pattern,
  revoke,
} from './consent.ts'
import { type Config, spaceOf } from './connect.ts'
import { screen } from './screen.ts'
import { badge, keep, said, stored } from './chrome.ts'

let send = (does: string) => chrome.runtime.sendMessage({ do: does })

let consent = async (change: (c: Consent) => Consent) =>
  keep({ consent: change((await stored()).consent ?? NONE) })

export let popup = (config: Config): void => {
  let main = document.querySelector('main')!
  let draw = async () => {
    let s = await stored()
    main.innerHTML = screen(config, {
      signed: !!s.grant?.access_token,
      space: s.space,
      link: s.link,
      consent: s.consent ?? NONE,
      error: s.error,
    })
  }

  // What each button does, given the site it names. A permission request must
  // be the first thing a click does, before anything is awaited.
  let DOES: Record<string, (site: string) => Promise<unknown>> = {
    signin: () => send('signin'),
    signout: () => send('signout'),
    change: () => keep({ space: undefined }).then(() => send('connect')),
    allow: async (site) => {
      if (!await chrome.permissions.request({ origins: [pattern(site)] })) {
        return
      }
      await consent(allow(site))
      await badge(false)
    },
    dismiss: () => consent(dismiss).then(() => badge(false)),
    revoke: (site) =>
      chrome.permissions.remove({ origins: [pattern(site)] }).catch(() => {})
        .then(() => consent(revoke(site))),
  }

  main.addEventListener('click', (e) => {
    let b = e.target instanceof Element && e.target.closest('button[data-do]')
    if (!(b instanceof HTMLButtonElement)) return
    let does = DOES[b.dataset.do ?? '']
    does?.(b.dataset.site ?? '').catch((e) => keep({ error: said(e) }))
  })
  main.addEventListener('submit', (e) => {
    e.preventDefault()
    let form = e.target instanceof HTMLFormElement ? e.target : undefined
    let space = spaceOf(config, String(new FormData(form).get('space') ?? ''))
    keep(
      space ? { space, error: undefined } : {
        error: `That isn't a space's name. It is the part before .${
          new URL(config.origin).host
        } in your space's address.`,
      },
    ).then(() => space && send('connect'))
  })
  chrome.storage.onChanged.addListener(draw)
  draw()
}
