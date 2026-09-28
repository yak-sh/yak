// Mossvale, a little voxel RPG that whoever is here plays together. This is
// the page: it grows the ground round home's fire off its own thread
// (grown.ts) while it opens the store and asks who you are and which of your
// heroes to play, and then runs the frame: the player's hands (input.ts), a step of the
// game on the graph (play.ts), the work at the nodes and the stations
// (work.ts), the stage (cast.ts, nodes.ts, papers.ts), the bits and numbers
// (fx.ts), the glass (hud.ts, and its action bar, bar.ts), what was said
// (chatbox.ts) and the panels over it (map.ts, pack.ts, board.ts,
// journal.ts, station.ts, notices.ts, menu.ts, and the deals with a
// villager, dealbox.ts). The world is one ground of many regions, and the
// page draws the chunks within sight of the hero (world.ts), grown and
// meshed in the workers as they come near. A hero comes back where they were
// last seen (seen.ts).
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { ABILITIES, type Ability } from './abilities.ts'
import { bar } from './bar.ts'
import { board } from './board.ts'
import { BEASTS } from './beasts.ts'
import { aim, bearing, type Cam, depth, steer } from './cam.ts'
import { cast } from './cast.ts'
import { chatbox } from './chatbox.ts'
import { dealbox } from './dealbox.ts'
import { deals } from './deals.ts'
import { fires } from './fires.ts'
import { map } from './map.ts'
import { menu } from './menu.ts'
import { BUILD, type Figure, hero, stature } from './figures.ts'
import { bits, type Kind, overlay } from './fx.ts'
import { glyphText } from './glyphs.ts'
import { meshed, template } from './grown.ts'
import { type Clock, hud } from './hud.ts'
import { guide, journal, tasksOf } from './journal.ts'
import { pack } from './pack.ts'
import { character } from './character.ts'
import { anyLook, anyName, fields, picks } from './make.ts'
import { portrait } from './portrait.ts'
import { listen } from './input.ts'
import { nodes } from './nodes.ts'
import { type Board, noticeboard, notices } from './notices.ts'
import { papers } from './papers.ts'
import { ITEMS } from './items.ts'
import { GRADES, piece, RARITIES, type Rarity, tint } from './rarity.ts'
import type { Held } from './rules.ts'
import { HOME, LEVELS, type Spot } from './levels.ts'
import { connect, type Hero, type Me } from './net.ts'
import { type Event, type Frame, game, type Vec3 } from './play.ts'
import { recall, type Seen, sighting } from './seen.ts'
import { formOf, SKILLS } from './skills.ts'
import { within } from './solid.ts'
import { sound } from './sound.ts'
import { icon } from './sprites.ts'
import { station } from './station.ts'
import { voices } from './voicebox.ts'
import { COARSER } from './stream.ts'
import {
  CHUNK,
  groundAt,
  hearthNear,
  hearthOf,
  vale,
  VOXEL,
} from './terrain.ts'
import { ledger, TRADES } from './trades.ts'
import { world } from './world.ts'
import { village } from './village.ts'
import { arriveOf } from './ways.ts'
import { type Job, type Work, working } from './work.ts'

// The voxel edge the ground is grown at, in metres: `?voxel=0.125` grows it
// finer, to compare. Any edge that divides a chunk's side will do.
let asked = Number(new URLSearchParams(location.search).get('voxel'))
let VOX = asked >= 0.125 && asked <= 2 && Number.isInteger(CHUNK / asked)
  ? asked
  : VOXEL
// The ground the page walks on, as the workers grow it and the page keeps it.
let v = vale(VOX)

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

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
// Its depth fits each level's fog as the level is shown (cam.ts `depth`).
let camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight)
let fit = () => {
  renderer.setSize(innerWidth, innerHeight, false)
  camera.aspect = innerWidth / innerHeight
  camera.fov = innerWidth < innerHeight ? 68 : 55
  camera.updateProjectionMatrix()
}
fit()
addEventListener('resize', fit)

