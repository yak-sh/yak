// Only a route's public publication may refine a sign-in card's preview.
// Private routes never read the directory.
import type { Directory } from './directory.ts'
import { type Host, url } from '@yaks/platform/host'
import { destination, type Preview } from './link-preview.ts'
import { isBack } from '@yaks/platform/routes'

/** The app a stranger is signing in to get a copy of: its title, its card's
 * picture where a stranger may see it, whether a copy costs nothing, and
 * whether they pressed for it, so signing in is the last step (install.ts). */
export type Copy = {
  title: string
  image?: string
  free: boolean
  pressed?: boolean
}

export let linked = async (
  env: Host,
  back: string | null | undefined,
  dir: Directory,
): Promise<(Preview & { copy?: Copy }) | undefined> => {
  let of = destination(back, env)
  if (!of?.publication) return of
  let offer = await dir.offered(of.publication)
  if (!offer?.app.published || offer.app.trashed || offer.space.trashed) {
    return of
  }
  let { app, space } = offer
  let { shotOf } = await import('./gallery.ts')
  let image = app.access != 'private' || app.gallery?.listedAt
    ? shotOf(space, app, env)
    : undefined
  return {
    title: `${app.title} · yaks.app`,
    description: offer.app.published.about,
    image,
    copy: {
      title: app.title,
      image,
      free: !offer.app.published.price,
      ...isBack(new URL(back!, url(env, '/'))) ? { pressed: true } : {},
    },
  }
}
