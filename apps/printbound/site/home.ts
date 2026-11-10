/** The home page: what PrintBound is, how it works, what it costs and what a
 * printed book looks like, in the words of the site at printbound.net. */
import { type FunctionComponent, h } from 'preact'
import { Button, Card } from '@yaks/ui/parts'
import { Page } from './frame.ts'
import {
  Abreast,
  Band,
  Bookshot,
  Faq,
  Hero,
  Numeral,
  Pages,
  Price,
  Sparks,
  Split,
  Strip,
} from './parts.ts'

let HEAD =
  'PrintBound — The AI storybook you made for your kid, printed for real'
let DESCRIPTION =
  'In ChatGPT you make a custom picture book starring your own kid: story and illustrations, page by page. PrintBound prints it as a real, full-color book and ships it within 7–10 business days. The same goes for any image-based book you make in ChatGPT. US shipping, from $34.99.'

// What an engine reads of the page: no ratings or review counts until there
// are some.
let data = (home: string) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  'name': 'PrintBound',
  'url': home,
  'description':
    "PrintBound is a ChatGPT app that turns the image-based books you make in ChatGPT into real books, printed and shipped within 7–10 business days of payment. The flagship is a personalized children's picture book: your custom story plus AI-generated illustrations, printed as a full-color hardcover or softcover. US shipping included.",
  'applicationCategory': 'Books & Reference',
  'image': home + 'og.png',
  'offers': {
    '@type': 'AggregateOffer',
    'lowPrice': '34.99',
    'priceCurrency': 'USD',
    'description':
      'Picture books from $34.99 softcover / from $49.99 hardcover, all in: printing plus US shipping. Books are priced by page count, so the quote shows the exact total before you pay.',
    'availableDeliveryMethod': 'https://schema.org/ParcelService',
    'eligibleRegion': { '@type': 'Country', 'name': 'US' },
  },
  'publisher': {
    '@type': 'Organization',
    'name': 'PrintBound',
    'url': home,
    'email': 'hello@printbound.net',
  },
})

let STRIP = [
  ['Full-color, print-sharp', 'we upscale your AI art'],
  ['~7–10 business days', 'printed & shipped'],
  ['All-in pricing', 'US shipping included'],
  ['Hardcover or softcover', '9×7 landscape book'],
]

let GIFTS = [
  [
    'New babies & showers',
    "A first storybook with the new arrival's name on the cover, printed and ready before the shower.",
  ],
  [
    'Birthdays',
    "Make them the hero of their own adventure. It's the birthday book they hand straight back and ask you to read again.",
  ],
  [
    'Grandparents',
    'The grandkids, by name, in a hardcover Grandma and Grandpa can read aloud on the couch.',
  ],
  [
    'Holidays & anniversaries',
    "A keepsake under the tree, or the family's year retold for an anniversary. It outlasts the wrapping paper by a couple of decades.",
  ],
]

let MAKES = [
  [
    'Personalized storybooks',
    'A bedtime adventure starring your own kid by name: the silly, the sweet, the one they ask for every night. This is what we do best.',
  ],
  [
    'Alphabet & counting books',
    'A first-words or 1-2-3 book illustrated around the people, pets and places your little one already loves.',
  ],
  [
    'Comics & illustrated adventures',
    "A short comic, a hero's quest, a wordless picture journey. Panel art and captions, printed full-color and full-bleed.",
  ],
  [
    'Photo & art keepsakes',
    'An illustrated family memory, a coloring book, an art collection. Any image-based book you build with AI, bound for the shelf.',
  ],
]

let PAGES = [
  [
    'page-dance',
    'Sample page: Maya dances joyfully in the moonlit garden among glowing blue flowers, the words ‘Dance, Maya, dance!’ hand-lettered in big glowing letters across the night sky.',
  ],
  [
    'page-goodnight',
    'Sample page: Maya kneels with hands clasped beside a glowing blue flower under a moonbeam, with the line ‘“Goodnight, garden,” whispered Maya.’ painted into the soft night sky.',
  ],
  [
    'page-theend',
    'Closing sample page: Maya waves goodbye in the moonlit garden as the words ‘The End’ form in glowing firefly lights across the starry sky.',
  ],
]

