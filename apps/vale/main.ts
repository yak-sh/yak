// Mossvale, a little voxel RPG that whoever is here plays together. This is
// the page: it grows the level the hero is in, opens the store, asks who you
// are and which of your heroes to play, and then runs the frame: the player's
// hands (input.ts), a step of the game on the graph (play.ts), the stage
// (cast.ts), the bits and numbers (fx.ts) and the glass (hud.ts). When the
// hero walks through a portal, the page grows the level beyond and carries on
// there.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { BEASTS } from './beasts.ts'
import { aim, type Cam, steer } from './cam.ts'
import { cast } from './cast.ts'
import { type Figure, hero } from './figures.ts'
import { bits, type Kind, overlay } from './fx.ts'
import { hud } from './hud.ts'
import { listen } from './input.ts'
import { ITEMS } from './items.ts'
import { HOME, LEVELS } from './levels.ts'
import { comp, connect, type Hero, type Me, str } from './net.ts'
import { type Event, type Frame, game } from './play.ts'
import { sound } from './sound.ts'
import { groundAt, SIZE, type Vale, vale, VOXEL } from './terrain.ts'
import { type World, world } from './world.ts'

let TINTS = [
  '#c9503f',
  '#e08a3c',
  '#e7c14e',
  '#5f9f4a',
  '#3f86b8',
  '#7a5cb8',
  '#d46a9a',
  '#4a5a6a',
]
let HAIRS = [
  '#3b2a20',
  '#6b4428',
  '#b8742f',
  '#e2c16b',
  '#d9d4c8',
  '#2c2f3a',
  '#a2462f',
]
let SKINS = ['#f3cfb3', '#e7b996', '#c98f68', '#9a6444', '#6b432c']
let NAMES = [
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
// The voxel edge the vale is grown at, in metres: `?voxel=0.25` grows it
// finer, to compare. Any edge that divides the vale's side will do.
let asked = Number(new URLSearchParams(location.search).get('voxel'))
let VOX = asked >= 0.125 && asked <= 2 && Number.isInteger(SIZE / asked)
  ? asked
  : VOXEL

let pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
let frame = () => new Promise(requestAnimationFrame)

let canvas = document.querySelector<HTMLCanvasElement>('.Stage')!
let gate = document.querySelector<HTMLElement>('.Gate')!
let gateCard = gate.querySelector<HTMLElement>('.Gate_Card')!
let glass = document.querySelector<HTMLElement>('.Hud')!

let phone = matchMedia('(pointer: coarse)').matches
let renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setPixelRatio(Math.min(devicePixelRatio, phone ? 1.6 : 2))
renderer.setSize(innerWidth, innerHeight, false)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
let camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500)
let fit = () => {
  renderer.setSize(innerWidth, innerHeight, false)
  camera.aspect = innerWidth / innerHeight
  camera.fov = innerWidth < innerHeight ? 68 : 55
  camera.updateProjectionMatrix()
}
fit()
addEventListener('resize', fit)

// The gate paints before the level grows, which takes a moment.
await frame()
await frame()
let net = connect(new URL('api/', document.baseURI))
let g = game(net)

let typing = false
let hands = listen(canvas, glass, () => typing || h.talking)
let h = hud(glass, hands.press)
let marks = overlay(h.layer, camera)

// The level on show, and what is drawn of it: grown again when the hero goes
// through a portal.
let v: Vale = vale(HOME, VOX)
let w: World = world(v)
let stage = cast(w.scene, v, marks)
let dust = bits(w.scene, true, 400)
let glow = bits(w.scene, false, 300)
let smallShadows = phone
if (phone) w.sun.shadow.mapSize.set(1024, 1024)
let grow = (id: string) => {
  w.dispose()
  v = vale(id, VOX)
  w = world(v)
  if (smallShadows) w.sun.shadow.mapSize.set(1024, 1024)
  if (!renderer.shadowMap.enabled) w.sun.castShadow = false
  stage = cast(w.scene, v, marks)
  dust = bits(w.scene, true, 400)
  glow = bits(w.scene, false, 300)
  // Arriving: the camera starts behind the hero, wherever they came in.
  cam.x = NaN
  cam.snap = true
}

