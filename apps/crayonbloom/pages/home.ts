/** The home page: what CrayonBloom makes, a place to type the first idea,
 * and pages that began as one sentence each. */
import { h } from 'preact'
import { Button, Cards, Chip, Field } from '@yaks/ui/parts'
import { Desk } from '../look/parts/Desk.ts'
import { Band } from '../look/parts/Band.ts'
import { Doodles } from '../look/parts/Doodles.ts'
import { Hero } from '../look/parts/Hero.ts'
import { Kicker } from '../look/parts/Kicker.ts'
import { Lead } from '../look/parts/Lead.ts'
import { Sheet } from '../look/parts/Sheet.ts'
import { Spark } from '../look/parts/Spark.ts'
import { Squig } from '../look/parts/Squig.ts'
import { Steps } from '../look/parts/Steps.ts'
import { Ticks } from '../look/parts/Ticks.ts'
import { Wave } from '../look/parts/Wave.ts'
import { answered, type Place } from './frame.ts'
import samples from './samples.json' with { type: 'json' }

let line = (place: Place, file: string) => place.at(`/art/line/${file}.png`)
let colored = (place: Place, file: string) =>
  place.at(`/art/colored/${file}.webp`)
/** The studio, opened on a new book that starts from this idea. */
let begun = (place: Place, prompt: string) =>
  place.at('/studio?prompt=' + encodeURIComponent(prompt))

let Top = ({ place }: { place: Place }) =>
  h(
    Band,
    { mod: 'first' },
    h(
      Band.Inner,
      {},
      h(
        Hero,
        {},
        h(Doodles, {}),
        h(
          Hero.Copy,
          {},
          h(Kicker, { mod: 'dot' }, 'Built by a parent, drawn for kids'),
          h(
            Hero.Title,
            {},
            h(Hero.Line, {}, 'Your kid’s wildest idea,'),
            h(Hero.Line, {}, h(Squig, {}, 'printed'), ' and ready to color.'),
          ),
          h(
            Hero.Lede,
            {},
            'They dream up the character. CrayonBloom draws it as a page to print tonight, and the same idea can grow into their own book.',
          ),
          h(
            Hero.Actions,
            {},
            h(Button, { mod: 'go', href: '#start' }, 'Make a book'),
            h(Button, { mod: 'quiet', href: '#samples' }, 'see sample pages ↓'),
          ),
          h(
            Hero.Start,
            { id: 'start' },
            h(
              Hero.Note,
              {},
              h('strong', {}, 'Start with one idea.'),
              ' Describe it and it is saved to your shelf, ready to become a page to print or a whole story.',
            ),
            h(
              Spark,
              {
                action: place.at('/studio'),
                method: 'get',
                write: h(Field, {
                  lines: true,
                  mod: 'bare',
                  name: 'prompt',
                  required: true,
                  maxlength: 200,
                  placeholder: samples[0].prompt,
                  'aria-label': 'Describe your coloring page idea',
                }),
                foot: h(Button, { mod: 'go' }, 'Start my page'),
              },
              h(
                Spark.Ideas,
                { role: 'group', 'aria-label': 'Borrow an example idea' },
                h(Spark.Lead, {}, 'Need a spark? Borrow one of ours:'),
                samples.filter((s) => s.spark).map((s) =>
                  h(Chip, { href: begun(place, s.prompt) }, s.spark)
                ),
              ),
            ),
          ),
          h(
            Hero.Trust,
            { 'aria-label': 'Why parents trust CrayonBloom' },
            h('li', {}, 'Built by a parent'),
            h('li', {}, 'Print at home tonight'),
            h('li', {}, 'Your pages stay private'),
          ),
        ),
        h(
          Hero.Visual,
          {},
          h(
            Sheet,
            { mod: 'taped' },
            h(
              Sheet.Art,
              {},
              h(Sheet.Line, {
                src: line(place, samples[0].file),
                alt: samples[0].alt,
                width: 1024,
                height: 1536,
              }),
            ),
            h(Sheet.Caption, {}, `“${samples[0].prompt}”`),
          ),
        ),
      ),
    ),
  )

let How = () =>
  h(
    Band,
    {},
    h(
      Band.Inner,
      {},
      h(
        Lead,
        {},
        h(Kicker, {}, 'How it works'),
        h(Lead.Title, {}, 'From one bedtime idea to coloring time.'),
        h(
          Lead.Lede,
          {},
          'Three gentle steps, no design skills. Say the idea out loud, shape the story, and keep the pages you love.',
        ),
      ),
      h(
        Steps,
        {},
        h(
          Steps.Step,
          {},
          h(Steps.Number, {}, '1'),
          h(Steps.Title, {}, 'Tell us the spark.'),
          h(
            'p',
            {},
            'Just a sentence: a favorite character, a family joke, a rainy-day quest. The sillier, the better.',
          ),
        ),
        h(
          Steps.Step,
          {},
          h(Steps.Number, {}, '2'),
          h(Steps.Title, {}, 'Watch it bloom.'),
          h(
            'p',
            {},
            'CrayonBloom shapes it into a story with a page to color for every scene. Edit any of it until it sounds like your kid.',
          ),
        ),
        h(
          Steps.Step,
          {},
          h(Steps.Number, {}, '3'),
          h(Steps.Title, {}, 'Make it a keeper.'),
          h(
            'p',
            {},
            'Print a page at home tonight, or gather the pages into a book to have printed and bound.',
          ),
        ),
      ),
    ),
  )

