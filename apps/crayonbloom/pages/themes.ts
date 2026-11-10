/** The coloring pages to print, by theme: a shelf of themes, and each
 * theme's pages as sheets with their printable beside them. What a theme
 * says and holds is themes.json; the art and PDFs are the curated files
 * public.ts serves. */
import { h } from 'preact'
import { Body, Button, Card, Cards } from '@yaks/ui/parts'
import { Band } from '../look/parts/Band.ts'
import { Desk } from '../look/parts/Desk.ts'
import { Kicker } from '../look/parts/Kicker.ts'
import { Lead } from '../look/parts/Lead.ts'
import { Sheet } from '../look/parts/Sheet.ts'
import { answered, type Place } from './frame.ts'
import themes from './themes.json' with { type: 'json' }

type Theme = typeof themes[number]

let html = (text: string) => ({ dangerouslySetInnerHTML: { __html: text } })
/** The studio, opened on a new book that starts from this idea. */
let begun = (place: Place, prompt: string) =>
  place.at('/studio?prompt=' + encodeURIComponent(prompt))

/** Every theme, each a card to press, its first page as its picture. */
let shelf = (place: Place): Response =>
  answered({
    place,
    title: 'Coloring pages to print — CrayonBloom',
    description:
      'Coloring pages by theme, each one drawn from a single sentence. Print a page, or describe the one your kid is dreaming up.',
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
            h(Kicker, {}, 'Coloring pages'),
            h(Lead.Title, { as: 'h1' }, 'Coloring pages to print'),
            h(
              Lead.Lede,
              {},
              'Pick a theme your kid is into this week. Every page prints clean on plain paper.',
            ),
          ),
          h(
            Cards,
            {},
            themes.map((theme) =>
              h(
                Sheet,
                {},
                h(
                  Sheet.Art,
                  {},
                  h(Sheet.Line, {
                    src: place.at(theme.pages[0].image),
                    alt: '',
                    loading: 'lazy',
                  }),
                ),
                h(
                  Sheet.Caption,
                  {},
                  h(
                    Sheet.Title,
                    {},
                    h(
                      'a',
                      { href: place.at('/coloring-pages/' + theme.slug) },
                      theme.name,
                    ),
                  ),
                  theme.blurb,
                ),
              )
            ),
          ),
        ),
      ),
    ),
  })

/** One theme: what it is, its pages, and anything more it says. */
let themed = (place: Place, theme: Theme): Response =>
  answered({
    place,
    title: theme.title,
    description: theme.description,
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
            h(Kicker, { href: place.at('/coloring-pages') }, 'Coloring pages'),
            h(Lead.Title, { as: 'h1' }, theme.heading),
            theme.intro.map((text) => h(Lead.Lede, html(text))),
          ),
          h(
            Desk.Row,
            {},
            h(
              Button,
              { mod: 'go', href: begun(place, theme.prompt) },
              'Make a page from your idea',
            ),
          ),
        ),
      ),
      h(
        Band,
        { mod: 'mint' },
        h(
          Band.Inner,
          {},
          h(
            Cards,
            {},
            theme.pages.map((sheet) =>
              h(
                Sheet,
                {},
                h(
                  Sheet.Art,
                  {},
                  h(Sheet.Line, {
                    src: place.at(sheet.image),
                    alt: `${sheet.title} coloring page`,
                    loading: 'lazy',
                  }),
                ),
                h(
                  Sheet.Caption,
                  {},
                  h(Sheet.Title, {}, sheet.title),
                  sheet.caption,
                ),
                h(
                  Desk.Row,
                  {},
                  h(Button, { href: place.at(sheet.pdf) }, 'Download PDF'),
                  h(
                    Button,
                    { mod: 'quiet', href: place.at(sheet.image) },
                    'View artwork',
                  ),
                ),
              )
            ),
          ),
        ),
      ),
      theme.more &&
        h(
          Band,
          { mod: 'narrow' },
          h(
            Band.Inner,
            {},
            h(Card, {}, h(Body, html(theme.more))),
          ),
        ),
    ),
  })

/** The page an app path under /coloring-pages names, if it names one. */
export let coloring = (place: Place): Response | null => {
  if (place.path == '/coloring-pages') return shelf(place)
  let theme = themes.find((t) => place.path == '/coloring-pages/' + t.slug)
  return theme ? themed(place, theme) : null
}

/** Every address these pages answer, for the site's map. */
export let paths = [
  '/coloring-pages',
  ...themes.map((t) => '/coloring-pages/' + t.slug),
]