// The camera (cam.ts), following the hero unless this viewer set it free.
let freed = false
try {
  freed = localStorage.getItem('mossvale.cam') == 'free'
} catch { /* a page without storage starts following */ }
let cam: Cam = {
  yaw: 0,
  pitch: 0.42,
  dist: phone ? 11 : 9.5,
  reach: 9,
  x: NaN,
  y: 0,
  z: 0,
  shake: 0,
  follow: !freed,
  snap: false,
  idle: 0,
}
let target = new THREE.Vector3()

let mute = document.createElement('button')
mute.className = 'Mute'
let muteLabel = () => mute.textContent = sound.muted ? '🔇' : '🔊'
muteLabel()
mute.addEventListener('click', () => {
  sound.toggle()
  muteLabel()
})
let eye = document.createElement('button')
eye.className = 'Mute Mute-eye'
eye.textContent = '🎥'
let eyeLabel = () => {
  eye.classList.toggle('Mute-off', !cam.follow)
  eye.title = cam.follow
    ? 'The camera follows you (V). C swings it behind you.'
    : 'The camera stays where you turn it (V). C swings it behind you.'
}
eyeLabel()
eye.addEventListener('click', () => hands.press('follow'))
glass.append(mute, eye)

// Where the hearth is, or the middle of a level without one: where the gate's
// camera looks, and embers rise.
let hearth = () => v.hearth ?? v.places[v.level.arrive] ?? [64, 64]

// Who is playing: one of your heroes, or a new one made at the gate.
let look = { name: '', tint: pick(TINTS), hair: pick(HAIRS), skin: pick(SKINS) }
let playing = false
let preview: Figure | null = null
let dress = () => {
  if (preview) w.scene.remove(preview.root)
  preview = hero(look)
  let [hx, hz] = hearth()
  let x = hx, z = hz + 4
  preview.root.position.set(x, groundAt(v, x, z), z)
  preview.root.rotation.y = 0.5
  w.scene.add(preview.root)
}

let begin = (eid: string) => {
  net.choose(eid)
  if (preview) w.scene.remove(preview.root)
  preview = null
  playing = true
  cam.yaw = 0
  cam.pitch = innerWidth < innerHeight ? 0.6 : 0.42
  cam.dist = phone ? 11 : 9.5
  gate.remove()
  glass.hidden = false
  canvas.focus()
}

