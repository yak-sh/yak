// A hero's look: the name over their head, and the colours of their tunic,
// hair and skin, each picked from a row of swatches (ui/Make.css,
// ui/Swatch.css). The gate makes one for a new hero (main.ts), and the
// Character tab changes it (character.ts); both draw the same fields and
// answer them the same way. A hero's look is what their player row was made
// with, and over it the newest of their look rows, since a visitor may only
// add rows (net.ts `who`).

/** How a hero looks: their name, and their colours as #rrggbb. */
export type Look = { name: string; tint: string; hair: string; skin: string }

/** The colours a hero picks from, and the names one is offered. */
export let TINTS = [
  '#c9503f',
  '#e08a3c',
  '#e7c14e',
  '#5f9f4a',
  '#3f86b8',
  '#7a5cb8',
  '#d46a9a',
  '#4a5a6a',
]
export let HAIRS = [
  '#3b2a20',
  '#6b4428',
  '#b8742f',
  '#e2c16b',
  '#d9d4c8',
  '#2c2f3a',
  '#a2462f',
]
export let SKINS = ['#f3cfb3', '#e7b996', '#c98f68', '#9a6444', '#6b432c']
export let NAMES = [
  'Bramble',
  'Wren',
  'Tansy',
  'Rook',
  'Fennel',
  'Pip',
  'Juniper',
  'Sorrel',
  'Quill',
  'Hazel',
]

let pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** A look to start from: colours at random, and no name yet. */
export let anyLook = (): Look => ({
  name: '',
  tint: pick(TINTS),
  hair: pick(HAIRS),
  skin: pick(SKINS),
})

/** A name at random. */
export let anyName = () => pick(NAMES)

/** How long a name may be. */
export let LONGEST = 18

/** How a hero looks now: `made`, their player row, and over it `kept`, their
 * newest look row, if they kept one.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let made = { name: 'Wren', tint: '#111111', hair: '#222222', skin: '#333333' }
 * assertEquals(lookOf(made), made)
 * assertEquals(
 *   lookOf(made, { player: 'h', name: 'Rook', tint: '#444444', at: 2 }),
 *   { name: 'Rook', tint: '#444444', hair: '#222222', skin: '#333333' },
 * )
 * assertEquals(lookOf({}).name, 'Wanderer')
 * ```
 */
export let lookOf = (
  made: Record<string, unknown>,
  kept: Record<string, unknown> = {},
): Look => {
  let at = (k: keyof Look, or: string): string =>
    typeof kept[k] == 'string'
      ? kept[k]
      : typeof made[k] == 'string'
      ? made[k]
      : or
  return {
    name: at('name', 'Wanderer'),
    tint: at('tint', '#c95f4a'),
    hair: at('hair', '#5a3a26'),
    skin: at('skin', '#e7b996'),
  }
}

// Each colour: what it is called, and its swatches.
let ROWS: ['tint' | 'hair' | 'skin', string, string[]][] = [
  ['tint', 'Tunic', TINTS],
  ['hair', 'Hair', HAIRS],
  ['skin', 'Skin', SKINS],
]

/** The name, and a row of swatches for each colour, `look`'s picked, as
 * HTML for a form. */
export let fields = (look: Look) =>
  `<label class=Make_Name>Your name<input name=name maxlength=${LONGEST} autocomplete=off value="${
    esc(look.name)
  }" required></label>` +
  ROWS.map(([k, label, colors]) =>
    `<span class=Make_Label>${label}</span><div class=Make_Row data-k=${k}>${
      colors.map((c) =>
        `<button type=button class="Swatch${
          c == look[k] ? ' Swatch-on' : ''
        }" style="--c:${c}" data-c="${c}" aria-label="${label} ${c}"></button>`
      ).join('')
    }</div>`
  ).join('')

/** Answer the fields in `form` into `look`: a swatch tapped picks its
 * colour, and the name is what is written. `changed` hears each, and
 * `typing` whether the name has the keyboard. */
export let picks = (
  form: HTMLElement,
  look: Look,
  changed: () => void,
  typing: (on: boolean) => void,
) => {
  form.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLInputElement) typing(true)
  })
  form.addEventListener('focusout', (e) => {
    if (e.target instanceof HTMLInputElement) typing(false)
  })
  form.addEventListener('input', (e) => {
    if (!(e.target instanceof HTMLInputElement)) return
    look.name = e.target.value.trim().slice(0, LONGEST)
    changed()
  })
  form.addEventListener('click', (e) => {
    let b = e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-c]')
      : null
    let row = b?.parentElement
    let k = row?.dataset.k
    if (!b || !row || (k != 'tint' && k != 'hair' && k != 'skin')) return
    look[k] = b.dataset.c ?? look[k]
    for (let s of row.children) s.classList.toggle('Swatch-on', s == b)
    changed()
  })
}