let FAQ = [
  [
    'Will my AI illustrations look good printed?',
    "Yes — that's the part we sweat. AI images come out fairly small on screen, so before we print we automatically sharpen and upscale every page to true print quality. The result looks crisp and rich on real paper, not blurry or pixelated.",
  ],
  [
    'What does the picture book look like?',
    "A 9×7 inch landscape book, full color on premium coated paper, around 32 pages, the sweet spot for a kids' story. Choose hardcover for a gift-quality keepsake, or softcover for a lighter, lower-cost copy.",
  ],
  [
    'Where do you ship, and how long does it take?',
    'The contiguous United States (the lower 48) at launch, with shipping included in the price. Most orders are printed and shipped within 7–10 business days of payment; we email a tracking link the moment your book ships, and delivery from there depends on the carrier. You can ask for status and tracking in the chat any time.',
  ],
  [
    'Who actually prints it?',
    "A professional print-on-demand press, the same kind of binding and paper behind books you'd buy in a store. No home printer, no flimsy stapling.",
  ],
]

// Cards in a list, each a title over a line.
let cards = (rows: string[][], mod: string) =>
  h(
    Abreast,
    { as: 'ul', mod: [mod, 'sparked'] },
    rows.map(([title, text]) =>
      h(
        Card,
        { as: 'li', key: title },
        h(Card.Title, { as: 'h3' }, title),
        h('p', {}, text),
      )
    ),
  )