let net = connect(new URL('api/', document.baseURI))
let deal = deals(net)
let folk = village(net, deal)
let seen = sighting(net)
let camp = fires(net)
let g = game(net, folk.at)
let toil = working(net)
// Who you are and your heroes, asked while the level grows.
let asking = net.me().then(async (me) => ({
  me,
  heroes: me.person ? await net.heroes(me.person) : [],
}))

let typing = false
// The keyboard is someone else's while a name or a line is written, or while
// someone is talked to.
let elsewhere = () => typing || h.talking || chat.typing
let hands = listen(canvas, glass, elsewhere)
let h = hud(glass, hands.press, elsewhere)
let marks = overlay(h.layer, camera, h.under)
let chat = chatbox(glass, h.orbs.chat, net, marks, folk)
let m = map(h.panels.map, (to) => g.travel(to, camp.known()))
let p = pack(h.panels.bag, { wear: g.wear, take: g.take })
let you = character(h.panels.character, {
  restyle: (l) => {
    net.restyle(l)
    h.toast('Your new look is kept.')
  },
  typing: (on) => typing = on,
  paint: portrait(renderer, BUILD),
})
let bench = station(h.panels.craft, {
  make: toil.make,
  upgrade: toil.upgrade,
})
let actions = bar(h.acts)
let skills = board(h.panels.skills, {
  learn: (id) => {
    g.learn(id)
    h.toast(`${SKILLS[id].name} learned`, 'Toast-loot')
    sound.quest()
  },
  respec: () => {
    g.respec()
    h.toast('Every skill forgotten. Spend the points again.')
  },
})
let log = journal(h.panels.journal, { pin: g.pin })
let trades = ledger(h.panels.trades)
// A quest taken from a notice board is pinned while it is on offer, so the
// way to whoever gives it is tracked; a villager's job is agreed to.
let notes = noticeboard(h.panels.notices, {
  take: (n) => {
    let said = n.job
      ? deal.agree(n.job.giver.id, n.job.eid)
      : (g.pin(n.id, true), `Tracked: ${n.title}. Find ${n.from}.`)
    if (!said) return
    h.toast(said, 'Toast-big')
    sound.quest()
  },
})
// What the hero chose about a deal with a villager.
let dealt = dealbox(h.panels.deal, (a, v) => {
  if (a == 'refuse') return deal.refuse(v.giver.id, v.eid)
  let s = last?.sheet
  let said = a == 'agree'
    ? deal.agree(v.giver.id, v.eid)
    : s
    ? deal.hand(v.giver.id, v.eid, s)
    : null
  if (!said) return
  h.toast(said, a == 'hand' ? 'Toast-loot' : 'Toast-big')
  sound.quest()
})

// What is drawn of the world: its chunks grown and meshed in the workers at
// the detail asked (stream.ts `COARSER`).
let w = world(
  v,
  {
    chunk: (ci, ck, lod) => meshed(VOX * COARSER[lod], ci, ck, lod == 0),
    template,
  },
)
depth(camera, w.fog)
// Where the hearth is by which the page first looks, and a new hero first
// stands: home's fire.
let hearth = (): Spot => hearthOf(HOME) ?? arriveOf(HOME)
{
  let [x, z] = hearth()
  w.focus.set(x, groundAt(v, x, z), z)
  await w.near()
}
let stage = cast(w.scene, v, marks, BUILD)
let dust = bits(w.scene, true, 400)
let glow = bits(w.scene, false, 300)
let bounty = nodes(w.scene, v, marks, glow, phone)
let pins = papers(w.scene, v, marks, phone)
if (phone) w.sun.shadow.mapSize.set(1024, 1024)

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
  lift: 0,
}
let target = new THREE.Vector3()
// Where the hero stands, as the camera follows them.
let feet = new THREE.Vector3()

// The microphone (voicebox.ts): off until the player turns it on, from the
// tray's button, whose tap the browser may ask the player about.
let voice = voices(net, h.mic)
h.orbs.mic.addEventListener('click', () => void voice.toggle())
// The menu: the vale's sound, and whether the camera follows.
let settings = menu(h.panels.menu, {
  muted: () => sound.muted,
  mute: () => sound.toggle(),
  music: sound.music,
  follows: () => cam.follow,
  follow: () => hands.press('follow'),
  swapped: hands.swapped,
  swap: hands.swap,
  strafes: hands.strafes,
  strafe: hands.strafe,
})

