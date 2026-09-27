// The action bar: the hero's strike and the three abilities what they carry
// gives them (abilities.ts), each on its key, F, 1, 2 and 3, painted on the
// glass's pads (hud.ts), which on a phone sit under the right thumb about the
// strike. What is left of an ability's cooldown is swept over it, with the
// seconds, and it flashes when it is ready again; one a skill made stronger
// (skills.ts) wears a star. A slot nothing fills is not shown.
// Each slot is written only when what it shows changed.
import { HANDLES } from './arms.ts'
import { type Glyph, glyph } from './glyphs.ts'
import { type Action, keysOf } from './input.ts'
import { cap } from './panel.ts'
import type { Frame } from './play.ts'
import { formOf, SKILLS } from './skills.ts'

// Each slot's action, and the key it shows.
let ACTS: Action[] = ['strike', 'ability1', 'ability2', 'ability3']
let keyOf = (i: number) => cap(keysOf(ACTS[i])[0])

// What a slot shows: its glyph, what it says, and what is left of its
// cooldown, 0 to 1, and in whole seconds.
type Slot = {
  id: string
  icon: Glyph | ''
  says: string
  cd: number
  s: number
  strong: boolean
}
let slotOf = (f: Frame, i: number): Slot => {
  let k = f.sheet.kit
  if (!i) {
    let h = HANDLES[k.family]
    return {
      id: '',
      icon: '',
      says: k.twin
        ? `Two ${h.name.toLowerCase()}s: strike, a hand at a time (F or click)`
        : `${h.name}: strike (F or click)`,
      cd: 0,
      s: 0,
      strong: false,
    }
  }
  let id = f.sheet.abilities[i - 1] ?? ''
  let a = formOf(id, f.sheet.learned)
  if (!a) return { id, icon: '', says: '', cd: 0, s: 0, strong: false }
  let left = f.cool[id] ?? 0
  let by = f.sheet.learned.filter((k) => SKILLS[k].ability == id)
    .map((k) => SKILLS[k].name)
  return {
    id,
    icon: a.icon,
    says: `${a.name} (${keyOf(i)}): ${a.says}${
      by.length ? ` Made stronger by ${by.join(' and ')}.` : ''
    }`,
    strong: by.length > 0,
    cd: Math.round((left / a.cool) * 50) / 50,
    s: Math.ceil(left / 1000),
  }
}

/** Paint the bar on `pads`: the strike's, then the three abilities'. The
 * strike keeps its own icon; an ability's goes in its `.Pad_Icon`, and its
 * seconds left in its `.Pad_Left`. */
export let bar = (pads: HTMLElement[]) => {
  let slots = pads.map((b) => ({
    b,
    icon: b.querySelector<HTMLElement>('.Pad_Icon'),
    left: b.querySelector<HTMLElement>('.Pad_Left'),
    was: '',
    id: '',
    cd: 0,
  }))

  return {
    show: (f: Frame) => {
      for (let [i, sl] of slots.entries()) {
        let s = slotOf(f, i)
        let doing = !!s.id && f.doing == s.id
        let key = JSON.stringify([s, doing])
        if (key == sl.was) continue
        sl.was = key
        if (sl.icon) sl.icon.innerHTML = s.icon ? glyph(s.icon) : ''
        sl.b.title = s.says
        sl.b.setAttribute('aria-label', s.says)
        sl.b.style.setProperty('--cd', String(s.cd))
        if (sl.left) sl.left.textContent = s.s ? String(s.s) : ''
        sl.b.classList.toggle('Pad-none', !!i && !s.icon)
        sl.b.classList.toggle('Pad-doing', doing)
        sl.b.classList.toggle('Pad-strong', s.strong)
        // Ready again: a flash.
        if (sl.cd > 0 && !s.cd && s.id == sl.id) {
          sl.b.classList.remove('Pad-ready')
          void sl.b.offsetWidth
          sl.b.classList.add('Pad-ready')
        }
        sl.id = s.id
        sl.cd = s.cd
      }
    },
  }
}
