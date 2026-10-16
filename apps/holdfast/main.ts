/** Holdfast's page: the graph is the only owner of play and interface state. */
import { client, WriteRefused, WriteUnknown } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { comps, dead } from '@yaks/graph/bundle'
import { replicate, syncOf } from '@yaks/sync'
import { recover } from './recovery.ts'
import { mint } from '@yaks/graph/identity'
import { parse } from '@yaks/query'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { docs as gameDocs } from '@yaks/game/vocab'
import { docs as uxDocs } from '@yaks/ux/vocab'
import { fixedStep, ownerOf } from '@yaks/game'
import { type ControlsBundle, listen } from '@yaks/game/controls'
import { frameLoop } from '@yaks/stage/render'
import { kits, themes } from '@yaks/ui/ui'
import { kit as hudKit } from '@yaks/game/hud'
import { createLook, type View } from './look.ts'
import { type Actions, renderUI } from './ui.ts'
import { ids, seed } from './seed.ts'
import {
  build,
  OrderRefused,
  sell,
  startWave,
  step,
  upgrade,
  view,
} from './rules.ts'
import type { Row } from './model.ts'

type Build = {
  run: string
  map: string
  slot: number
  design: string
  message: string
  pending?: boolean
}
type Simulation = {
  then: number
  remainder: number
  busy: boolean
  pulse: number
}
type Reply = { run: string; defender: string; message: string; at: number }