// Who is playing: one of your heroes, or a new one made at the gate.
let look = anyLook()
let lookOf = (eid: string) => {
  let mine = net.who(eid) ?? look
  return { tint: mine.tint, hair: mine.hair, skin: mine.skin }
}
let playing = false
let starting = false
let preview: Figure | null = null
let posed = ''
let dress = () => {
  let colours = [look.tint, look.hair, look.skin].join()
  if (preview && posed == colours) return
  posed = colours
  if (preview) w.scene.remove(preview.root)
  preview = hero(BUILD, look)
  let [hx, hz] = hearth()
  let x = hx, z = hz + 4
  preview.root.position.set(x, groundAt(v, x, z), z)
  preview.root.rotation.y = 0.5
  w.scene.add(preview.root)
}

// Play a hero: back where they were last seen, by this tab or the store
// (`stored`), or a new one at Mossvale's fire.
let begin = async (eid: string, stored: Seen | null = null) => {
  if (starting) return
  starting = true
  try {
    net.choose(eid)
    let back = recall(eid, stored)
    if (back) g.resume(back)
    stage.prepare(eid, lookOf(eid), g.sheet())
    await renderer.compileAsync(w.scene, camera)
    if (preview) w.scene.remove(preview.root)
    preview = null
    playing = true
    cam.yaw = 0
    cam.pitch = innerWidth < innerHeight ? 0.6 : 0.42
    cam.dist = phone ? 11 : 9.5
    // The camera starts behind the hero, wherever they stand.
    cam.x = NaN
    cam.snap = true
    gate.remove()
    glass.hidden = false
    canvas.focus()
  } catch (e) {
    reportError(e)
  } finally {
    starting = false
  }
}

let TITLE = '<h1 class=Gate_Title>Mossvale</h1>'
let NOTE =
  '<p class=Gate_Note>Slimes in the meadow, boars in Whisperwood, walking stones in Craghollow, and something old on Thornback Ridge.</p>'

// Make a hero. A guest is offered the sign-in that keeps heroes; one who may
// not write here is sent to it.
let make = (who: Me, back: (() => void) | null) => {
  look.name ||= anyName()
  let guest = !who.person && who.signIn
  gateCard.innerHTML = `${TITLE}
    <p class=Gate_Lede>A little vale of moss and stone. Whoever else is here walks it with you.</p>
    <form class=Make>${fields(look)}
      ${
    who.writes
      ? '<button class="Btn Btn-go Btn-big">Enter the vale</button>'
      : `<a class="Btn Btn-go Btn-big" href="${
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
  picks(form, look, dress, (on) => typing = on)
  form.querySelector('[data-do=back]')?.addEventListener(
    'click',
    () => back?.(),
  )
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    look.name ||= anyName()
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
    <div class=Gate_Heroes>${
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
      begin(o.eid, o.seen)
      h.toast(`Welcome back, ${o.name}.`, 'Toast-big')
    })
  )
  gateCard.querySelector('[data-do=new]')?.addEventListener(
    'click',
    () => make(who, () => choose(who, heroes)),
  )
}

let clockOf = (d: number): Clock =>
  d < 0.22 || d > 0.8 ? 'night' : d < 0.3 ? 'dawn' : d < 0.7 ? 'day' : 'dusk'

