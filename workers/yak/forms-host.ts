// What an app's store gives @yaks/forms: its clock, the app it writes a
// sign-up and its letters as, where the app's pages are, the address an app's
// own people keep (@yaks/people), and which of them a signed-in person is
// (recognized.ts).
import { type Bundle, signed } from '@yaks/graph'
import type { Options } from '@yaks/forms/graph'
import { emailOf } from '@yaks/people'
import type { Stored } from './graph.ts'
import { recognized } from './recognized.ts'

/** Where an app's pages are served, from the address its letters leave under:
 * `<space>.<app>@<apex>`, or `<space>@<apex>` for the app that is the
 * space's home. */
/// siteOf('ward.app@yaks.app') -> 'https://ward.yaks.app/app/'
/// siteOf('ward@yaks.app') -> 'https://ward.yaks.app/'
/// siteOf(null) -> undefined
export let siteOf = (mail: string | null): string | undefined => {
  let [, name, apex] =
    /^([a-z0-9-]+(?:\.[a-z0-9-]+)?)@(.+)$/.exec(mail ?? '') ?? []
  let [space, app] = (name ?? '').split('.')
  return space ? `https://${space}.${apex}/${app ? `${app}/` : ''}` : undefined
}

/** The forms plugin's options in the store `at`: a store that holds no app
 * writes nothing. */
export let formsOptions = (
  at: Pick<Stored, 'app' | 'env' | 'graph' | 'mail' | 'now'>,
): Options => ({
  now: at.now,
  post: (rows: Bundle[]) =>
    at.app ? at.graph.apply(signed(rows, { by: at.app })) : [],
  site: () => siteOf(at.mail()),
  addressOf: emailOf,
  known: (person) => recognized(at, person),
})
