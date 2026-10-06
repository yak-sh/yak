// The gate: the card over the scene before playing (ui/Gate.css), where one
// of your heroes is chosen (ui/Hero.css), a new one made (make.ts), or a
// private vale asks you to sign in. Each is drawn whole in place of the one
// before.
import { type ComponentChildren, h, render } from 'preact'
import { Button } from '@yaks/ui'
import { fields, type Look, picks } from './make.ts'
import type { Hero, Me } from './net.ts'

let TITLE = h('h1', { class: 'Gate_Title' }, 'Mossvale')
let lede = (words: string) => h('p', { class: 'Gate_Lede' }, words)
let NOTE = h(
  'p',
  { class: 'Gate_Note' },
  'Slimes in the meadow, boars in Whisperwood, walking stones in Craghollow, and something old on Thornback Ridge.',
)

/** What making a hero answers: a colour or the name changed, the name has
 * the keyboard or not, the hero is made, or back to the heroes. */
export type Making = {
  changed: () => void
  typing: (on: boolean) => void
  enter: () => void
  back: (() => void) | null
}

/** The gate's card, drawn into `card`. */
export let gateCard = (card: HTMLElement) => {
  let made = 0
  let show = (...kids: ComponentChildren[]) => render(kids, card)
  return {
    /** a vale only its people may see: the sign-in, where there is one */
    closed: (signIn: string | null) =>
      show(
        TITLE,
        lede('This vale is private.'),
        signIn && h(Button, { mod: 'go', href: signIn }, 'Sign in'),
      ),
    /** one of `heroes` to `pick`, or `more`, to make another */
    choose: (
      who: Me,
      heroes: Hero[],
      pick: (o: Hero) => void,
      more: () => void,
    ) =>
      show(
        TITLE,
        lede(
          `Welcome back${
            who.name ? `, ${who.name.split(/\s/)[0]}` : ''
          }. Who walks the vale today?`,
        ),
        h(
          'div',
          { class: 'Gate_Heroes' },
          heroes.map((o) =>
            h(
              'button',
              {
                key: o.eid,
                type: 'button',
                class: 'Hero',
                style: { '--tint': o.tint, '--hair': o.hair, '--skin': o.skin },
                onClick: () => pick(o),
              },
              h('i', { class: 'Hero_Face' }),
              h('b', {}, o.name),
            )
          ),
        ),
        h(Button, { type: 'button', onClick: more }, 'A new hero'),
        NOTE,
      ),
    /** make a hero, `look`: a guest is offered the sign-in that keeps
     * heroes, and one who may not write here is sent to it */
    make: (who: Me, look: Look, making: Making) => {
      let guest = !who.person && who.signIn
      show(
        TITLE,
        lede(
          'A little vale of moss and stone. Whoever else is here walks it with you.',
        ),
        h(
          'form',
          {
            key: ++made,
            class: 'Make',
            onSubmit: (e: Event) => {
              e.preventDefault()
              making.enter()
            },
          },
          fields(look),
          who.writes ? h(Button, { mod: 'go' }, 'Enter the vale') : h(
            Button,
            { mod: 'go', href: who.signIn || location.href },
            'Sign in to play',
          ),
          making.back &&
            h(Button, { type: 'button', onClick: making.back }, 'Back'),
        ),
        guest && who.writes
          ? h(
            'p',
            { class: 'Gate_Note' },
            h('a', { href: who.signIn }, 'Sign in'),
            ' to keep your heroes on every device. A hero made without signing in lasts as long as this tab.',
          )
          : NOTE,
      )
      picks(
        card.querySelector<HTMLElement>('.Make')!,
        look,
        making.changed,
        making.typing,
      )
    },
  }
}
