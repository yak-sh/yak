import { day } from '@yaks/ui/relative'
/** @jsxImportSource preact */
import {
  Button,
  Card,
  Chip,
  Chips,
  type Composition,
  Field,
  kits,
  linen,
  pencil,
  Worn,
} from '@yaks/ui'
import type { ComponentChildren } from 'preact'
import { WORN } from '../sheet-assets.ts'
import { Page, Yours } from './frame.tsx'

// What a person copies or types, in the line.
let Code = ({ children }: { children: ComponentChildren }) => (
  <Chip as='code' mod='code'>{children}</Chip>
)

// The kit as these pages wear it, and its parts but the document's defaults,
// which are this page's own type.
let drawn: Composition = { kits, theme: linen, skin: pencil }
let PARTS = WORN.filter((part) => part != 'base')

// What an app's preview shows, inside its window.
let PREVIEW =
  "<!doctype html><html lang='en'><meta name='color-scheme' content='dark'><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#33493c;color:#f1e6d8;font:600 1rem/1.5 system-ui,sans-serif}p{padding:2rem;text-align:center}</style><body><p>A working app appears inside this frame.</p></body></html>"

// The theme picker, and each token's value as the page is painted.
let PICK = `
    let root = document.documentElement
    let theme = document.querySelector('#theme')
    let system = matchMedia('(prefers-color-scheme: dark)')

    for (let button of document.querySelectorAll('.Guide button[aria-pressed]')) {
      button.addEventListener('click', () => {
        button.setAttribute(
          'aria-pressed',
          String(button.getAttribute('aria-pressed') != 'true'),
        )
      })
    }

    let values = () => {
      for (let el of document.querySelectorAll('[data-token]')) {
        let slot = el.querySelector('.Guide_Value')
        let bar = el.querySelector('.Guide_Bar')
        let chip = el.querySelector('.Guide_Chip:not([style*="border"])')
        if (!slot) continue
        // A role is a light and a dark paint; the chip shows the one the
        // page is in.
        slot.textContent = bar
          ? Math.round(bar.getBoundingClientRect().width) + 'px'
          : chip
          ? getComputedStyle(chip).backgroundColor
          : getComputedStyle(el).getPropertyValue(el.dataset.token).trim()
      }
    }

    let choose = () => {
      root.style.colorScheme = theme.value == 'system' ? '' : theme.value
      values()
    }

    theme.addEventListener('change', choose)
    system.addEventListener('change', () => {
      if (theme.value == 'system') values()
    })
    choose()
    `

