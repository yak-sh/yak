/**
 * What a space's Operator suggests on its Dashboard (T-3702): the platform's
 * features the space does not use yet, each said about one of its own apps.
 *
 * The features are rows (`FEATURES`): what each is called, the use that
 * makes it moot (`uses`, a fact of the space's: `Uses`), which of the
 * space's apps it fits (`fits`), what it says, and either the page that
 * does it (`opens`) or the request it hands the Operator, already written
 * (`ask`). Nothing here is written per space: `suggested` picks from the
 * rows by the space's facts and the person's dismissals.
 *
 * @module
 */

/** What a space already uses, as its rows say. */
export type Uses = {
  /** a hostname of its own on one of its apps */
  domain: boolean
  /** a member beside its owner */
  people: boolean
  /** a seller account, taking payments */
  selling: boolean
  /** an app with a phone number of its own */
  texts: boolean
  /** mail on a domain of its own */
  mail: boolean
  /** an app anyone may open */
  public: boolean
}

/** An app as a suggestion is said about it. */
export type Fitted = {
  slug: string
  title: string
  access?: string | null
  home?: boolean
}

/** A feature as a row: `name` keys its dismissal; `uses`, the fact that
 * makes it moot; `fits`, which apps it can be said about (any, where
 * absent); `says`, its line, where `{app}` is the app's title and `{slug}`
 * its slug and `{space}` the space's; and either `opens`, the settings page
 * that does it, or `ask`, the request it hands the Operator. */
export type Feature = {
  name: string
  uses?: keyof Uses
  fits?: (app: Fitted) => boolean
  says: string
  opens?: 'domains' | 'people' | 'selling'
  ask?: string
}

/** The features a Dashboard suggests from, in the order it offers them. */
export let FEATURES: Feature[] = [
  {
    name: 'domain',
    uses: 'domain',
    says: 'Put {app} on a domain of its own, like {slug}.{space}.com',
    opens: 'domains',
  },
  {
    name: 'share',
    uses: 'public',
    fits: (app) => app.access != 'public',
    says: 'Share {app} with anyone who has the link',
    ask:
      'Make {app} public, so anyone with its link can open it, and tell me what they will see.',
  },
  {
    name: 'people',
    uses: 'people',
    says: 'Invite family or friends to sign in to {app}',
    opens: 'people',
  },
  {
    name: 'selling',
    uses: 'selling',
    says: 'Take payments or donations in {app}',
    ask: 'Help me take payments or donations in {app}. What would it take?',
  },
  {
    name: 'texts',
    uses: 'texts',
    says: 'Give {app} a phone number to send and receive texts',
    ask:
      'Could {app} have a phone number of its own, to send and receive texts? Tell me what it would do.',
  },
  {
    name: 'mail',
    uses: 'mail',
    says: 'Let {app} receive email',
    ask:
      'Let {app} receive email: give it an address, and tell me what it will do with what arrives.',
  },
  {
    name: 'operator-email',
    says: 'Email your Operator about {app} from your own inbox',
    ask: 'How do I email you about {app}?',
  },
  {
    name: 'install',
    says: 'Add {app} to your phone’s home screen',
    ask: 'How do I add {app} to my phone’s home screen?',
  },
]

/** A suggestion as the Dashboard shows it. */
export type Suggestion = {
  name: string
  says: string
  app: string
  opens?: Feature['opens']
  ask?: string
}

let filled = (text: string, app: Fitted, space: string) =>
  text.replaceAll('{app}', app.title || app.slug)
    .replaceAll('{slug}', app.slug)
    .replaceAll('{space}', space)

/** The app a feature is said about: the space's front page where it fits,
 * else the first that fits. */
let about = (feature: Feature, apps: Fitted[]) => {
  let fit = apps.filter(feature.fits ?? (() => true))
  return fit.find((a) => a.home) ?? fit[0]
}

/**
 * Up to `count` suggestions for `space`, from `features`: each one its
 * facts don't make moot, the person hasn't dismissed (`dismissed`, by
 * name), and that fits one of its `apps`.
 *
 * ```ts
 * import { suggested } from '@yaks/platform/suggestions'
 * import { assertEquals } from '@std/assert'
 * let uses = { domain: true, people: false, selling: false, texts: false, mail: false, public: false }
 * let apps = [{ slug: 'recipes', title: 'Recipe Box', access: 'private' }]
 * assertEquals(
 *   suggested({ space: 'ada', uses, apps, dismissed: ['share'] }, 1),
 *   [{ name: 'people', says: 'Invite family or friends to sign in to Recipe Box', app: 'recipes', opens: 'people' }],
 * )
 * ```
 */
export let suggested = (
  at: { space: string; uses: Uses; apps: Fitted[]; dismissed: string[] },
  count = 3,
  features: Feature[] = FEATURES,
): Suggestion[] =>
  features
    .filter((f) => !(f.uses && at.uses[f.uses]))
    .filter((f) => !at.dismissed.includes(f.name))
    .flatMap((f) => {
      let app = about(f, at.apps)
      return app
        ? [{
          name: f.name,
          says: filled(f.says, app, at.space),
          app: app.slug,
          ...f.opens ? { opens: f.opens } : {},
          ...f.ask ? { ask: filled(f.ask, app, at.space) } : {},
        }]
        : []
    })
    .slice(0, count)