let Samples = ({ place }: { place: Place }) =>
  h(
    Band,
    { mod: 'mint', id: 'samples' },
    h(
      Band.Inner,
      {},
      h(
        Lead,
        {},
        h(Kicker, {}, 'Sample pages'),
        h(Lead.Title, {}, 'One sentence in, a whole world to color out.'),
        h(
          Lead.Lede,
          {},
          'Every page below began as a single sentence: bold outlines, plenty of room to color, and a friendly character waiting on each one. Each book is drawn fresh; these are samples.',
        ),
      ),
      h(
        Cards,
        {},
        samples.map((s) =>
          h(
            Sheet,
            {},
            h(
              Sheet.Art,
              {
                tabindex: 0,
                role: 'img',
                'aria-label':
                  `${s.title} coloring page, colored in with crayons on focus`,
              },
              h(Sheet.Line, {
                src: line(place, s.file),
                alt: '',
                width: 1024,
                height: 1536,
                loading: 'lazy',
              }),
              h(Sheet.Color, {
                src: colored(place, s.file),
                alt: '',
                loading: 'lazy',
                decoding: 'async',
              }),
              h(Sheet.Hint, { 'aria-hidden': true }, 'Hover to color'),
            ),
            h(
              Sheet.Caption,
              {},
              h(Sheet.Title, {}, s.title),
              `“${s.prompt}”`,
            ),
          )
        ),
      ),
    ),
  )

let Keepsake = ({ place }: { place: Place }) =>
  h(
    Band,
    { mod: 'blush', id: 'keepsake' },
    h(
      Band.Inner,
      {},
      h(
        Band.Split,
        {},
        h(
          'div',
          {},
          h('img', {
            src: place.at('/art/printed-book.webp'),
            alt:
              'An open printed coloring book, two finished pages colored in with crayons: a rabbit lighting paper lanterns at a treetop festival, and an otter playing guitar on a seaside boardwalk.',
            width: 1120,
            height: 825,
            loading: 'lazy',
            decoding: 'async',
          }),
        ),
        h(
          'div',
          {},
          h(
            Lead,
            {},
            h(Kicker, {}, 'The printed keepsake'),
            h(
              Lead.Title,
              {},
              'A real book, starring the character only your kid would dream up.',
            ),
            h(
              Lead.Lede,
              {},
              'The sample page is just the spark. The book is the whole story, written around your kid’s idea, with pages to color and activities to do.',
            ),
          ),
          h(
            Ticks,
            {},
            h(
              Ticks.Item,
              {},
              h('strong', {}, 'A story of their own.'),
              ' Their idea becomes the main character, page after page.',
            ),
            h(
              Ticks.Item,
              {},
              h('strong', {}, 'More than coloring.'),
              ' Mazes and dot-to-dots mixed in, and word searches once they’re reading.',
            ),
            h(
              Ticks.Item,
              {},
              h('strong', {}, 'Yours to review first.'),
              ' You see the complete book, cover to cover, before anything is printed.',
            ),
            h(
              Ticks.Item,
              {},
              h('strong', {}, 'One clear price.'),
              ' PrintBound prints and ships it, and shows the full total before checkout.',
            ),
          ),
          h(
            Desk.Row,
            {},
            h(
              Button,
              { mod: 'go', href: place.at('/pricing') },
              'See how printing works',
            ),
          ),
        ),
      ),
    ),
  )

let Close = ({ place }: { place: Place }) =>
  h(
    Band,
    { mod: 'center' },
    h(
      Band.Inner,
      {},
      h(
        Lead,
        {},
        h(Kicker, {}, 'Ready when you are'),
        h(Lead.Title, {}, 'Turn their idea into a book they’ll keep.'),
        h(
          Lead.Lede,
          {},
          'One idea your kid keeps coming back to. That’s all it takes to start.',
        ),
      ),
      h(
        Desk.Row,
        {},
        h(Button, { mod: 'go', href: '#start' }, 'Make a book'),
        h(
          Button,
          { href: place.at('/coloring-pages') },
          'Browse coloring pages',
        ),
      ),
    ),
  )

/** The home page, answered. */
export let home = (place: Place): Response =>
  answered({
    place,
    title: 'CrayonBloom — Your kid dreams it up. We draw their coloring book.',
    description:
      'Tell us the idea your kid is wild about and CrayonBloom turns it into coloring pages and a story of their own, to print at home or have bound as a book.',
    children: h(
      'main',
      { id: 'main' },
      h(Top, { place }),
      h(Wave, {}),
      h(How, {}),
      h(Samples, { place }),
      h(Keepsake, { place }),
      h(Close, { place }),
    ),
  })