export let StyleGuide = () => (
  <Page
    copy='style-guide'
    path='/style-guide'
    kind='Guide'
    robots='noindex, follow'
    after={
      <>
        <script dangerouslySetInnerHTML={{ __html: PICK }} />
        <script type='module' src='chart.js' />
        <script src='drop.js' defer />
      </>
    }
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page'>Style guide</h1>
      <p class='Note Note-lead'>
        This page renders the shared tokens and components used across yaks.app.
        Use it to check a change against the rest of the site.
      </p>
      <p>
        <label class='Note Note-small' for='theme'>Preview theme</label>{' '}
        <Field choose id='theme' name='theme'>
          <option value='system'>System</option>
          <option value='light'>Light</option>
          <option value='dark'>Dark</option>
        </Field>
      </p>
      <nav aria-label='On this page'>
        <Chips as='ul'>
          <li>
            <Chip href='#how-to'>Using the system</Chip>
          </li>
          <li>
            <Chip href='#voice'>Layout and voice</Chip>
          </li>
          <li>
            <Chip href='#language'>One design language</Chip>
          </li>
          <li>
            <Chip href='#theme-roles'>The theme</Chip>
          </li>
          <li>
            <Chip href='#page-paints'>Page paints</Chip>
          </li>
          <li>
            <Chip href='#type'>Type</Chip>
          </li>
          <li>
            <Chip href='#space'>Space and shape</Chip>
          </li>
          <li>
            <Chip href='#components'>Components</Chip>
          </li>
          <li>
            <Chip href='#kit'>The kit's parts</Chip>
          </li>
          <li>
            <Chip href='#sections'>Sections</Chip>
          </li>
        </Chips>
      </nav>
    </div>
    <section class='Guide_Part' aria-labelledby='how-to'>
      <h2 class='Title' id='how-to'>Using the system</h2>
      <p class='Note'>
        No build step of ours, four declared layers — tokens, base, components,
        and sections. Later layers take precedence. Every part below is one of
        the @yaks/ui kit's, in its <Code>linen</Code> theme and drawn by its
        {' '}
        <Code>pencil</Code> skin: the deploy composes them as{' '}
        <Code>_ui.css</Code> (sheet-assets.ts names the parts the pages wear).
        {' '}
        <Code>site.css</Code>{' '}
        adds the face and what only these pages paint. The management pages'
        {' '}
        <Code>pages.css</Code> and the site's <Code>style.css</Code>{' '}
        load both and lay out their pages. Follow these rules when adding a page
        or component:
      </p>
      <ul class='Guide_Rules'>
        <li>
          <b>Use an existing part before writing new CSS.</b>{' '}
          A part a page lacks goes into the kit, drawn by pencil, with an
          example here. The available titles, notes, chips, buttons, fields,
          tabs, sidebars, bubbles, windows, cards, rows, forms, and prose styles
          are shown below, and the rules they follow are under One design
          language.
        </li>
        <li>
          <b>Use colour roles, never a colour.</b> Write{' '}
          <Code>var(--text)</Code>, never{' '}
          <Code>#523828</Code>. The theme gives each role a light and a dark
          paint; a colour written down follows neither.
        </li>
        <li>
          <b>Implement variants with custom properties.</b>{' '}
          <Code>.Chip-quiet</Code> sets <Code>--chip-fill</Code>{' '}
          instead of repeating the component's padding and border.
        </li>
        <li>
          <b>Keep page-specific layout in the sections layer.</b>{' '}
          Reusable UI belongs in the components layer; layout used in one place
          does not.
        </li>
      </ul>
      <p class='Note Note-small'>
        When adding a component, add a working example here so this guide
        remains complete.
      </p>
    </section>
    <section class='Guide_Part' aria-labelledby='voice'>
      <h2 class='Title' id='voice'>Layout and voice</h2>
      <ul class='Guide_Rules'>
        <li>
          <b>Draw in pencil on paper, and keep surfaces flat.</b>{' '}
          A card, a button, a window and a linked chip are drawn: a graphite
          line around it with slightly rounded corners. A field is drawn the
          same way around a well: a fill a little darker than the paper, pressed
          in, and what is typed in it stays crisp. What can be pressed sits on a
          hatch, so a hatch always means a press. One grain of paper lies over
          every page.
        </li>
        <li>
          <b>Make selection visible in the shape.</b>{' '}
          A selected tab joins its panel, a pressed button slides onto its
          hatch, and the current sidebar tab joins the page along its right
          edge. Keep these cues in shared components so they work consistently
          in light and dark themes.
        </li>
        <li>
          <b>Keep prose narrow.</b> Articles, help, and legal pages use{' '}
          <Code>--measure</Code>. Use <Code>--wide-measure</Code>{' '}
          only when a grid, preview, or comparison needs the extra width.
        </li>
        <li>
          <b>Name the subject and the action.</b>{' '}
          Write “Claude builds the app” or “yaks.app hosts it,” not “it gets
          built” or “the idea comes to life.”
        </li>
        <li>
          <b>Use specific nouns.</b>{' '}
          Name recipes, files, invitations, and links instead of “things,”
          “bits,” or “what you need.”
        </li>
        <li>
          <b>Remove filler.</b>{' '}
          Cut phrases such as “a little something” and “brought to life.” State
          the feature, limit, or next step. Contractions and questions are fine
          when they help the reader.
        </li>
        <li>
          <b>Use concrete actions for links and buttons.</b>{' '}
          “Connect Claude,” “View pricing,” and “Open the recipe box” tell
          people what happens next.
        </li>
        <li>
          <b>Make only claims the product can guarantee.</b>{' '}
          Distinguish an app hosted by yaks.app from ownership of a domain,
          source code, or exported data.
        </li>
      </ul>
    </section>
    <section class='Guide_Part' aria-labelledby='language'>
      <h2 class='Title' id='language'>One design language</h2>
      <p class='Note'>
        Every page yaks.app draws, the dashboard's tabs and the site's own pages
        alike, is built from the same few parts in the same way. A person who
        learns one page has learned them all.
      </p>
      <ul class='Guide_Rules'>
        <li>
          <b>A card holds one thing.</b>{' '}
          A connection, a plan, the people in a space, one app's visits: each is
          one{' '}
          <Code>.Card</Code>. Cards stack one gap apart, and a run of cards that
          belong together sits under a <Code>.Group</Code> heading.
        </li>
        <li>
          <b>A card's head says what it is and holds what acts on it.</b>{' '}
          The head runs across the top: a mark, the title, its status, then its
          actions at the right. Disconnect, Restore, Manage billing and Connect
          go there, a size smaller than a form's button, so a head stays one
          line.
        </li>
        <li>
          <b>Hierarchy is four steps of type.</b>{' '}
          The page title; a card's title at 1rem; what a thing says at{' '}
          <Code>--small</Code>{' '}
          or the body size; and what describes it (a hint, a status, a count, a
          date) at <Code>--fine</Code> in{' '}
          <Code>--muted</Code>. The mono face is only for what a person copies
          or types.
        </li>
        <li>
          <b>Like things are rows.</b>{' '}
          The apps using a connection, the people in a space, the agents
          connected, the apps in the trash: <Code>.Rows</Code>{' '}
          in a card, hairlines between them, each row's actions at its right.
        </li>
        <li>
          <b>A field sits under its label, never at the end of a sentence.</b>
          {' '}
          Every field (
          <Code>.Form_Field</Code>) is its label, its control and its hint, on
          one left edge and at most 34rem wide, in a form or alone in a card.
          One field and its button share a line (
          <Code>.Form_Line</Code>); a longer form ends with its button. What
          only a few people change folds under <b>Advanced options</b> (
          <Code>.More</Code>) with a sensible default already in place.
        </li>
        <li>
          <b>Space comes from the container.</b>{' '}
          Cards, forms and rows set the gap between what they hold; nothing
          inside carries a margin of its own. A card's parts are .75rem apart,
          cards one gap, groups two.
        </li>
        <li>
          <b>Nothing overlaps at any width.</b>{' '}
          A name too long for its column is cut with an ellipsis and keeps its
          whole text as a title; a number is never cut and never wraps; a row
          that runs out of room wraps its actions under it.
        </li>
      </ul>
    </section>
    <section class='Guide_Part' aria-labelledby='theme-roles'>
      <h2 class='Title' id='theme-roles'>The theme</h2>
      <p class='Note'>
        yaks.app wears{' '}
        <Code>linen</Code>, a theme of the @yaks/ui kit: every colour a part
        reads is one of its roles, and each role is a light and a dark paint.
        Values reflect the selected theme.
      </p>
      <ul class='Guide_Swatches'>
        <li class='Guide_Swatch' data-token='--bg'>
          <span class='Guide_Chip' style='--swatch: var(--bg)' />{' '}
          <code class='Guide_Name'>--bg</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--surface'>
          <span class='Guide_Chip' style='--swatch: var(--surface)' />{' '}
          <code class='Guide_Name'>--surface</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--card'>
          <span class='Guide_Chip' style='--swatch: var(--card)' />{' '}
          <code class='Guide_Name'>--card</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--border'>
          <span class='Guide_Chip' style='--swatch: var(--border)' />{' '}
          <code class='Guide_Name'>--border</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--border2'>
          <span class='Guide_Chip' style='--swatch: var(--border2)' />{' '}
          <code class='Guide_Name'>--border2</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--text'>
          <span class='Guide_Chip' style='--swatch: var(--text)' />{' '}
          <code class='Guide_Name'>--text</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--muted'>
          <span class='Guide_Chip' style='--swatch: var(--muted)' />{' '}
          <code class='Guide_Name'>--muted</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--dim'>
          <span class='Guide_Chip' style='--swatch: var(--dim)' />{' '}
          <code class='Guide_Name'>--dim</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--accent'>
          <span class='Guide_Chip' style='--swatch: var(--accent)' />{' '}
          <code class='Guide_Name'>--accent</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--link'>
          <span class='Guide_Chip' style='--swatch: var(--link)' />{' '}
          <code class='Guide_Name'>--link</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--heading'>
          <span class='Guide_Chip' style='--swatch: var(--heading)' />{' '}
          <code class='Guide_Name'>--heading</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--info'>
          <span class='Guide_Chip' style='--swatch: var(--info)' />{' '}
          <code class='Guide_Name'>--info</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--active'>
          <span class='Guide_Chip' style='--swatch: var(--active)' />{' '}
          <code class='Guide_Name'>--active</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--positive'>
          <span class='Guide_Chip' style='--swatch: var(--positive)' />{' '}
          <code class='Guide_Name'>--positive</code>{' '}
          <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--negative'>
          <span class='Guide_Chip' style='--swatch: var(--negative)' />{' '}
          <code class='Guide_Name'>--negative</code>{' '}
          <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--caution'>
          <span class='Guide_Chip' style='--swatch: var(--caution)' />{' '}
          <code class='Guide_Name'>--caution</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--special'>
          <span class='Guide_Chip' style='--swatch: var(--special)' />{' '}
          <code class='Guide_Name'>--special</code> <span class='Guide_Value' />
        </li>
      </ul>
    </section>
    <section class='Guide_Part' aria-labelledby='page-paints'>
      <h2 class='Title' id='page-paints'>Page paints</h2>
      <p class='Note'>
        What only yaks.app's pages paint, and no theme names: the person's
        bubble, the assistant's, an embedded app's ground and a field's well.
        They are declared in{' '}
        <Code>site.css</Code>, from the theme's roles where they can be.
      </p>
      <ul class='Guide_Swatches'>
        <li class='Guide_Swatch' data-token='--mine'>
          <span class='Guide_Chip' style='--swatch: var(--mine)' />{' '}
          <code class='Guide_Name'>--mine</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--theirs'>
          <span class='Guide_Chip' style='--swatch: var(--theirs)' />{' '}
          <code class='Guide_Name'>--theirs</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--preview'>
          <span class='Guide_Chip' style='--swatch: var(--preview)' />{' '}
          <code class='Guide_Name'>--preview</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--well'>
          <span class='Guide_Chip' style='--swatch: var(--well)' />{' '}
          <code class='Guide_Name'>--well</code> <span class='Guide_Value' />
        </li>
      </ul>
    </section>
    <section class='Guide_Part' aria-labelledby='type'>
      <h2 class='Title' id='type'>Type</h2>
      <Card as='div' class='Guide_Demo'>
        <p data-token='--font'>
          <span class='Guide_Name'>--font</span> <span class='Guide_Value' />
        </p>
        <p data-token='--mono' style='font-family: var(--mono)'>
          <span class='Guide_Name'>--mono</span> <span class='Guide_Value' />
        </p>
        <p data-token='--size' style='font-size: var(--size)'>
          <span class='Guide_Name'>--size</span> <span class='Guide_Value' />
          {' '}
          — body text.
        </p>
        <p data-token='--lead' style='font-size: var(--lead)'>
          <span class='Guide_Name'>--lead</span> <span class='Guide_Value' />
          {' '}
          — introductory text.
        </p>
        <p data-token='--small' style='font-size: var(--small)'>
          <span class='Guide_Name'>--small</span> <span class='Guide_Value' />
          {' '}
          — captions, footers, and what a card says.
        </p>
        <p data-token='--fine' style='font-size: var(--fine)'>
          <span class='Guide_Name'>--fine</span> <span class='Guide_Value' />
          {' '}
          — what describes a thing: a hint, a status, a count, a date.
        </p>
      </Card>
    </section>
    <section class='Guide_Part' aria-labelledby='space'>
      <h2 class='Title' id='space'>Space and shape</h2>
      <p class='Note'>
        Spacing tokens derive from <Code>--gap</Code>.
      </p>
      <ul class='Guide_Sizes'>
        <li class='Guide_Size' data-token='--quarter-gap'>
          <span>
            <code class='Guide_Name'>--quarter-gap</code>{' '}
            <span class='Guide_Value' />
          </span>{' '}
          <span class='Guide_Bar' style='--bar: var(--quarter-gap)' />
        </li>
        <li class='Guide_Size' data-token='--half-gap'>
          <span>
            <code class='Guide_Name'>--half-gap</code>{' '}
            <span class='Guide_Value' />
          </span>{' '}
          <span class='Guide_Bar' style='--bar: var(--half-gap)' />
        </li>
        <li class='Guide_Size' data-token='--gap'>
          <span>
            <code class='Guide_Name'>--gap</code> <span class='Guide_Value' />
          </span>{' '}
          <span class='Guide_Bar' style='--bar: var(--gap)' />
        </li>
        <li class='Guide_Size' data-token='--wide-gap'>
          <span>
            <code class='Guide_Name'>--wide-gap</code>{' '}
            <span class='Guide_Value' />
          </span>{' '}
          <span class='Guide_Bar' style='--bar: var(--wide-gap)' />
        </li>
      </ul>
      <p class='Note Note-small' data-token='--measure'>
        <code class='Guide_Name'>--measure</code> — the maximum width for prose:
        {' '}
        <span class='Guide_Value' /> in this context.
      </p>
      <p class='Note Note-small' data-token='--wide-measure'>
        <code class='Guide_Name'>--wide-measure</code>{' '}
        — the maximum width for grids and previews:{' '}
        <span class='Guide_Value' />.
      </p>
      <p class='Note Note-small'>
        <code class='Guide_Name'>--side</code> and{' '}
        <code class='Guide_Name'>--aside</code>{' '}
        add a sidebar before the reading column and a gutter after it, and{' '}
        <code class='Guide_Name'>--rhythm</code>{' '}
        says how far apart the page's sections sit. A page kind sets all four on
        its{' '}
        <Code>body</Code>, and the header, the page and the footer are framed by
        the sum.
      </p>
      <p class='Note Note-small'>
        Shape is pencil and paper: the colour and weight of a drawn line, how
        round its corners are, and how far a button sits off its hatch.
      </p>
      <ul class='Guide_Swatches'>
        <li class='Guide_Swatch' data-token='--graphite'>
          <span class='Guide_Chip' style='--swatch: var(--graphite)' />{' '}
          <code class='Guide_Name'>--graphite</code>{' '}
          <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--stroke'>
          <span
            class='Guide_Chip'
            style='--swatch: var(--card); border: var(--stroke) solid var(--graphite)'
          />{' '}
          <code class='Guide_Name'>--stroke</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--radius'>
          <Card
            as='span'
            class='Guide_Chip'
            style='--swatch: var(--card); border-color: transparent'
          />{' '}
          <code class='Guide_Name'>--radius</code> <span class='Guide_Value' />
        </li>
        <li class='Guide_Swatch' data-token='--lift'>
          <Button
            as='span'
            mod='go'
            class='Guide_Chip'
            style='--swatch: var(--accent); border-color: transparent'
          />{' '}
          <code class='Guide_Name'>--lift</code> <span class='Guide_Value' />
        </li>
      </ul>
    </section>
    <section class='Guide_Part' aria-labelledby='components'>
      <h2 class='Title' id='components'>Components</h2>
      <p class='Note'>
        Each reusable component appears beside its class name. Dashed borders
        mark examples and are not part of the component.
      </p>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>.Title · .Title-hero · .Title-page</p>
        <p class='Title Title-hero'>Build an app by asking Claude</p>
        <p class='Title Title-page'>The title of a page</p>
        <p class='Title'>The heading of one section</p>
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>.Note · .Note-lead · .Note-small</p>
        <p class='Note Note-lead'>Introductory copy below a page title.</p>
        <p class='Note'>Supporting copy at the page's body size.</p>
        <p class='Note Note-small'>A caption, a footnote, a date.</p>
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>
          .Chat · .Chat_Who · .Chat_Who-you · .Chat_Bubble · .Chat_Bubble-you ·
          .Chat_Bubble-them
        </p>
        <Card as='div' class='Chat'>
          <h3 class='Chat_Who Chat_Who-you'>You ask.</h3>
          <p class='Chat_Bubble Chat_Bubble-you'>
            Could you make me a recipe box?
          </p>
          <h3 class='Chat_Who'>It gets built.</h3>
          <p class='Chat_Bubble Chat_Bubble-them'>Sure, give me a minute.</p>
          <p class='Note Note-small'>A caption at the foot of the exchange.</p>
        </Card>
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>.Said</p>
        <p class='Note'>
          Use <Code>{'<q>'}</Code>{' '}
          for words a person says to an assistant. The element remains a
          quotation without CSS, and the background continues across line
          breaks:{' '}
          <q class='Said'>
            invite ana@example.com to the recipe box, say it's for Saturday, and
            put the newest recipes first
          </q>.
        </p>
        <p class='Note'>
          Short ones sit in the line the same way:{' '}
          <q class='Said'>take Ana out.</q>
        </p>
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>
          .Window · .Window_Bar · .Window_Body · .Window_Heading · .Window_List
          · .Window_On · .Window_Body-frame · .Window_Frame
        </p>
        <div class='Window'>
          <div class='Window_Bar'>
            <Chip mod='quiet'>
              <Yours path='/recipes' />
            </Chip>
          </div>
          <div class='Window_Body'>
            <p class='Window_Heading'>Our recipe box</p>
            <ul class='Window_List'>
              <li class='Window_Item'>Grandma's lemon cake</li>
              <li class='Window_Item'>Tuesday soup</li>
            </ul>
            <p class='Note Note-small'>
              A note on{' '}
              <span class='Window_On'>Tuesday soup</span>: “Taste for salt
              twice.”
            </p>
          </div>
        </div>
        <div class='Window'>
          <div class='Window_Bar'>
            <Chip mod='quiet'>
              <Yours path='/preview' />
            </Chip>
          </div>
          <div class='Window_Body Window_Body-frame'>
            <iframe
              class='Window_Frame'
              title='Example app preview'
              srcdoc={PREVIEW}
            />
          </div>
        </div>
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>.Yak · .Yak-small · .Yak-big</p>
        <p>
          <img class='Yak Yak-small' src='yak.webp' alt='' />
        </p>{' '}
        <img class='Yak Yak-big' src='yak.webp' alt='The yak, drawn big' />{' '}
        <p class='Note Note-small'>
          One transparent drawing, in{' '}
          <Code>yak.webp</Code>, serves both sizes. Square exports provide the
          favicon, home-screen icon, and future app-icon sizes.
        </p>
      </Card>
      <Card as='div' class='Guide_Demo'>
        <p class='Guide_Name'>.Prose · .Prose_Head · .Prose_When</p>
        <div class='Prose'>
          <div class='Prose_Head'>
            <h3 class='Title Title-page'>Cookies</h3>
            <p class='Prose_When Prose_Text'>
              Last updated {day('2026-09-03', 'UTC')}
            </p>
          </div>
          <section class='Prose_Section'>
            <h2 class='Prose_Heading'>What Prose styles</h2>
            <p class='Prose_Text'>
              Prose styles its named paragraphs, lists, links,{' '}
              <code class='Prose_Code'>code</code>, and addresses. Elements with
              a component class keep their component styles.
            </p>
            <ul class='Prose_List'>
              <li class='Prose_Item'>Plain paragraphs go quiet, in --muted.</li>
              <li class='Prose_Item'>
                A <a class='Prose_Link' href='#components'>link</a>{' '}
                takes the accent.
              </li>
            </ul>
            <address class='Prose_Address'>Yak Shaving LLC</address>
          </section>
        </div>
      </Card>
    </section>
    <section class='Guide_Part' aria-labelledby='kit'>
      <h2 class='Title' id='kit'>The kit's parts</h2>
      <p class='Note'>
        Every @yaks/ui part these pages wear, in every variant, as the linen
        theme and the pencil skin draw it. The examples are the kit's own.
      </p>
      <Worn parts={PARTS} composition={drawn} />
    </section>
    <section class='Guide_Part' aria-labelledby='sections'>
      <h2 class='Title' id='sections'>Page-specific sections</h2>
      <p class='Note'>
        The sections layer contains layout used in one place. Do not reuse a
        section class as a general component.
      </p>
      <ul class='Guide_Rules'>
        <li>
          <b>.Top</b>, <b>.Top_Name</b>{' '}
          — the shared site header. It is as wide as the page under it:{' '}
          <b>.Top</b>, <b>.Page</b> and <b>.Foot</b>{' '}
          all read the frame the page asked for. The home page shows the yak in
          its hero instead of beside the site name.
        </li>
        <li>
          <b>.Page</b>{' '}
          — the centred reading column and the two slots beside it. A page kind
          on the <Code>body</Code> says how wide it all is, by re-pointing{' '}
          <Code>--measure</Code>, <Code>--side</Code> and{' '}
          <Code>--aside</Code>, and how far apart its sections sit, with{' '}
          <Code>--rhythm</Code>. Pages that contain grids or previews may use
          {' '}
          <Code>--wide-measure</Code>.
        </li>
        <li>
          <b>.Home</b> — the home page's frame, asked for on its{' '}
          <Code>body</Code>.
        </li>
        <li>
          <b>.Hello</b>, <b>.Hello_Copy</b>, <b>.Hello_Yak</b>,{' '}
          <b>.Hello_Ask</b>, <b>.Demo</b>, <b>.Demo_Title</b>,{' '}
          <b>.Demo_Slides</b>, <b>.Demo_Controls</b>, <b>.Demo_Dots</b>,{' '}
          <b>.Demo_Dot</b>, <b>.Demo_Step</b>, <b>.Demo_Pause</b>{' '}
          (the examples' carousel), <b>.Yours</b>, <b>.Yours_List</b>,{' '}
          <b>.Make</b>, <b>.Make_Intro</b>, <b>.Make_List</b>, <b>.Make_Card</b>
          {' '}
          (a <b>.Card</b> an app is), <b>.Make_Shot</b>, <b>.How</b>,{' '}
          <b>.Steps</b>, <b>.Step_Name</b>, <b>.Join</b>, <b>.Join_Doors</b>
          {' '}
          — home page sections and their layout elements. Pricing also uses{' '}
          <b>.Hello</b>, <b>.Yours</b>, and{' '}
          <b>.Join</b>; homepage-specific overrides stay under{' '}
          <Code>.Home</Code>.
        </li>
        <li>
          <b>.Foot</b>, <b>.Foot_Links</b> — the shared site footer.
        </li>
        <li>
          <b>.Guide</b> and its elements — layout for this reference page.
        </li>
      </ul>
    </section>
  </Page>
)