let swatches = (key: 'tint' | 'hair' | 'skin', colors: string[]) =>
  `<div class=Make_Row data-k=${key}>${
    colors.map((c) =>
      `<button type=button class="Swatch${
        c == look[key] ? ' Swatch-on' : ''
      }" style="--c:${c}" data-c="${c}" aria-label="${c}"></button>`
    ).join('')
  }</div>`

let TITLE = '<h1 class=Gate_Title>Mossvale</h1>'
let NOTE =
  '<p class=Gate_Note>Slimes in the meadow, boars in Whisperwood, walking stones in Craghollow, and something old on Thornback Ridge.</p>'

// Make a hero. A guest is offered the sign-in that keeps heroes; one who may
// not write here is sent to it.
let make = (who: Me, back: (() => void) | null) => {
  look.name ||= pick(NAMES)
  let guest = !who.person && who.signIn
  gateCard.innerHTML = `${TITLE}
    <p class=Gate_Lede>A little vale of moss and stone. Whoever else is here walks it with you.</p>
    <form class=Make>
      <label class=Make_Name>Your name
        <input name=name maxlength=18 autocomplete=off value="${
    esc(look.name)
  }" required></label>
      <span class=Make_Label>Tunic</span>${swatches('tint', TINTS)}
      <span class=Make_Label>Hair</span>${swatches('hair', HAIRS)}
      <span class=Make_Label>Skin</span>${swatches('skin', SKINS)}
      ${
    who.writes
      ? '<button class="Btn Btn-go">Enter the vale</button>'
      : `<a class="Btn Btn-go" href="${
        esc(who.signIn ?? '')
      }">Sign in to play</a>`
  }
      ${back ? '<button type=button class=Btn data-do=back>Back</button>' : ''}
    </form>
    ${
    guest && who.writes
      ? `<p class=Gate_Note><a href="${
        esc(who.signIn ?? '')
      }">Sign in</a> to keep your heroes on every device. A hero made without signing in lasts as long as this tab.</p>`
      : NOTE
  }`
  let form = gateCard.querySelector<HTMLFormElement>('.Make')!
  let name = form.querySelector<HTMLInputElement>('input')!
  name.addEventListener('focus', () => typing = true)
  name.addEventListener('blur', () => typing = false)
  form.querySelectorAll<HTMLElement>('.Make_Row').forEach((row) =>
    row.addEventListener('click', (e) => {
      let b = e.target
      if (!(b instanceof HTMLElement) || !b.dataset.c) return
      let k = row.dataset.k
      if (k == 'tint' || k == 'hair' || k == 'skin') look[k] = b.dataset.c
      row.querySelectorAll('.Swatch').forEach((s) =>
        s.classList.toggle('Swatch-on', s == b)
      )
      dress()
    })
  )
  form.querySelector('[data-do=back]')?.addEventListener(
    'click',
    () => back?.(),
  )
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    look.name = name.value.trim().slice(0, 18) || pick(NAMES)
    typing = false
    begin(net.create(look))
    h.toast(`Welcome to Mossvale, ${look.name}.`, 'Toast-big')
  })
  dress()
}

// Choose one of your heroes, or make another.
let choose = (who: Me, heroes: Hero[]) => {
  gateCard.innerHTML = `${TITLE}
    <p class=Gate_Lede>Welcome back${
    who.name ? `, ${esc(who.name.split(/\s/)[0])}` : ''
  }. Who walks the vale today?</p>
    <div class=Heroes>${
    heroes.map((o) =>
      `<button class=Hero data-eid="${esc(o.eid)}" style="--tint:${
        esc(o.tint)
      };--hair:${esc(o.hair)};--skin:${
        esc(o.skin)
      }"><i class=Hero_Face></i><b>${esc(o.name)}</b></button>`
    ).join('')
  }</div>
    <button class=Btn data-do=new>A new hero</button>
    ${NOTE}`
  gateCard.querySelectorAll<HTMLElement>('.Hero').forEach((b) =>
    b.addEventListener('click', () => {
      let o = heroes.find((x) => x.eid == b.dataset.eid)
      if (!o) return
      begin(o.eid)
      h.toast(`Welcome back, ${o.name}.`, 'Toast-big')
    })
  )
  gateCard.querySelector('[data-do=new]')?.addEventListener(
    'click',
    () => make(who, () => choose(who, heroes)),
  )
}

let clockOf = (d: number) =>
  d < 0.22 || d > 0.8
    ? '🌙 Night'
    : d < 0.3
    ? '🌅 Dawn'
    : d < 0.7
    ? '☀️ Day'
    : '🌇 Dusk'

let react = (e: Event, heroAt: THREE.Vector3) => {
  let p = (a: [number, number, number]) => new THREE.Vector3(...a)
  let float = (text: string, at: THREE.Vector3, kind: Kind) =>
    marks.float(text, at, kind)
  if (e.type == 'hit') {
    float(String(e.dmg), p(e.at), e.great ? 'great' : 'hit')
    let m = stage.headOf(e.eid)
    dust.emit(
      m ?? p(e.at),
      BEASTS[e.beast]?.dust ?? 0xd8c8a8,
      e.great ? 14 : 7,
      {
        speed: 3.5,
        up: 3,
      },
    )
    sound.hit(e.great)
    cam.shake = Math.max(cam.shake, e.great ? 0.22 : 0.08)
  } else if (e.type == 'struck') float(String(e.dmg), p(e.at), 'ally')
  else if (e.type == 'whiff') sound.whiff()
  else if (e.type == 'roll') {
    dust.emit(p(e.at), 0xc9b896, 6, {
      speed: 1.4,
      up: 1,
      life: 0.5,
      size: 0.12,
    })
    sound.roll()
  } else if (e.type == 'dodge') {
    float('Dodged!', p(e.at), 'dodge')
    sound.dodge()
  } else if (e.type == 'hurt') {
    float(`-${e.dmg}`, p(e.at), 'hurt')
    sound.hurt()
    cam.shake = Math.max(cam.shake, 0.18)
  } else if (e.type == 'fall') {
    dust.emit(p(e.at), BEASTS[e.beast]?.dust ?? 0xaaaaaa, 22, {
      speed: 4,
      up: 4,
      life: 0.9,
      size: 0.16,
    })
    sound.fall()
  } else if (e.type == 'xp') float(`+${e.n} xp`, p(e.at), 'xp')
  else if (e.type == 'loot') {
    let t = ITEMS[e.item]
    h.toast(
      `${t?.icon ?? ''} ${t?.name ?? e.item}${e.n > 1 ? ` ×${e.n}` : ''}`,
      'Toast-loot',
    )
    glow.emit(p(e.at), 0xffe08a, 8, {
      speed: 1.5,
      up: 2,
      life: 0.6,
      size: 0.07,
      fall: 2,
    })
    sound.pick()
  } else if (e.type == 'level') {
    h.toast(`Level ${e.lvl}! You feel stronger.`, 'Toast-big')
    glow.emit(heroAt, 0xffd45a, 40, {
      speed: 3,
      up: 3,
      life: 1.2,
      size: 0.09,
      fall: 1,
    })
    sound.level()
  } else if (e.type == 'heal') {
    float(`+${e.n}`, p(e.at), 'heal')
    glow.emit(heroAt, 0x8ff07a, 16, {
      speed: 1,
      up: 2.5,
      life: 0.9,
      size: 0.07,
      fall: -1,
    })
    sound.heal()
  } else if (e.type == 'faint') sound.fall()
  else if (e.type == 'rise') h.toast('Back on your feet, by the fire.')
  else if (e.type == 'travel') {
    h.toast(`${LEVELS[e.to]?.name ?? e.to}`, 'Toast-big')
    sound.quest()
  } else if (e.type == 'say') h.toast(e.text)
}

let talkTo = () => {
  let giver = last?.talk
  if (!giver) return
  let next = giver.next
  h.talk(
    {
      quest: next?.quest ?? null,
      state: next?.state ?? 'done',
      have: next?.have ?? 0,
      greets: giver.greets,
      name: giver.name,
    },
    () => {
      if (!next) return
      g.accept(next.quest)
      h.toast(`Quest taken: ${next.quest.title}`, 'Toast-big')
      sound.quest()
    },
    () => {
      if (!next) return
      for (let e of g.handIn(next.quest)) react(e, target)
      sound.quest()
    },
  )
}

let last: Frame | null = null
let then = performance.now()
// The page keeps up with the screen before it keeps its looks: while frames
// run slow it draws fewer pixels, then plainer shadows, then none.
let EASE = [
  () => renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)),
  () => renderer.setPixelRatio(1),
  () => {
    smallShadows = true
    w.sun.shadow.mapSize.set(1024, 1024)
    w.sun.shadow.map?.dispose()
    w.sun.shadow.map = null
  },
  () => renderer.setPixelRatio(0.75),
  () => {
    renderer.shadowMap.enabled = false
    w.sun.castShadow = false
    w.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material.needsUpdate = true
    })
  },
]
let paced = { t: 0, n: 0, eased: 0 }
let keepUp = (spent: number) => {
  paced.t += spent
  paced.n++
  if (paced.t < 3) return
  if (paced.t / paced.n > 1 / 45 && paced.eased < EASE.length) {
    EASE[paced.eased++]()
    fit()
  }
  paced.t = paced.n = 0
}

let loop = (t: number) => {
  requestAnimationFrame(loop)
  let dt = Math.min(0.05, (t - then) / 1000)
  keepUp((t - then) / 1000)
  then = t
  let now = net.now()
  w.tick(now / 1000, dt)
  if (playing && net.hero) {
    let i = hands.read()
    if (h.talking) {
      Object.assign(i, {
        move: [0, 0],
        strike: false,
        dodge: false,
        jump: false,
      })
    }
    let following = cam.follow
    steer(cam, i, last?.body.yaw ?? cam.yaw + Math.PI, dt)
    if (cam.follow != following) {
      eyeLabel()
      try {
        localStorage.setItem('mossvale.cam', cam.follow ? 'follow' : 'free')
      } catch { /* kept for this page only */ }
    }
    let f = g.frame(v, i, cam.yaw, dt)
    last = f
    if (f && f.level != v.level.id) {
      // Through a portal: the level beyond grows, and the next frame plays
      // there.
      for (let e of f.events) react(e, target)
      grow(f.level)
    } else if (f) {
      let player = comp(net.client.ent(net.hero), 'player')
      let dressed = {
        tint: str(player.tint, look.tint),
        hair: str(player.hair, look.hair),
        skin: str(player.skin, look.skin),
      }
      stage.tick(f, net.hero, dressed, dt)
      let k = 1 - Math.exp(-dt * 10)
      if (Number.isNaN(cam.x)) {
        ;[cam.x, cam.y, cam.z] = [f.body.x, f.body.y, f.body.z]
      }
      cam.x += (f.body.x - cam.x) * k
      cam.y += (f.body.y - cam.y) * (1 - Math.exp(-dt * 6))
      cam.z += (f.body.z - cam.z) * k
      target.set(cam.x, cam.y + 1, cam.z)
      for (let e of f.events) react(e, target)
      if (i.talk && f.talk) talkTo()
      if (h.talking && !f.talk) h.talk(null, () => {}, () => {})
      if (f.body.gait == 'run' && Math.random() < 0.35) {
        dust.emit(
          new THREE.Vector3(f.body.x, f.body.y + 0.05, f.body.z),
          0xc9b896,
          1,
          {
            speed: 0.7,
            up: 0.9,
            life: 0.45,
            size: 0.1,
            fall: 3,
          },
        )
      }
      let here = 1 + f.others.length
      h.show(f, here, clockOf(w.day))
      w.focus.set(f.body.x, f.body.y, f.body.z)
    }
  } else {
    // At the gate: the camera drifts around the fire, and the new hero stands
    // by it in the colours being chosen.
    let a = t / 9000
    let [hx, hz] = hearth()
    target.set(hx, groundAt(v, hx, hz) + 1.2, hz + 3)
    cam.x = target.x
    cam.y = target.y - 1.4
    cam.z = target.z
    cam.yaw = a
    cam.pitch = 0.3
    cam.dist = 9
    preview?.animate({
      speed: 0,
      air: false,
      swing: -1,
      hurt: 0,
      down: false,
      t: t / 1000,
    }, dt)
  }
  aim(cam, camera, target, v, dt)
  w.see(camera.position, target)
  // Embers off the fire, and at night fireflies about the player.
  if (v.hearth && Math.random() < 0.5) {
    let [hx, hz] = v.hearth
    glow.emit(
      new THREE.Vector3(
        hx + (Math.random() - 0.5) * 0.8,
        groundAt(v, hx, hz) + 0.9,
        hz + (Math.random() - 0.5) * 0.8,
      ),
      0xffa040,
      1,
      {
        speed: 0.3,
        up: 1.4,
        life: 1.6,
        size: 0.06,
        fall: -0.4,
      },
    )
  }
  if ((w.day < 0.24 || w.day > 0.76) && Math.random() < 0.25) {
    let a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 14
    let x = target.x + Math.cos(a) * r, z = target.z + Math.sin(a) * r
    glow.emit(
      new THREE.Vector3(x, groundAt(v, x, z) + 0.6 + Math.random() * 1.5, z),
      0xd8ff7a,
      1,
      {
        speed: 0.25,
        up: 0.15,
        life: 3.5,
        size: 0.05,
        fall: 0,
      },
    )
  }
  dust.tick(dt)
  glow.tick(dt)
  marks.tick()
  renderer.render(w.scene, camera)
}
requestAnimationFrame(loop)
// For whoever opens the console, and for a test driving the page.
Object.assign(globalThis, {
  mossvale: {
    net,
    game: g,
    get frame() {
      return last
    },
    get vale() {
      return v
    },
    get world() {
      return w
    },
    renderer,
    camera,
    cam,
  },
})

let busy = gate.querySelector('.Gate_Busy')
if (busy) busy.textContent = 'Finding the others…'
let me = await net.me()
let ready = async (watch: { ready: boolean }) => {
  for (let i = 0; i < 40 && !watch.ready; i++) {
    await new Promise((r) => setTimeout(r, 100))
  }
}
if (!me.reads) {
  gateCard.innerHTML = `${TITLE}<p class=Gate_Lede>This vale is private.</p>${
    me.signIn
      ? `<a class="Btn Btn-go" href="${esc(me.signIn)}">Sign in</a>`
      : ''
  }`
} else if (me.person) {
  // Signed in: your heroes, wherever you made them.
  look.name = me.name?.split(/\s/)[0] ?? ''
  let heroes = await net.heroes(me.person)
  let played = net.played()
  if (played && heroes.some((o) => o.eid == played)) begin(played)
  else if (heroes.length) choose(me, heroes)
  else make(me, null)
} else {
  // Signed out: the hero this tab has been playing, or a new one.
  let players = net.watches.players
  await ready(players)
  let played = net.played()
  if (
    played && me.writes && players.value.some((b) => b.entity.eid == played)
  ) {
    begin(played)
  } else make(me, null)
}