async function boot() {
  for (
    let url of [
      themes.everforest.css,
      ...Object.values(kits.base).map((p) => p.css),
      ...Object.values(hudKit).map((p) => p.css),
    ]
  ) {
    let link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = String(url)
    document.head.insertBefore(
      link,
      document.querySelector('link[rel=stylesheet]'),
    )
  }
  let canvas = document.querySelector('canvas')!
  let root = document.querySelector<HTMLElement>('#hud')!
  let base = new URL('./api/', location.href)
  let [manifest, who] = await Promise.all([
    fetch(new URL('vocab.json', base)).then((r) => {
      if (!r.ok) throw new Error('Could not load Holdfast’s vocabulary.')
      return r.json()
    }),
    fetch(new URL('me', base)).then((r) => {
      if (!r.ok) throw new Error('Could not check play permissions.')
      return r.json()
    }),
  ])
  let front = client(
    loadVocab([
      ...manifest as VocabDoc[],
      ...[...gameDocs, ...uxDocs].map((doc) => ({
        ...doc,
        $defs: Object.fromEntries(
          Object.entries(doc.$defs ?? {}).filter(([name]) =>
            !(manifest as VocabDoc[]).some((remote) => remote.$defs?.[name])
          ),
        ),
      })),
    ]),
    [],
    {
      url: base.href.replace(/\/$/, ''),
      vault: false,
      wireVault: false,
      report: (e) => {
        if (e.refused) message(e.refused.message)
        else if (!(e.error instanceof WriteUnknown)) reportError(e.error)
      },
    },
  )
  let page = mint(), defender = mint(), help = mint(), controls = mint()
  let now = () => front.wire!.now()
  let rows = () => front.read(parse('*')) as Row[]
  let row = (id: string) => (front.ent(id) ?? { entity: { eid: id } }) as Row
  let state = () => (row(page)?.Build ?? {}) as Build
  let local = (component: string, value: Record<string, unknown>, id = page) =>
    front.mutate([{ entity: { eid: id }, [component]: value }] as Bundle[])
  let message = (text: string) => {
    void local('Build', { message: text, pending: false })
  }
  // Keep the original transaction while its outcome is unknown. Replanning a
  // purchase would allocate another ledger entry and could charge twice.
  let mutate = (batch: Row[]) =>
    recover(batch, {
      write: async (sent) =>
        await front.mutate(sent as Bundle[], { optimistic: false }),
      read: async () => {
        let query = `.entity.eid=${batch.map((r) => r.entity.eid).join(',')}&*`
        let response = await fetch(
          new URL(`query?q=${encodeURIComponent(query)}`, base),
        )
        if (!response.ok) {
          throw new Error(`Defense read: HTTP ${response.status}`)
        }
        return await response.json() as Row[]
      },
      accept: async (current) => {
        let stored = current.map((r) => ({
          entity: r.entity,
          ...Object.fromEntries(
            comps(r as Bundle).filter(([name]) =>
              syncOf(front.vocab, name) === 'server'
            ),
          ),
        }))
        for (let r of batch) {
          if (
            dead(r as Bundle) &&
            !current.some((v) => v.entity.eid === r.entity.eid)
          ) {
            stored.push({ entity: r.entity, tombstone: {} } as Bundle)
          }
        }
        await replicate(front.graph, stored as Bundle[])
        // Held deletes defer peer companions until the server accepted them.
        let companions = batch.flatMap((r) => {
          if (dead(r as Bundle)) return []
          let own = Object.fromEntries(
            comps(r as Bundle).filter(([name]) =>
              syncOf(front.vocab, name) !== 'server'
            ),
          )
          return Object.keys(own).length ? [{ entity: r.entity, ...own }] : []
        })
        if (companions.length) await front.mutate(companions as Bundle[])
      },
      wait: () => new Promise((resolve) => setTimeout(resolve, 1000)),
      report: (error) => reportError(error),
    })
  let watch = front.watch('.map_design&*')
  let runWatch: ReturnType<typeof front.watch> | undefined
  let runEntityWatch: ReturnType<typeof front.watch> | undefined
  let followRun = (run: string) => {
    runWatch?.close()
    runEntityWatch?.close()
    runWatch = run ? front.watch(`.refs=${run}&*`) : undefined
    runWatch?.subscribe(() => paint())
    if (run) {
      runEntityWatch = front.watch(`.entity.eid=${run}&*`)
      runEntityWatch.subscribe(() => paint())
    }
  }
  let designs = [
    watch,
    ...['enemy_design', 'tower_design', 'wave_design'].map((comp) =>
      front.watch(`.${comp}&*`)
    ),
  ]
  let ready = () =>
    designs.every((w) => w.ready) &&
    (!state().run || !!runWatch?.ready && !!runEntityWatch?.ready)
  await front.ready
  await Promise.all(
    designs.map((watch) =>
      watch.ready ? Promise.resolve() : new Promise<void>((resolve) => {
        let off = watch.subscribe(() => {
          if (watch.ready) {
            off()
            resolve()
          }
        })
      })
    ),
  )
  await local('Build', {
    run: new URL(location.href).searchParams.get('run') ?? '',
    map: ids.maps[0],
    slot: -1,
    design: ids.towers.arrow[0],
    message: '',
  })
  await local('Simulation', {
    then: performance.now(),
    remainder: 0,
    busy: false,
    pulse: 0,
    paint: 0,
  })
  if (who.writes) {
    // Initial authored values enter the same store as play; existing edits win.
    await mutate(
      seed.filter((r) => !rows().some((v) => v.entity.eid === r.entity.eid)),
    )
  }
  let look = createLook(canvas)
  let hands = listen(
    canvas,
    canvas,
    () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? ''),
    {
      touchStick: false,
      axes: {},
      turns: {},
      keys: {
        Space: 'wave',
        Digit1: 'one',
        Digit2: 'two',
        Digit3: 'three',
        Digit4: 'four',
        Enter: 'build',
      },
      tap: { 0: 'select' },
      gamepad: { buttons: { 0: 'build', 3: 'wave', 4: 'previous', 5: 'next' } },
      cursor: (x, y) => [x, y],
      get: () => row(controls) as ControlsBundle,
      onChange: (bundle) => {
        void front.mutate([bundle] as Bundle[])
      },
    },
  )
  let command = async (action: string) => {
    let s = state()
    look.sound(action, s.slot)
    if (!who.writes) {
      return message(
        'Watching only. Ask the app owner for an editor invitation to defend together.',
      )
    }
    if (!s.run || !ready()) {
      return message('Waiting for the shared defense to connect…')
    }
    if (s.pending) return
    await local('Build', { pending: true })
    try {
      await mutate([{
        entity: { eid: mint() },
        command: {
          run: s.run,
          defender,
          action,
          slot: s.slot,
          design: s.design,
          at: now(),
        },
      }])
      if (state().pending) {
        await local('Build', { message: 'Order sent to the team…' })
      }
    } catch (error) {
      message('That order could not be completed. You can keep playing.')
      reportError(error)
    }
  }
  let select = (slot: number) => {
    void local('Build', { slot })
    if (state().run && who.writes) {
      void mutate([{
        entity: { eid: defender },
        defender: { run: state().run, slot, at: now() },
      }])
    }
  }
  let actions: Actions = {
    chooseMap: (map) => {
      void local('Build', { map })
    },
    chooseTower: (design) => {
      void local('Build', { design })
    },
    select,
    newRun: async (map) => {
      if (!who.writes) {
        return message(
          'Ask the app owner for an editor invitation to start a defense.',
        )
      }
      if (state().pending) return
      await local('Build', { pending: true })
      try {
        let run = mint()
        await mutate([{
          entity: { eid: run },
          run: { map, seed: Math.floor(now()) },
        }])
        await local('Build', {
          run,
          map,
          slot: -1,
          message: 'Choose a site, then build your first tower.',
        })
        followRun(run)
        let url = new URL(location.href)
        url.searchParams.set('run', run)
        history.replaceState(null, '', url)
      } catch (error) {
        message(
          'Could not create this defense. You can try another.',
        )
        reportError(error)
      } finally {
        await local('Build', { pending: false })
      }
    },
    build: () => {
      void command('build')
    },
    upgrade: () => {
      void command('upgrade')
    },
    sell: () => {
      void command('sell')
    },
    wave: () => {
      void command('wave')
    },
    copy: async () => {
      try {
        await navigator.clipboard.writeText(location.href)
        message(
          'Run link copied. Invite a friend as an editor through this app’s sharing, then send this link.',
        )
      } catch {
        message(`Share this run: ${location.href}`)
      }
    },
    leave: () => {
      void local('Build', { run: '', slot: -1, message: '', pending: false })
      void front.mutate(
        [{ entity: { eid: defender }, defender: null }] as Bundle[],
      )
      followRun('')
      history.replaceState(null, '', location.pathname)
    },
    disclosure: (bundle) => {
      void front.mutate([bundle])
    },
  }
  let paint = () => {
    let s = state()
    renderUI(root, rows(), {
      ...s,
      run: s.run || null,
      online: ready(),
      canPlay: who.writes === true,
      invite: location.href,
      pending: s.pending ?? false,
      helpRow: row(help) as Bundle,
    }, actions)
    document.querySelector('#loading')?.remove()
  }
  for (let design of designs) design.subscribe(paint)
  let localWatch = front.watch(
    `.entity.eid=${page},${help}&?Build&?Disclosure`,
    {
      remote: false,
    },
  )
  localWatch.subscribe(paint)
  followRun(state().run)
  paint()

  async function tick(stamp: number, dt: number, _elapsed: number) {
    let sim = (row(page)?.Simulation ?? {}) as Simulation
    let s = state(), time = now()
    if (document.hidden || !ready()) return
    if (s.run && who.writes && time - (sim.pulse ?? 0) > 800) {
      void local('Simulation', { pulse: time })
      void mutate([{
        entity: { eid: defender },
        defender: { run: s.run, slot: s.slot, at: time },
      }])
    }
    let intent = hands.read(dt)
    let camera = (row(page)?.Presentation as { view?: View })?.view ??
      { yaw: -0.48, pitch: 0.86, zoom: 1 }
    if (intent.orbit.some((n) => n !== 0) || intent.zoom) {
      camera = {
        yaw: camera.yaw + intent.orbit[0],
        pitch: Math.max(0.45, Math.min(1.3, camera.pitch + intent.orbit[1])),
        zoom: Math.max(
          0.7,
          Math.min(1.6, camera.zoom * (1 + intent.zoom * 0.06)),
        ),
      }
      void local('Presentation', { view: camera })
    }
    if (intent.pick) {
      let slot = look.pick(...intent.pick)
      if (slot !== null) select(slot)
    }
    for (let action of intent.actions) {
      if (action === 'wave') actions.wave()
      if (action === 'build') actions.build()
      let index = ['one', 'two', 'three', 'four'].indexOf(action)
      if (index >= 0) actions.chooseTower(Object.values(ids.towers)[index][0])
      if (action === 'next' || action === 'previous') {
        let count = view(rows(), s.run).map?.slots.length ?? 0
        if (count) {
          select((s.slot + (action === 'next' ? 1 : count - 1)) % count)
        }
      }
    }
    if (
      stamp - ((row(page)?.Presentation as { frame?: number })?.frame ?? 0) >=
        1000 / 30
    ) {
      void local('Presentation', { frame: stamp })
      look.draw(
        s.run ? rows() : [...rows(), {
          entity: { eid: page },
          run: { map: s.map, seed: 0 },
        }],
        s.run || page,
        s.slot ?? -1,
        time,
        camera,
      )
    }
    if (!s.run || !who.writes || sim.busy) return
    let players = rows().filter((r) =>
      r.defender?.run === s.run && time - r.defender!.at < 3500
    )
    let owner = ownerOf(
      players.map((r) => [r.entity.eid, { x: 0, z: 0, awake: true }] as const),
      { x: 0, z: 0 },
      1,
    )
    if (owner !== defender) return
    let plan = fixedStep(
      Math.max(0, stamp - (sim.then ?? stamp)),
      sim.remainder ?? 0,
      20,
      5,
    )
    await local('Simulation', {
      busy: true,
      then: stamp,
      remainder: plan.remainder,
    })
    try {
      let commands = rows().filter((r) => r.command?.run === s.run).sort((
        a,
        b,
      ) =>
        a.command!.at - b.command!.at ||
        a.entity.eid.localeCompare(b.entity.eid)
      )
      for (let order of commands) {
        // A peer can resend its last command after a reconnect. Its answer
        // remains on the same row, so never execute an answered order twice.
        if (order.reply) {
          await mutate([{ entity: order.entity, command: null }])
          continue
        }
        let c = order.command!
        try {
          let batch = c.action === 'build'
            ? build(rows(), s.run, c.slot!, c.design!)
            : c.action === 'upgrade'
            ? upgrade(rows(), s.run, c.slot!)
            : c.action === 'sell'
            ? sell(rows(), s.run, c.slot!)
            : c.action === 'wave'
            ? startWave(rows(), s.run, time)
            : []
          await mutate([...batch, {
            entity: order.entity,
            command: null,
            reply: {
              run: s.run,
              defender: c.defender,
              message: c.action === 'wave'
                ? 'The wave is coming. Hold the line!'
                : 'Team order complete.',
              at: time,
            },
          }])
        } catch (error) {
          if (
            !(error instanceof OrderRefused) && !(error instanceof WriteRefused)
          ) {
            throw error
          }
          await mutate([{
            entity: order.entity,
            command: null,
            reply: {
              run: s.run,
              defender: c.defender,
              message: error.message,
              at: time,
            },
          }])
        }
      }
      for (let i = 0; i < plan.steps; i++) {
        let batch = step(rows(), s.run, time - (plan.steps - i - 1) * 50, 0.05)
        if (batch.length) await mutate(batch)
      }
    } finally {
      await local('Simulation', { busy: false })
    }
  }
  let replies = front.watch(`.reply.defender=${defender}`, { remote: false })
  replies.subscribe((batch) => {
    let latest = [...batch].sort((a, b) =>
      (b.reply as Reply).at - (a.reply as Reply).at
    )[0]
    if (latest) {
      message((latest.reply as Reply).message)
    }
  })
  requestAnimationFrame(frameLoop((stamp, dt, elapsed) => {
    void tick(stamp, dt, elapsed).catch((error) => {
      reportError(error)
    })
  }, performance.now()))
  addEventListener('pagehide', () => {
    hands.dispose()
    look.dispose()
    front.close()
  }, { once: true })
}

boot().catch((error) => {
  document.querySelector('#loading')!.textContent =
    `Holdfast couldn’t start: ${error.message}`
  console.error(error)
})
