/** The community gallery: pages shared with their parent's consent and
 * reviewed, as sheets. */
import { h } from 'preact'
import { Cards, Empty } from '@yaks/ui/parts'
import { Band } from '../look/parts/Band.ts'
import { Kicker } from '../look/parts/Kicker.ts'
import { Lead } from '../look/parts/Lead.ts'
import { Sheet } from '../look/parts/Sheet.ts'
import { answered, type Place } from './frame.ts'

/** The gallery of `shared` pages, answered. */
export let galleryPage = (
  place: Place,
  shared: { id: string; caption?: string }[],
): Response =>
  answered({
    place,
    title: 'Community gallery — CrayonBloom',
    children: h(
      'main',
      { id: 'main' },
      h(
        Band,
        { mod: 'first' },
        h(
          Band.Inner,
          {},
          h(
            Lead,
            { mod: 'page' },
            h(Kicker, {}, 'Shared by parents'),
            h(Lead.Title, { as: 'h1' }, 'Community coloring gallery'),
            h(
              Lead.Lede,
              {},
              'Art shared with its parent’s consent and reviewed for this gallery.',
            ),
          ),
          shared.length
            ? h(
              Cards,
              {},
              shared.map((page) =>
                h(
                  Sheet,
                  {},
                  h(
                    Sheet.Art,
                    {},
                    h(Sheet.Line, {
                      src: place.at(
                        '/studio/gallery_file?id=' +
                          encodeURIComponent(page.id),
                      ),
                      alt: page.caption || 'A shared coloring page',
                      loading: 'lazy',
                    }),
                  ),
                  page.caption && h(Sheet.Caption, {}, page.caption),
                )
              ),
            )
            : h(
              Empty,
              {},
              h(Empty.Title, {}, 'Nothing shared yet'),
              h('p', {}, 'No shared pages have been published yet.'),
            ),
        ),
      ),
    ),
  })