// An ability's shape drawn in dust and light where it is done: a sweep
// before the hero, a ring about them, a flare for what they do to
// themselves, a puff where a dash sets off.
let flourish = (a: Ability, at: THREE.Vector3, yaw: number) => {
  let spot = (ang: number, r: number) =>
    new THREE.Vector3(
      at.x + Math.sin(ang) * r,
      at.y + 0.6,
      at.z + Math.cos(ang) * r,
    )
  let tint = a.tint ?? 0xf4ecd8
  if (a.shape == 'arc') {
    for (let i = -4; i <= 4; i++) {
      dust.emit(
        spot(yaw + (i / 4) * (a.arc ?? 1.2), 1.6 + (a.far ?? 0)),
        tint,
        2,
        {
          speed: 1.2,
          up: 1,
          life: 0.4,
          size: 0.1,
        },
      )
    }
  }
  if (a.shape == 'ring') ring(at, a.far ?? 2, tint)
  if (a.shape == 'self') {
    glow.emit(at.clone().setY(at.y + 1), tint, 26, {
      speed: 1.6,
      up: 1.5,
      life: 0.8,
      size: 0.08,
      fall: -0.5,
    })
  }
  if (a.dash) {
    dust.emit(at.clone().setY(at.y + 0.2), tint, 10, {
      speed: 2,
      up: 1,
      life: 0.4,
      size: 0.12,
    })
  }
}
// Dust thrown up in a ring `r` about `at`.
let ring = (at: THREE.Vector3, r: number, tint: number) => {
  for (let i = 0; i < 18; i++) {
    let a = (i / 18) * Math.PI * 2
    dust.emit(
      new THREE.Vector3(
        at.x + Math.sin(a) * r,
        at.y + 0.3,
        at.z + Math.cos(a) * r,
      ),
      tint,
      2,
      { speed: 1.5, up: 2, life: 0.5, size: 0.12 },
    )
  }
}
// Abilities of mine landing over a place, once their shots get there.
let bursts: { at: THREE.Vector3; r: number; tint: number; when: number }[] = []

// A thing come into the bag, found or made: its toast, named and coloured as
// it rolled (rarity.ts), and the finer it is, the bigger the moment.
let got = (held: Held, at: THREE.Vector3) => {
  let t = piece(held), r = t.rarity
  let legend = r == 'legendary'
  h.toast(
    `${legend ? 'Legendary! ' : ''}${t.name}${held.n > 1 ? ` ×${held.n}` : ''}`,
    `Toast-loot ${tint(r)}${legend ? ' Toast-legend' : ''}`,
    icon(held.kind),
  )
  glow.emit(at, GRADES[r].light, legend ? 40 : 8, {
    speed: legend ? 3 : 1.5,
    up: legend ? 4 : 2,
    life: legend ? 1.2 : 0.6,
    size: legend ? 0.1 : 0.07,
    fall: 2,
  })
  if (r == 'epic' || legend) sound.spoil(null, 'epic')
  else sound.pick([at.x, at.y, at.z])
}

