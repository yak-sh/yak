// The action bar: the hero's strike and the three abilities what they carry
// gives them (abilities.ts), each on its key, F, 1, 2 and 3, or on a phone
// under the right thumb beside the strike button. What is left of an
// ability's cooldown is swept over it, with the seconds, and it flashes
// when it is ready again. A slot nothing fills says what would fill it. Each
// slot is written only when what it shows changed.
import { ABILITIES } from './abilities.ts'
import { HANDLES } from './arms.ts'
import type { Action } from './input.ts'
import type { Frame } from './play.ts'

let KEYS = ['F', '1', '2', '3']
let ACTS: Action[] = ['strike', 'ability1', 'ability2', 'ability3']

// What a slot shows: its icon, what it says, and what is left of its
// cooldown, 0 to 1, and in whole seconds.
let slotOf = (f: Frame, i: number) => {
  let k = f.sheet.kit
  if (!i) {
    let h = HANDLES[k.family]
    return {
      id: '',
      icon: h.icon,
      says: `${h.name}: strike (F or click)`,
      cd: 0,
      s: 0,
    }
  }
  let id = f.sheet.abilities[i - 1] ?? ''
  let a = ABILITIES[id]
  if (!a) {
    let says = i < 3
      ? 'Hold a weapon: each kind gives two abilities.'
      : k.hands == 2
      ? 'Both hands are on your weapon.'
      : 'A shield, a tome or a torch in your other hand gives one more.'
    return { id, icon: '', says, cd: 0, s: 0 }
  }
  let left = f.cool[id] ?? 0
  return {
    id,
    icon: a.icon,
    says: `${a.name} (${KEYS[i]}): ${a.says}`,
    cd: Math.round((left / a.cool) * 50) / 50,
    s: Math.ceil(left / 1000),
  }
}

/** Build the bar into `root`. `press` sends a slot's action to the game. */
export let bar = (root: HTMLElement, press: (a: Action) => void) => {
  let box = document.createElement('div')
  box.className = 'Acts'
  let slots = KEYS.map((key, i) => {
    let b = document.createElement('button')
    b.className = `Act${i ? '' : ' Act-strike'}`
    b.innerHTML =
      `<i class=Act_Icon></i><kbd class=Act_Key>${key}</kbd><b class=Act_Left></b>`
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      press(ACTS[i])
    })
    box.append(b)
    return {
      b,
      icon: b.querySelector<HTMLElement>('.Act_Icon')!,
      left: b.querySelector<HTMLElement>('.Act_Left')!,
      was: '',
      id: '',
      cd: 0,
    }
  })
  root.append(box)

  return {
    show: (f: Frame) => {
      for (let [i, sl] of slots.entries()) {
        let s = slotOf(f, i)
        let doing = !!s.id && f.doing == s.id
        let key = JSON.stringify([s, doing])
        if (key == sl.was) continue
        sl.was = key
        sl.icon.textContent = s.icon
        sl.b.title = s.says
        sl.b.setAttribute('aria-label', s.says)
        sl.b.style.setProperty('--cd', String(s.cd))
        sl.left.textContent = s.s ? String(s.s) : ''
        sl.b.classList.toggle('Act-empty', !s.icon)
        sl.b.classList.toggle('Act-doing', doing)
        // Ready again: a flash.
        if (sl.cd > 0 && !s.cd && s.id == sl.id) {
          sl.b.classList.remove('Act-ready')
          void sl.b.offsetWidth
          sl.b.classList.add('Act-ready')
        }
        sl.id = s.id
        sl.cd = s.cd
      }
    },
  }
}
