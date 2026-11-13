/** @jsxImportSource preact */
// The parts of a page of prose, the terms and the policies: its head, its
// sections, its address and its links, each showing a snippet of the home
// app's copy under a key the page gives.
import { Time } from '@yaks/ui/parts'
import type { ComponentChildren } from 'preact'
import { type Slots, text } from './copy.ts'

/** A link in a sentence to `href`, its words the snippet at `key`. */
export let link = (href: string, key: string) => (
  <a class='Prose_Link' href={href} {...text(key)} />
)

/** The address that reaches us, as a sentence's link to it. */
export let mail = (
  <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>
)

/** A page's title, when it last changed (`%{date}`, the day `updated`), and
 * what it is: the snippets at `<at>.title`, `<at>.updated` and `<at>.intro`. */
export let Top = ({ at, updated }: { at: string; updated: string }) => (
  <div class='Prose_Head'>
    <h1 class='Title Title-page' {...text(`${at}.title`)} />
    <p
      class='Prose_When Prose_Text'
      {...text(`${at}.updated`, {
        date: <Time written timeZone='UTC' at={updated} />,
      })}
    />
    <p class='Prose_Text' {...text(`${at}.intro`)} />
  </div>
)

/** A section: its heading the snippet at `<at>.title`, then `children`, then
 * a paragraph for each of `says`, the snippet at `<at>.<name>` with its
 * slots. */
export let Section = (
  { at, says = {}, children }: {
    at: string
    says?: Record<string, Slots>
    children?: ComponentChildren
  },
) => (
  <section class='Prose_Section'>
    <h2 class='Prose_Heading' {...text(`${at}.title`)} />
    {children}
    {Object.entries(says).map(([name, slots]) => (
      <p class='Prose_Text' {...text(`${at}.${name}`, slots)} />
    ))}
  </section>
)

/** A postal address, the snippet at `at`, its lines broken at `%{br}`. */
export let Postal = ({ at }: { at: string }) => (
  <address class='Prose_Address' {...text(at, { br: <br /> })} />
)
