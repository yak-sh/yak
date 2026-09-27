// The action bar: the hero's strike and the three abilities what they carry
// gives them (abilities.ts), each on its key, F, 1, 2 and 3, painted on the
// glass's pads (hud.ts), which on a phone sit under the right thumb about the
// strike. What is left of an ability's cooldown is swept over it, with the
// seconds, and it flashes when it is ready again; one a skill made stronger
// (skills.ts) wears a star. A slot nothing fills is not shown. Each one's tip
// (tip.ts) says what it does with the numbers the hero's gear and skills
// make: an ability's name, cooldown and what it does, and the strike's blow.
// Each slot is written only when what it shows changed.
import { does, secs } from './abilities.ts'
import { HANDLES } from './arms.ts'
import { type Glyph, glyph } from './glyphs.ts'
import { type Action, keysOf } from './input.ts'
import { cap } from './panel.ts'
import type { Frame } from './play.ts'
import { blowOf } from './rules.ts'
import { formOf, SKILLS } from './skills.ts'
import { type Tip, tip } from './tip.ts'

// Each slot's action, and the key it shows.
let ACTS: Action[] = ['strike', 'ability1', 'ability2', 'ability3']
let keyOf = (i: number) => cap(keysOf(ACTS[i])[0])

// What a slot shows: its glyph, its tip, and what is left of its cooldown,
// 0 to 1, and in whole seconds.
type Slot = {
  id: string
  icon: Glyph | ''
  tip: Tip
  cd: number
  s: number
  strong: boolean
}
let slotOf = (f: Frame, i: number): Slot => {
  let { kit: k, lvl, max, learned } = f.sheet
  let blow = blowOf(lvl, k)
  if (!i) {
    let h = HANDLES[k.family], pace = (k.pace / 1000).toFixed(2)
    return {
      id: '',
      icon: '',
      tip: {
        name: 'Strike',
        key: keyOf(i),
        note: k.twin
          ? `Two ${h.name.toLowerCase()}s, a hand at a time, a blow every ${pace} s`
          : `${h.name}, a blow every ${pace} s`,
        says: `${Math.round(blow)} damage a blow${
          k.twin
            ? `, and ${Math.round(blowOf(lvl, k, k.twin))} with the other hand`
            : ''
        }. A click or a tap on the world strikes too.`,
      },
      cd: 0,
      s: 0,
      strong: false,
    }
  }
  let id = f.sheet.abilities[i - 1] ?? ''
  let a = formOf(id, learned)
  if (!a) return { id, icon: '', tip: { name: '' }, cd: 0, s: 0, strong: false }
  let left = f.cool[id] ?? 0
  let by = learned.filter((k) => SKILLS[k].ability == id)
    .map((k) => SKILLS[k].name)
  return {
    id,
    icon: a.icon,
    tip: {
      name: a.name,
      key: keyOf(i),
      note: `${secs(a.cool)} cooldown`,
      says: `${does(a, { blow, max })}${
        by.length ? ` Made stronger by ${by.join(' and ')}.` : ''
      }`,
    },
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
        tip(sl.b, s.tip)
        sl.b.style.setProperty('--cd', String(s.cd))
        if (sl.left) sl.left.textContent = s.s ? String(s.s) : ''
        sl.b.classList.toggle('Pad-none', !!i && !s.icon)
        sl.b.classList.toggle('Pad-doing', doing)
        sl.b.classList.toggle('Pad-strong', s.strong)
        // Ready again: a flash.
        if (sl.cd > 0 && !s.cd && s.id == sl.id) {
          sl.b.animate([
            { scale: '1' },
            { scale: '1.12', backgroundColor: '#fff4c8', offset: 0.3 },
            { scale: '1' },
          ], { duration: 500, easing: 'ease-out' })
        }
        sl.id = s.id
        sl.cd = s.cd
      }
    },
  }
}