// A piece finer than common falling to the ground: it lights up and rings
// out, and a legendary shakes the ground, bursts, and says so.
let spoiled = (r: Rarity, at: THREE.Vector3) => {
  sound.spoil([at.x, at.y, at.z], r)
  if (RARITIES.indexOf(r) < RARITIES.indexOf('epic')) return
  let legend = r == 'legendary'
  glow.emit(at.clone().setY(at.y + 0.5), GRADES[r].light, legend ? 60 : 24, {
    speed: legend ? 5 : 3,
    up: legend ? 6 : 3,
    life: legend ? 1.6 : 1,
    size: legend ? 0.14 : 0.09,
    fall: 2,
  })
  if (legend) {
    for (let y = 0; y < 8; y += 0.5) {
      glow.emit(at.clone().setY(at.y + y), GRADES[r].light, 2, {
        speed: 0.3,
        up: 1.5,
        life: 1.8,
        size: 0.12,
        fall: -1,
      })
    }
    cam.shake = Math.max(cam.shake, 0.3)
    h.toast(
      `Something ${GRADES[r].name.toLowerCase()} fell!`,
      `Toast-loot ${tint(r)} Toast-legend`,
    )
  }
}

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
    sound.hit(e.eid, e.great)
    cam.shake = Math.max(cam.shake, e.great ? 0.22 : 0.08)
  } else if (e.type == 'struck') {
    float(String(e.dmg), p(e.at), 'ally')
    sound.struck(e.eid)
  } else if (e.type == 'whiff') sound.whiff(net.hero)
  else if (e.type == 'roll') {
    dust.emit(p(e.at), 0xc9b896, 6, {
      speed: 1.4,
      up: 1,
      life: 0.5,
      size: 0.12,
    })
    sound.roll(net.hero)
  } else if (e.type == 'dodge') {
    float('Dodged!', p(e.at), 'dodge')
    sound.dodge(net.hero)
  } else if (e.type == 'hurt') {
    float(`-${e.dmg}`, p(e.at), 'hurt')
    sound.hurt(net.hero)
    cam.shake = Math.max(cam.shake, 0.18)
  } else if (e.type == 'fall') {
    dust.emit(p(e.at), BEASTS[e.beast]?.dust ?? 0xaaaaaa, 22, {
      speed: 4,
      up: 4,
      life: 0.9,
      size: 0.16,
    })
    sound.fall(e.eid)
  } else if (e.type == 'xp') float(`+${e.n} xp`, p(e.at), 'xp')
  else if (e.type == 'loot') {
    got({ eid: e.piece, kind: e.item, n: e.n, rarity: e.rarity }, p(e.at))
  } else if (e.type == 'spoil') spoiled(e.rarity, p(e.at))
  else if (e.type == 'level') {
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
    sound.heal(net.hero)
  } else if (e.type == 'faint') sound.fall(net.hero)
  else if (e.type == 'rise') h.toast('Back on your feet, by the fire.')
  else if (e.type == 'travel') {
    h.toast(`${LEVELS[e.to]?.name ?? e.to}`, 'Toast-big')
    sound.quest()
  } else if (e.type == 'say') h.toast(e.text)
  else if (e.type == 'wear') {
    let t = ITEMS[e.item]
    if (t) {
      h.toast(
        `${t.slot == 'main' || t.slot == 'off' ? 'In hand' : 'On'}: ${
          piece({ eid: e.piece, kind: e.item, rarity: e.rarity }).name
        }`,
        `Toast-loot ${tint(e.rarity)}`,
        icon(e.item),
      )
    }
  } else if (e.type == 'shot') {
    stage.fly(e.kind, e.from, e.to, e.ms)
    sound.whiff(net.hero)
  } else if (e.type == 'ability') {
    // Mine as my skills make it; the others' as the row has it.
    let mine = e.by == net.hero
    let a = (mine && last ? formOf(e.id, last.sheet.learned) : undefined) ??
      ABILITIES[e.id]
    if (!mine) stage.doing(e.by, e.id)
    let foot = p(e.at)
    float(a.name, foot.clone().setY(foot.y + 2.5), 'ability')
    flourish(a, foot, e.yaw)
    if (a.shape == 'self') sound.heal(e.by)
    else sound.whiff(e.by)
  } else if (e.type == 'burst') {
    bursts.push({
      at: p(e.at),
      r: e.r,
      tint: ABILITIES[e.id]?.tint ?? 0xf4ecd8,
      when: performance.now() + e.ms,
    })
  } else if (e.type == 'held') float('Held!', p(e.at), 'dodge')
  else if (e.type == 'block') {
    float('Blocked!', p(e.at), 'dodge')
    sound.dodge(net.hero)
    glow.emit(heroAt, 0xffe08a, 12, { speed: 2, up: 1, life: 0.4, size: 0.07 })
  } else if (e.type == 'ward') float(`Warded ${e.n}`, p(e.at), 'ward')
}

