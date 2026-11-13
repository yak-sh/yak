// Only a route's public publication may refine a sign-in card's preview.
// Private routes never read the directory.
import type { Directory } from './directory.ts'
import { type Host } from '@yaks/platform/host'
import { destination, type Preview } from './link-preview.ts'

export let linked = async (
  env: Host,
  back: string | null | undefined,
  dir: Directory,
): Promise<Preview | undefined> => {
  let of = destination(back, env)
  if (!of?.publication) return of
  let offer = await dir.offered(of.publication)
  if (!offer?.app.published || offer.app.trashed || offer.space.trashed) {
    return of
  }
  let { app, space } = offer
  let { shotOf } = await import('./gallery.ts')
  return {
    title: `${app.title} · yaks.app`,
    description: offer.app.published.about,
    image: app.access != 'private' || app.gallery?.listedAt
      ? shotOf(space, app, env)
      : undefined,
  }
}
