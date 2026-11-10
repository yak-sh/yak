/** The pages one visitor's link opens: a finished coloring page and its
 * printable, the page said when a drawing failed, the wait while a
 * printable is laid out, and the mail opt-out. None is for a search engine. */
import { type ComponentChildren, h } from 'preact'
import { Button } from '@yaks/ui/parts'
import { Band } from '../look/parts/Band.ts'
import { Desk } from '../look/parts/Desk.ts'
import { Kicker } from '../look/parts/Kicker.ts'
import { Lead } from '../look/parts/Lead.ts'
import { Sheet } from '../look/parts/Sheet.ts'
import { answered, type Place, type Sheet as Page } from './frame.ts'

/** A page of a few centred words, and what to press under them. */
let said = (
  place: Place,
  page: Omit<Page, 'place' | 'children' | 'robots'>,
  ...children: ComponentChildren[]
): Response =>
  answered({
    ...page,
    place,
    robots: 'noindex',
    children: h(
      'main',
      { id: 'main' },
      h(Band, { mod: ['first', 'center'] }, h(Band.Inner, {}, children)),
    ),
  })

/** A finished free page: the drawing, and every way to take it home. */
export let ready = (
  place: Place,
  here: string,
  idea: string,
  png: boolean,
): Response =>
  said(
    place,
    { title: `“${idea.slice(0, 70)}” — CrayonBloom` },
    h(
      Lead,
      { mod: 'page' },
      h(Kicker, { mod: 'sun' }, 'Ready to color'),
      h(Lead.Title, { as: 'h1' }, 'Your page is ready!'),
      h(Lead.Lede, {}, `“${idea}”`),
    ),
    h(
      Sheet,
      { mod: 'taped' },
      h(
        Sheet.Art,
        {},
        h(Sheet.Line, {
          src: place.at(here + '/artwork'),
          alt: `Coloring page for ${idea}`,
        }),
      ),
    ),
    h(
      Desk.Row,
      {},
      h(
        Button,
        { mod: 'go', href: place.at(here + '/download') },
        'Download printable PDF',
      ),
      h(
        Button,
        { href: place.at(here + '/artwork'), download: true },
        png ? 'Download image (PNG)' : 'Download image',
      ),
      h(
        Button,
        { mod: 'quiet', href: place.at('/coloring-pages') },
        'More pages to print',
      ),
    ),
    h(
      'p',
      {},
      'The printable has a blank line at the bottom. Your kid can sign it in crayon when the coloring is done.',
    ),
  )

/** A free page whose drawing failed, and where to find ones that did not. */
export let slipped = (place: Place): Response =>
  said(
    place,
    { title: 'A coloring page — CrayonBloom' },
    h(
      Lead,
      { mod: 'page' },
      h(Lead.Title, { as: 'h1' }, 'That one didn’t come out right.'),
      h(
        Lead.Lede,
        {},
        'Our crayons slipped on this one. Here’s a shelf of pages that are ready to print right now.',
      ),
    ),
    h(
      Desk.Row,
      {},
      h(
        Button,
        { mod: 'go', href: place.at('/coloring-pages') },
        'Browse coloring pages',
      ),
    ),
  )

/** The wait while a printable is laid out; the page asks again by itself. */
export let preparing = (place: Place): Response =>
  said(
    place,
    { title: 'Preparing your free printable — CrayonBloom', refresh: 2 },
    h(
      Lead,
      { mod: 'page' },
      h(Kicker, { mod: 'sun' }, 'Almost there'),
      h(Lead.Title, { as: 'h1' }, 'Laying out your printable.'),
      h(
        Lead.Lede,
        {},
        'Your free printable is being laid out. This page will open the PDF when it is ready. Your artwork is saved.',
      ),
    ),
  )

/** The mail opt-out: the choice, or that it is made. */
export let optOut = (place: Place, unsubscribed: boolean): Response =>
  said(
    place,
    { title: 'Unsubscribe — CrayonBloom' },
    h(
      Lead,
      { mod: 'page' },
      h(Lead.Title, { as: 'h1' }, 'Unsubscribe'),
      h(
        Lead.Lede,
        {},
        unsubscribed
          ? 'You are unsubscribed from commercial messages.'
          : 'You can stop commercial messages from CrayonBloom.',
      ),
    ),
    !unsubscribed &&
      h('form', { method: 'post' }, h(Button, { mod: 'go' }, 'Unsubscribe')),
  )