/** The home page. */
export let Home: FunctionComponent<{ base: string }> = ({ base }) => {
  let to = (path = '') => base + path
  let start = h(
    Button,
    { mod: 'go', href: to('studio#new') },
    'Start your book',
  )
  let guide = h(
    Button,
    { href: to('make-a-picture-book-in-chatgpt') },
    'Read the free guide',
  )
  return h(
    Page,
    { base, head: HEAD, description: DESCRIPTION, path: '', data: data(base) },
    h(
      'main',
      { id: 'main' },
      h(
        Hero,
        {},
        h(
          Hero.Inner,
          {},
          h(
            Hero.Copy,
            {},
            h(Band.Eyebrow, {}, 'AI image-books, printed'),
            h(
              Hero.Title,
              {},
              'The storybook you made for your kid, ',
              h(Hero.Spark, {}, 'made real.'),
            ),
            h(
              Hero.Sub,
              {},
              'In ChatGPT, you make a custom picture book starring your own child: the story and the illustrations, page by page. PrintBound turns it into a real, full-color book, printed and shipped within 7–10 business days. We even sharpen every AI illustration so it looks crisp on the printed page.',
            ),
            h(Hero.Actions, {}, start, guide),
            h(
              Hero.Aside,
              {},
              "Ordering isn't open yet. Make your book and review every page today; quotes and orders are previews.",
            ),
            h(
              Hero.Note,
              {},
              'US shipping included · Picture books from ',
              h('strong', {}, '$34.99'),
              ' softcover, from ',
              h('strong', {}, '$49.99'),
              ' hardcover, all in.',
            ),
          ),
          h(
            Bookshot,
            {},
            h(
              Bookshot.Book,
              {},
              h(Bookshot.Cover, {
                src: to('img/cover.webp'),
                width: 1120,
                height: 860,
                fetchpriority: 'high',
                decoding: 'async',
                alt:
                  'Cover of the sample picture book Maya & the Moon Garden: the hand-lettered title glows in the night sky above a curly-haired girl in a yellow raincoat and red boots standing at a glowing iron gate into a moonlit garden of blue flowers.',
              }),
              h(Bookshot.Spine, { 'aria-hidden': true }),
            ),
            h(
              Bookshot.Caption,
              {},
              'A real PrintBound sample, full-color 9×7 landscape hardcover.',
            ),
          ),
        ),
      ),
      h(
        Strip,
        { 'aria-label': 'At a glance' },
        h(
          Strip.Inner,
          {},
          STRIP.map(([name, note]) =>
            h(
              Strip.Item,
              { key: name },
              h(Strip.Name, {}, name),
              h(Strip.Note, {}, note),
            )
          ),
        ),
      ),
      h(
        Band,
        { id: 'how', 'aria-labelledby': 'how-title' },
        h(
          Band.Inner,
          {},
          h(Band.Eyebrow, {}, 'How it works'),
          h(
            Band.Title,
            { id: 'how-title' },
            'From a bedtime idea to a book in their hands.',
          ),
          h(
            Abreast,
            { as: 'ol', mod: 'three' },
            h(
              Card,
              { as: 'li' },
              h(Numeral, {}, '1'),
              h(Card.Title, { as: 'h3' }, 'Make the book in chat'),
              h(
                'p',
                {},
                'Have ChatGPT create a custom storybook starring your kid: the story and the illustrations, page by page. Make it as silly or as sweet as you like.',
              ),
            ),
            h(
              Card,
              { as: 'li' },
              h(Numeral, {}, '2'),
              h(Card.Title, { as: 'h3' }, 'Ask PrintBound to print it'),
              h(
                'p',
                {},
                'Say ',
                h('em', {}, '"print this as a picture book."'),
                ' We pull every page and illustration, sharpen the art to print quality, and lay it out as a real picture book.',
              ),
            ),
            h(
              Card,
              { as: 'li' },
              h(Numeral, {}, '3'),
              h(Card.Title, { as: 'h3' }, 'A real book arrives'),
              h(
                'p',
                {},
                "Full-color 9×7 landscape, hardcover or softcover, mailed to your door, printed and shipped within 7–10 business days, with a tracking link the moment it's on its way. You see the all-in price and pay securely before we print.",
              ),
            ),
          ),
          h(
            Band.Lede,
            { mod: 'after' },
            "Haven't made the book yet? Our free guide walks you through it: ",
            h(
              'a',
              { href: to('make-a-picture-book-in-chatgpt') },
              'how to make a picture book in ChatGPT',
            ),
            ", starter prompt included. Already have one? Here's ",
            h(
              'a',
              { href: to('print-your-chatgpt-book') },
              'what it takes to print it',
            ),
            ', every route compared.',
          ),
        ),
      ),
      h(
        Band,
        { mod: 'night', id: 'gifts', 'aria-labelledby': 'gifts-title' },
        h(
          Band.Inner,
          {},
          h(Band.Eyebrow, {}, 'Made to be given'),
          h(
            Band.Title,
            { id: 'gifts-title' },
            'A gift with their name on every page.',
          ),
          h(
            Band.Lede,
            {},
            "A book starring the kid you love beats one more toy forgotten by New Year's. Their name is on every page, and it's built to last years on the shelf. Make it in chat; we print and ship it, all in.",
          ),
          cards(GIFTS, 'four'),
          h(Band.Actions, {}, start),
          h(
            Band.Note,
            { mod: 'faint' },
            "Ship it straight to their US address, no routing it through you first, and add a short note we print as a dedication page inside the front cover. Gift wrap and arrive-by dates aren't built yet; the book and the printed note are.",
          ),
        ),
      ),
      h(
        Band,
        { mod: 'paper', id: 'make', 'aria-labelledby': 'make-title' },
        h(
          Band.Inner,
          {},
          h(Band.Eyebrow, {}, 'Beyond bedtime stories'),
          h(
            Band.Title,
            { id: 'make-title' },
            'If you can make it with AI, we can print it.',
          ),
          h(
            Band.Lede,
            {},
            "Personalized kids' storybooks are our flagship, but anything you build with words and pictures in chat comes out as a real, full-color book the same way.",
          ),
          cards(MAKES, 'two'),
          h(
            Band.Lede,
            { mod: 'after' },
            'Mostly text? We can also print any chat as a plain ',
            h('strong', {}, '6×9 black-and-white softcover'),
            '. Just ask.',
          ),
        ),
      ),
      h(
        Band,
        { id: 'pricing', 'aria-labelledby': 'pricing-title' },
        h(
          Band.Inner,
          {},
          h(
            Split,
            {},
            h(
              'div',
              {},
              h(Band.Eyebrow, {}, 'Pricing'),
              h(
                Band.Title,
                { id: 'pricing-title' },
                'One honest price, shipping included.',
              ),
              h(
                Band.Lede,
                {},
                'No subscriptions, no setup fees, no minimums. You see the exact all-in price before you pay, every time, including shipping to your US address.',
              ),
              h(
                Sparks,
                {},
                h(
                  Sparks.Item,
                  {},
                  h('strong', {}, 'Hardcover picture book — from $49.99'),
                  ' · 9×7 landscape, premium full color, the gift-quality keepsake',
                ),
                h(
                  Sparks.Item,
                  {},
                  h('strong', {}, 'Softcover picture book — from $34.99'),
                  ' · same landscape format and full-color pages, soft cover',
                ),
                h(
                  Sparks.Item,
                  {},
                  'Those prices cover a book of 32 to 48 pages, where nearly every picture book lands. Past 48, each extra page adds a little, and the quote shows the exact total before you pay',
                ),
                h(
                  Sparks.Item,
                  { mod: 'aside' },
                  'Just need a plain text book? A 6×9 black-and-white softcover starts at $29.99.',
                ),
              ),
            ),
            h(
              Price,
              { as: 'aside', 'aria-label': 'Lead price' },
              h(Price.Eyebrow, {}, 'Hardcover picture book'),
              h(
                Price.Amount,
                {},
                h(Price.From, {}, 'from'),
                ' $49',
                h(Price.Cents, {}, '.99'),
              ),
              h(Price.Unit, {}, 'all in: printing + US shipping'),
              start,
              h(
                Price.Fine,
                {},
                "Softcover from $34.99 · ordering isn't open yet.",
              ),
            ),
          ),
        ),
      ),
      h(
        Band,
        { mod: 'paper', id: 'proof', 'aria-labelledby': 'proof-title' },
        h(
          Band.Inner,
          {},
          h(
            Pages,
            {},
            h(Band.Eyebrow, {}, 'See the real thing'),
            h(
              Band.Title,
              { id: 'proof-title' },
              'A peek inside our sample picture book.',
            ),
            h(
              Band.Lede,
              {},
              'To put PrintBound through its paces, we made and printed a full sample, ',
              h('em', {}, 'Maya & the Moon Garden'),
              '. These are pages straight from it, with the words painted right into the artwork the way a real illustrated storybook reads, full-color and full-bleed.',
            ),
            h(
              Pages.Spread,
              {},
              h('img', {
                src: to('img/spread.webp'),
                width: 1680,
                height: 653,
                loading: 'lazy',
                decoding: 'async',
                alt:
                  'An open two-page spread from Maya & the Moon Garden. Left page: Maya in a yellow raincoat waters glowing blue moonflowers beside a firefly, with the story line painted into the sky, ‘Maya & the firefly watered the moonflowers.’ Right page: she follows the firefly along a moonlit path toward a silver gate, the words woven into the night sky, ‘That night, Maya followed the firefly past the silver gate, where every moonflower opened just for her.’',
              }),
              h(
                Pages.Caption,
                {},
                'An open spread: the same 9×7 landscape full-color layout every PrintBound picture book uses, with the words painted into the art.',
              ),
            ),
            h(
              Pages.Grid,
              {
                'aria-label':
                  'More pages from the sample picture book Maya & the Moon Garden',
              },
              PAGES.map(([name, alt]) =>
                h(
                  Pages.Page,
                  { key: name },
                  h('img', {
                    src: to(`img/${name}.webp`),
                    width: 1120,
                    height: 860,
                    loading: 'lazy',
                    decoding: 'async',
                    alt,
                  }),
                )
              ),
            ),
            h(
              Band.Note,
              {},
              "These are pages from our own sample, not a customer's book: no stock imagery, no invented reviews. Printed one with us? ",
              h(
                'a',
                {
                  href:
                    'mailto:hello@printbound.net?subject=My%20PrintBound%20book',
                },
                'Send a photo',
              ),
              "; we'd love to show real readers' books here too, with your okay.",
            ),
          ),
        ),
      ),
      h(
        Band,
        { mod: 'night', id: 'start', 'aria-labelledby': 'start-title' },
        h(
          Band.Inner,
          {},
          h(Band.Eyebrow, {}, 'No waiting to start'),
          h(Band.Title, { id: 'start-title' }, 'Start the book tonight.'),
          h(
            Band.Lede,
            {},
            'The ',
            h(
              'a',
              { href: to('make-a-picture-book-in-chatgpt') },
              'free guide',
            ),
            ' walks you through making the book in ChatGPT today, copy-paste starter prompt included.',
          ),
          h(Band.Actions, {}, start, guide),
        ),
      ),
      h(
        Band,
        { 'aria-labelledby': 'faq-title' },
        h(
          Band.Inner,
          {},
          h(Band.Eyebrow, {}, 'Good to know'),
          h(Band.Title, { id: 'faq-title' }, 'The details, up front.'),
          h(
            Faq,
            {},
            FAQ.map(([question, answer]) =>
              h(
                Faq.Item,
                { key: question },
                h(Faq.Question, {}, question),
                h(Faq.Answer, {}, answer),
              )
            ),
            h(
              Faq.Item,
              {},
              h(Faq.Question, {}, 'Is my content private?'),
              h(
                Faq.Answer,
                {},
                'Your story and illustrations are used only to lay out and print your book, nothing more. We never sell your data, and we delete your content and the print-ready PDF within 30 days of fulfilment — or within 30 days of a refund, if we never print it. See our ',
                h('a', { href: to('privacy') }, 'Privacy Policy'),
                ' for the full details.',
              ),
            ),
          ),
        ),
      ),
    ),
  )
}
