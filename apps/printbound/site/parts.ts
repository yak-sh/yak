/** PrintBound's own parts: what its pages are drawn from beside the kit's
 * (@yaks/ui). Each is paint alone, its look in look/site.css under the
 * Spellbound theme (look/spellbound.css).
 *
 * The hero, a `night` band, the price, a prompt and the foot are the dusk
 * sky: they turn the theme's roles, so the kit's parts inside them (a card,
 * a button, a field) read on night unchanged. */
import { block, Card, Cards, el, Field, type Part } from '@yaks/ui/parts'

/** The name: a spark, and Print beside Bound. */
export let Wordmark: Part & Record<'Mark' | 'Text' | 'Bound', Part> = block(
  'a',
  'Wordmark',
  { Mark: 'span', Text: 'span', Bound: 'span' },
)

/** The bar across the top of every page. */
export let Mast: Part & Record<'Inner' | 'Nav' | 'Link', Part> = block(
  'header',
  'Mast',
  { Inner: 'div', Nav: 'nav', Link: 'a' },
)

/** One band of a page, its eyebrow over its title over its lede. `paper` is
 * the deeper parchment, `night` the dusk sky, `narrow` a reading column. */
export let Band:
  & Part
  & Record<'Inner' | 'Eyebrow' | 'Title' | 'Lede' | 'Actions' | 'Note', Part> =
    block('section', 'Band', {
      Inner: 'div',
      Eyebrow: 'p',
      Title: 'h2',
      Lede: 'p',
      Actions: 'div',
      Note: 'p',
    })

/** The home page's opening: what PrintBound is, beside the book. */
export let Hero:
  & Part
  & Record<
    'Inner' | 'Copy' | 'Title' | 'Spark' | 'Sub' | 'Actions' | 'Aside' | 'Note',
    Part
  > = block('section', 'Hero', {
    Inner: 'div',
    Copy: 'div',
    Title: 'h1',
    Spark: 'span',
    Sub: 'p',
    Actions: 'div',
    Aside: 'p',
    Note: 'p',
  })

/** A bound book standing in moonlight: its cover, its spine, its caption. */
export let Bookshot:
  & Part
  & Record<'Book' | 'Cover' | 'Spine' | 'Caption', Part> = block(
    'figure',
    'Bookshot',
    {
      Book: 'div',
      Cover: 'img',
      Spine: 'span',
      Caption: 'figcaption',
    },
  )

/** Facts at a glance, side by side under the hero. */
export let Strip: Part & Record<'Inner' | 'Item' | 'Name' | 'Note', Part> =
  block('section', 'Strip', {
    Inner: 'div',
    Item: 'div',
    Name: 'strong',
    Note: 'span',
  })

/** Cards a set number abreast (`two`, `three`, `four`), fewer as the page
 * narrows; `sparked` sets a spark before each card's title. */
export let Abreast: Part = el(Cards, 'Abreast')

/** A step's number, in a gold round. */
export let Numeral: Part = el('span', 'Numeral')

/** A list whose marks are sparks. */
export let Sparks: Part & Record<'Item', Part> = block('ul', 'Sparks', {
  Item: 'li',
})

/** Two things side by side, one over the other on a phone. */
export let Split: Part = el('div', 'Split')

/** The price, said large on a dusk card. */
export let Price:
  & Part
  & Record<'Eyebrow' | 'Amount' | 'From' | 'Cents' | 'Unit' | 'Fine', Part> =
    block(Card, 'Price', {
      Eyebrow: 'p',
      Amount: 'p',
      From: 'span',
      Cents: 'span',
      Unit: 'p',
      Fine: 'p',
    })

/** Pages of a printed book: an open spread, and single pages beside one
 * another. */
export let Pages: Part & Record<'Spread' | 'Caption' | 'Grid' | 'Page', Part> =
  block('div', 'Pages', {
    Spread: 'figure',
    Caption: 'figcaption',
    Grid: 'ul',
    Page: 'li',
  })

/** Questions and their answers, ruled apart. */
export let Faq: Part & Record<'Item' | 'Question' | 'Answer', Part> = block(
  'dl',
  'Faq',
  { Item: 'div', Question: 'dt', Answer: 'dd' },
)

/** The top of a guide or a policy: what kind of page, its title, its date. */
export let Cover: Part & Record<'Inner' | 'Eyebrow' | 'Title' | 'Meta', Part> =
  block('header', 'Cover', {
    Inner: 'div',
    Eyebrow: 'p',
    Title: 'h1',
    Meta: 'p',
  })

/** The column a guide or a policy is read in. */
export let Reading: Part = el('main', 'Reading')

/** Words to take away, on a dusk card: a label and what copies them over the
 * words themselves. */
export let Prompt: Part & Record<'Bar' | 'Label' | 'Text', Part> = block(
  'div',
  'Prompt',
  { Bar: 'div', Label: 'p', Text: 'pre' },
)

/** The foot of every page. */
export let Foot:
  & Part
  & Record<'Inner' | 'Brand' | 'Tag' | 'Nav' | 'Legal', Part> = block(
    'footer',
    'Foot',
    {
      Inner: 'div',
      Brand: 'div',
      Tag: 'p',
      Nav: 'nav',
      Legal: 'p',
    },
  )

/** The studio's desk: under its `Head` (the way `Back` to the shelf over the
 * page's `Title`), its sheets side by side in a `Spread`, one over the other
 * on a phone, a `Column` holding several in one side of it. `Words` is the
 * field a book's words are pasted into, tall before any are. `Said` is where
 * the line the desk says back stays in sight. */
export let Desk:
  & Part
  & Record<
    'Head' | 'Back' | 'Title' | 'Spread' | 'Column' | 'Words' | 'Said',
    Part
  > = block('main', 'Desk', {
    Head: 'header',
    Back: 'a',
    Title: 'h1',
    Spread: 'div',
    Column: 'div',
    Words: Field as Part,
    Said: 'div',
  })

/** A printer's proof: the composed `Pages` one under another, each `Page`
 * its `Image` over its `Caption`, then the `Files` they were cut from. */
export let Proof:
  & Part
  & Record<'Pages' | 'Page' | 'Image' | 'Caption' | 'Files', Part> = block(
    'div',
    'Proof',
    {
      Pages: 'div',
      Page: 'figure',
      Image: 'img',
      Caption: 'figcaption',
      Files: 'div',
    },
  )

/** What a quote or an order comes to: each `Line` a `Name` beside its
 * `Value`, the `total` said large. */
export let Slip: Part & Record<'Line' | 'Name' | 'Value', Part> = block(
  'dl',
  'Slip',
  { Line: 'div', Name: 'dt', Value: 'dd' },
)