// What the work at a node or a station did: chips flying at each stroke, and
// what it gave or made flying to the hero with the xp it was to their trade;
// and a station worked opens its sheet, or folds it away.
let worked = (e: Work) => {
  let v3 = (a: Vec3, up: number) => new THREE.Vector3(a[0], a[1] + up, a[2])
  if (e.type == 'stroke') {
    let wet = e.trade == 'fish' || e.trade == 'cauldron'
    let up = e.trade == 'fish' ? 0.05 : e.trade == 'cauldron' ? 1 : 0.6
    dust.emit(v3(e.at, up), e.chip, 6, {
      speed: wet ? 1.2 : 2,
      up: wet ? 3 : 2.5,
      life: 0.5,
      size: 0.08,
    })
    sound.stroke(e.at, e.trade)
    if (!wet) cam.shake = Math.max(cam.shake, 0.04)
  } else if (e.type == 'station') {
    if (bench.at == e.craft) bench.close()
    else if (job) bench.open(e.craft, job.trades)
  } else if (e.type == 'board') notes.toggle()
  else if (e.type == 'got') {
    got(
      { eid: e.piece ?? '', kind: e.item, n: e.n, rarity: e.rarity },
      target.clone().setY(target.y + 1),
    )
    marks.float(
      `+${e.xp} ${TRADES[e.trade].name}`,
      target.clone().setY(target.y + 1.2),
      'xp',
    )
    sound.done(e.at, e.trade)
  } else if (e.type == 'upgraded') {
    let t = piece({
      eid: e.piece,
      kind: e.item,
      rarity: e.rarity,
      plus: e.plus,
    })
    h.toast(`Upgraded: ${t.name}`, `Toast-loot ${tint(t.rarity)}`, icon(e.item))
    glow.emit(v3(e.at, 1), GRADES[t.rarity].light, 24, {
      speed: 2,
      up: 2.5,
      life: 0.9,
      size: 0.08,
      fall: 1,
    })
    marks.float(
      `+${e.xp} ${TRADES[e.trade].name}`,
      target.clone().setY(target.y + 1.2),
      'xp',
    )
    sound.done(e.at, e.trade)
    sound.spoil(null, 'rare')
  } else if (e.type == 'trade') {
    let t = TRADES[e.trade]
    h.toast(`${t.name} ${e.lvl}!`, 'Toast-big', glyphText(t.icon))
    glow.emit(target, 0x9fe07a, 24, {
      speed: 2,
      up: 2.5,
      life: 1,
      size: 0.08,
      fall: 1,
    })
    sound.level()
  } else h.toast(e.text)
}

let talkTo = () => {
  let giver = last?.talk
  if (!giver) return
  let next = giver.next
  // A deal standing between them opens over their words.
  if (last && deal.standing(last.sheet, giver.id).length) {
    dealt.open(giver.id, giver.name)
  }
  folk.engage(giver.id)
  h.talk(
    {
      quest: next?.quest ?? null,
      state: next?.state ?? 'done',
      have: next?.have ?? 0,
      greets: giver.greets,
      name: giver.name,
      hears: !!folk.near(),
      looks: folk.looks(giver.id),
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
      folk.news(
        next.quest.giver,
        `${
          last?.sheet.name ?? 'A hero'
        } did what you asked: ${next.quest.title}.`,
      )
      sound.quest()
    },
  )
  chat.converse()
}

