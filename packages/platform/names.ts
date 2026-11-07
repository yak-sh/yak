// The names a platform and its clients both speak: its own host, the shape of
// a space's or an app's slug, the store its directory lives in, and the paths
// a client posts to that are not an app's.

/** The platform's own host. A deployment may stand at another (workers/yak
 * host.ts `apex`); the product is always called this. */
export let PLATFORM = 'yaks.app'

/** A space's or an app's slug. */
export let SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

/** The store the directory lives in, named the way every app's store is. Its
 * slugs are the platform's own and never move, so the name is a constant.
 *
 * A store's name is addressing rather than vocabulary: consumers can name
 * the directory without importing its words or its store composition. */
export let PLATFORM_STORE = 'yak/platform'

/** Where a sign-in link is spent. Under `/login/`, so the platform routes it
 * with the rest of the sign-in surface. */
export let LINK = '/login/link'

/** Where an invitation is accepted, on the platform's own host. */
export let INVITE = '/invite'