let last: Frame | null = null
let job: Job | null = null
let then = performance.now()
// The page keeps up with the screen before it keeps its looks: while frames
// run slow it draws fewer pixels, then plainer shadows, then none.
let EASE = [
  () => renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)),
  () => renderer.setPixelRatio(1),
  () => {
    w.sun.shadow.mapSize.set(1024, 1024)
    w.sun.shadow.map?.dispose()
    w.sun.shadow.map = null
  },
  () => renderer.setPixelRatio(0.75),
  () => {
    renderer.shadowMap.enabled = false
    w.sun.castShadow = false
    w.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        for (let m of Array.isArray(o.material) ? o.material : [o.material]) {
          m.needsUpdate = true
        }
      }
    })
  },
]
let paced = { t: 0, n: 0, eased: 0 }
let keepUp = (spent: number) => {
  if (starting || !playing) return
  paced.t += spent
  paced.n++
  if (paced.t < 3) return
  if (paced.t / paced.n > 1 / 45 && paced.eased < EASE.length) {
    EASE[paced.eased++]()
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
  depth(camera, w.fog)
  if (playing && net.hero) {
    let i = hands.read()
    if (i.mic) void voice.toggle()
    if (h.talking) {
      Object.assign(i, {
        move: [0, 0],
        strike: false,
        ability: 0,
        dodge: false,
        jump: false,
      })
    }
    let following = cam.follow
    steer(cam, i, last?.body.yaw ?? cam.yaw + Math.PI, dt)
    if (cam.follow != following) {
      try {
        localStorage.setItem('mossvale.cam', cam.follow ? 'follow' : 'free')
      } catch { /* kept for this page only */ }
    }
    let f = g.frame(v, i, cam.yaw, dt)
    last = f
    if (f) {
      let mine = net.who(net.hero) ?? look
      let dressed = lookOf(net.hero)
      job = toil.tick(
        v,
        f,
        i.gather || (i.talk && (!f.talk || !!job?.bench)),
        i.strike || i.dodge || i.jump || i.ability > 0,
      )
      let d = job.doing
      stage.tick(
        f,
        net.hero,
        dressed,
        dt,
        voice.meter,
        mine.name,
        d ? { swing: d.swing, x: d.at[0], z: d.at[2] } : null,
      )
      h.mic(voice.mic, voice.input, voice.sending)
      bounty.tick(job, [f.body.x, f.body.y, f.body.z], dt)
      folk.tick(f)
      seen.tick(f)
      let found = camp.tick(f)
      if (found) h.toast(`${LEVELS[found.level].name} fire found`, 'Toast-big')
      // An offer from the villager the hero is beside opens the deals.
      let talk = f.talk
      for (let n of deal.tick(f.level)) {
        h.toast(n.text, 'Toast-loot')
        if (talk && n.offer == talk.id) dealt.open(talk.id, talk.name)
      }
      let views = deal.standing(f.sheet)
      dealt.paint(
        views.filter((v) => v.giver.id == talk?.id),
        talk?.id ?? null,
        net.now(),
      )
      chat.tick(f, stage.headOf)
      voice.tick(f)
      let k = 1 - Math.exp(-dt * 10)
      if (Number.isNaN(cam.x)) {
        ;[cam.x, cam.y, cam.z] = [f.body.x, f.body.y, f.body.z]
      }
      cam.x += (f.body.x - cam.x) * k
      cam.y += (f.body.y - cam.y) * (1 - Math.exp(-dt * 6))
      cam.z += (f.body.z - cam.z) * k
      target.set(cam.x, cam.y + stature(BUILD) * 0.8, cam.z)
      // Doors open for whoever is near them.
      w.swing([
        [f.body.x, f.body.y, f.body.z],
        ...f.others.map((
          o,
        ): [number, number, number] => [o.body.x, o.body.y, o.body.z]),
        ...f.givers.map((
          g,
        ): [number, number, number] => [g.x, groundAt(v, g.x, g.z), g.z]),
      ], dt)
      for (let e of f.events) react(e, target)
      for (let e of job.events) worked(e)
      if (i.talk && f.talk && !job.bench) talkTo()
      if (h.talking && !f.talk) h.talk(null, () => {}, () => {})
      if (!h.talking) folk.leave()
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
      // The hero's quests and deals, and where the ones tracked go next.
      let tasks = tasksOf(f.sheet, views)
      let givers = Object.fromEntries(
        f.givers.map((n): [string, Spot] => [n.id, [n.x, n.z]]),
      )
      let way = guide(
        tasks,
        givers,
        [f.body.x, f.body.z],
      )
      h.show(f, here, clockOf(w.day), bearing(cam.yaw), tasks, way.aim)
      log.show(tasks, f.level)
      actions.show(f)
      // A ward shimmers about the hero while it holds.
      if (f.ward > 0 && Math.random() < 0.5) {
        let a = Math.random() * Math.PI * 2
        glow.emit(
          new THREE.Vector3(
            f.body.x + Math.sin(a) * 0.7,
            f.body.y + 0.3 + Math.random() * 1.3,
            f.body.z + Math.cos(a) * 0.7,
          ),
          0x9fd8ff,
          1,
          { speed: 0.3, up: 0.6, life: 0.7, size: 0.06, fall: -0.3 },
        )
      }
      let t = performance.now()
      bursts = bursts.filter((b) => {
        if (b.when > t) return true
        ring(b.at, b.r, b.tint)
        glow.emit(b.at, b.tint, 16, { speed: 3, up: 2, life: 0.5, size: 0.08 })
        cam.shake = Math.max(cam.shake, 0.1)
        return false
      })
      h.work(job)
      m.show(f, job.nodes, way.marks, camp.known())
      p.show(f)
      you.show(f.sheet, mine)
      skills.show(f)
      trades.show(job.trades)
      // Walked off from the station its sheet is open at: it folds away.
      if (bench.at && job.bench?.craft != bench.at) bench.close()
      bench.show(f.sheet, job)
      // And so does a board's. What each board in sight holds for the hero:
      // the one they stand at, to read, and a paper for each notice.
      if (notes.open && !job.board) notes.close()
      let jobs = deal.posted(f.sheet)
      let read = (b: Board) =>
        notices(f.sheet.quests, b.level, givers, [b.at[0], b.at[2]], jobs)
      notes.show(job.board ? read(job.board) : [])
      pins.tick([f.body.x, f.body.z], (b) => read(b).length, job)
      settings.show()
      w.focus.set(f.body.x, f.body.y, f.body.z)
    }
  } else {
    // At the gate: the camera drifts around the fire, and the new hero stands
    // by it in the colours being chosen.
    let a = t / 9000
    let [hx, hz] = hearth()
    target.set(hx, groundAt(v, hx, hz) + 1.2, hz + 3)
    w.focus.copy(target)
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
      roll: -1,
      down: false,
      t: t / 1000,
    }, dt)
  }
  // The building the hero is in, if any: the camera looks down into it, and
  // what stands between the camera and the hero thins away, its roof and
  // upper floors too (soft.ts).
  feet.set(cam.x, cam.y, cam.z)
  let home = within(v, feet.x, feet.y, feet.z)
  aim(cam, camera, target, v, dt, home)
  w.see(camera.position, feet, stature(BUILD), dt)
  bounty.see(camera.position, feet, stature(BUILD))
  pins.see(camera.position, feet, stature(BUILD))
  sound.listen(camera, v, playing ? last : null, net.hero, dt)
  // Embers off the fire near, and at night fireflies about the player.
  let fire = hearthNear(target.x, target.z, 60)
  if (fire && Math.random() < 0.5) {
    let [hx, hz] = fire
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
  for (let b of v.buildings(target.x, target.z, 20)) {
    if (Math.hypot(b.x - target.x, b.z - target.z) > 20) continue
    for (let fire of b.glows) {
      if (!fire.fire || Math.random() >= 0.35) continue
      glow.emit(
        new THREE.Vector3(...fire.at),
        0xffa040,
        1,
        { speed: 0.22, up: 0.9, life: 0.9, size: 0.045, fall: -0.2 },
      )
    }
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
// The level's shaders compile off the page's thread where the browser can
// (KHR_parallel_shader_compile), so the gate paints meanwhile, and the frame
// runs once they are ready.
renderer.compileAsync(w.scene, camera).catch(reportError).finally(() =>
  requestAnimationFrame(loop)
)
// For whoever opens the console, and for a test driving the page.
Object.assign(globalThis, {
  mossvale: {
    net,
    game: g,
    voice,
    village: folk,
    deals: deal,
    get frame() {
      return last
    },
    get job() {
      return job
    },
    notices: notes,
    get vale() {
      return v
    },
    get world() {
      return w
    },
    renderer,
    camera,
    cam,
    sound,
    /** show and sound what happened, as if a frame said so */
    react: (e: Event) => react(e, target),
  },
})

let busy = gate.querySelector('.Gate_Busy')
if (busy) busy.textContent = 'Finding the others…'
let { me, heroes } = await asking
chat.me(me)
folk.me(me)
seen.me(me)
camp.me(me)
deal.me(me)
if (!me.reads) {
  gateCard.innerHTML = `${TITLE}<p class=Gate_Lede>This vale is private.</p>${
    me.signIn
      ? `<a class="Btn Btn-go Btn-big" href="${esc(me.signIn)}">Sign in</a>`
      : ''
  }`
} else if (me.person) {
  // Signed in: your heroes, wherever you made them.
  look.name = me.name?.split(/\s/)[0] ?? ''
  let played = net.played()
  let o = heroes.find((o) => o.eid == played)
  if (o) begin(o.eid, o.seen)
  else if (heroes.length) choose(me, heroes)
  else make(me, null)
} else {
  // Signed out: the hero this tab has been playing, or a new one.
  let played = net.played()
  if (played && me.writes && await net.known(played)) {
    begin(played)
  } else make(me, null)
}
