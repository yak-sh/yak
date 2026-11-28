/**
 * A space's Operator settings page in the browser (D-475 step 4). The page is
 * drawn from the person's rows (./operator-settings-view.ts), and here it is
 * drawn again from the tab's page graph as they move: a name the Operator
 * gave itself, alerts chosen in another tab, texts agreed to or stopped. Its
 * Save bar writes through the graph (./operator-settings.ts): the name and
 * voice as the Operator's `operatorSettings`, the alerts as `alerting` (first
 * allowing this browser's notifications, `allowPush`, when they are chosen),
 * and a number agreed to as `agreeTexts`, whose door says when it texted a
 * code to confirm. Stop texts writes `stopTexts`. Play speaks a voice's
 * sample at the pace picked, and a voice the chosen way cannot speak is
 * greyed.
 *
 * The view is `[data-view="operator-settings"]`, saying what it draws for in
 * `data-operator-view` (`OperatorView`).
 *
 * @module
 */
import { fragment } from '@yaks/html/dom'
import type { Bundle } from '@yaks/graph'
import type { Client } from '@yaks/client'
import { mint } from '@yaks/graph'
import { CallError } from '@yaks/tools/errors'
import { subscribe, Unallowed } from '@yaks/push/browser'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { ACCOUNT, accountOf, accountWords } from './account-rows.ts'
import { refusal } from './account-browser.ts'
import { pageGraph } from './page-graph.ts'
import { SAVE_THROUGH, type SavingForm } from './page-parts.ts'
import {
  ALERTING,
  alertingEid,
  alertingOf,
  operatorSettings,
  operatorSettingsWords,
  type Settings,
  settingsEid,
  settingsOf,
  TEXTING,
  textingOf,
} from './operator-settings.ts'
import {
  type OperatorRows,
  operatorSettingsView,
  type OperatorView,
} from './operator-settings-view.ts'

/** The Operator settings view. */
export let VIEW = '[data-view="operator-settings"]'

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

/** The rows `root` is drawn from, once each is in. */
export type Held = {
  settings: Bundle[]
  alerting: Bundle[]
  texting: Bundle[]
  account: Bundle[]
}

let rowsOf = (held: Held): OperatorRows | undefined => {
  let settings = settingsOf(held.settings)
  let alerting = alertingOf(held.alerting)
  let account = accountOf(held.account)
  if (!settings || !alerting || !account) return undefined
  return {
    settings,
    alerting,
    texting: textingOf(held.texting),
    email: account.email || null,
  }
}

/** Draw `root` again from the rows its graph holds; nothing until each is
 * in. */
export let drawSettings = (
  root: HTMLElement,
  view: OperatorView,
  held: Held,
): void => {
  let rows = rowsOf(held)
  if (!rows) return
  let next = root.cloneNode(false) as HTMLElement
  next.append(fragment(root.ownerDocument, operatorSettingsView(view, rows)))
  morph(root, next, KEPT)
  fit(root)
}

// What a settings form holding `body` changes of the Operator's settings.
let settingsFrom = (body: FormData): Settings =>
  Object.fromEntries(
    ['name', 'voice', 'voice_speed', 'voice_model', 'voice_backend']
      .filter((k) => body.has(k))
      .map((k) => [k, String(body.get(k))]),
  )

// The voices the way picked cannot speak, greyed; a voice picked among them
// gives way to the first that can.
let fit = (root: HTMLElement) => {
  let voice = root.querySelector('#voice')
  if (!voice) return
  let way = voice.querySelector<HTMLInputElement>('[name=voice_model]:checked')
    ?.value
  for (let v of voice.querySelectorAll<HTMLInputElement>('[name=voice]')) {
    v.disabled = !!way && !v.dataset.ways!.split(' ').includes(way)
  }
  let picked = voice.querySelector<HTMLInputElement>('[name=voice]:checked')
  if (picked?.disabled) {
    voice.querySelector<HTMLInputElement>('[name=voice]:not(:disabled)')!
      .checked = true
  }
}

/** Keep the Operator settings view `root` drawn from `graph`, and write
 * through it. The answer lets go of it all. */
export let bindSettings = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
  allow: (key: string) => Promise<unknown> = (key) =>
    subscribe(key).then((sub) => sub.toJSON(), (error) => {
      throw error instanceof Unallowed
        ? new CallError('arguments', error.message)
        : error
    }),
): () => void => {
  let view = JSON.parse(root.dataset.operatorView!) as OperatorView
  let space = view.space.eid
  let watches = {
    settings: graph.watch(operatorSettings(space)),
    alerting: graph.watch(ALERTING),
    texting: graph.watch(TEXTING),
    account: graph.watch(ACCOUNT),
  }
  let write = async (bundles: Bundle[], unreached: string) => {
    try {
      await graph.mutate(bundles)
    } catch (error) {
      throw new CallError('arguments', refusal(error, unreached))
    }
    return undefined
  }
  let lost = 'Your changes could not be saved. They are kept here. Try again.'
  // The settings a form changes, on the row the page is drawn from.
  let setting = (body: FormData): Bundle => ({
    entity: { eid: settingsEid(space) },
    operatorSettings: { space, ...settingsFrom(body) },
  })
  let saves: Record<string, (body: FormData) => Promise<string | undefined>> = {
    name: (body) => write([setting(body)], lost),
    voice: (body) => write([setting(body)], lost),
    alerts: async (body) => {
      let channel = String(body.get('channel') ?? '')
      let push = channel == 'push'
        ? root.querySelector<HTMLInputElement>('#alerts [data-push]')
        : null
      let allowed = push
        ? [{
          entity: { eid: mint() },
          allowPush: { subscription: await allow(push.dataset.push!) },
        }]
        : []
      return write([...allowed, {
        entity: { eid: alertingEid(view.person) },
        alerting: { channel },
      }], lost)
    },
    texts: (body) =>
      write([{
        entity: { eid: mint() },
        agreeTexts: {
          space,
          number: String(body.get('number') ?? ''),
          agreed: body.get('agreed') == 'yes',
          code: String(body.get('code') ?? '').trim(),
        },
      }], lost),
  }
  let draw = () => {
    drawSettings(root, view, {
      settings: watches.settings.value,
      alerting: watches.alerting.value,
      texting: watches.texting.value,
      account: watches.account.value,
    })
    for (let form of root.querySelectorAll<SavingForm>('form[data-save]')) {
      let save = saves[form.dataset.save!]
      if (save) form[SAVE_THROUGH] = save
    }
  }
  let all = Object.values(watches)
  let off = all.map((w) => w.subscribe(draw))
  let playing: HTMLAudioElement | undefined
  let click = async (e: Event) => {
    let target = e.target as Element
    let play = target.closest<HTMLButtonElement>('[data-sample]')
    if (play) return await sample(play)
    let stop = target.closest<HTMLButtonElement>('[data-stop-texts]')
    if (stop) return await stopTexts(stop)
    let reveal = target.closest<HTMLElement>('[data-reveal]')
    if (reveal) revealed(reveal)
  }
  let sample = async (play: HTMLButtonElement) => {
    let said = root.querySelector('#voice [data-status]')!
    said.textContent = ''
    play.disabled = true
    try {
      let pace = root.querySelector<HTMLInputElement>(
        '#voice [name=voice_speed]:checked',
      )?.value
      let response = await fetch(
        play.dataset.sample + (pace ? '&pace=' + pace : ''),
      )
      if (!response.ok) {
        throw new Error(
          (await response.json().catch(() => null))?.message ??
            'That voice could not be played. Try again.',
        )
      }
      playing ??= new Audio()
      URL.revokeObjectURL(playing.src)
      playing.src = URL.createObjectURL(await response.blob())
      await playing.play()
    } catch (error) {
      said.textContent = (error as Error).message
    }
    play.disabled = false
  }
  let stopTexts = async (stop: HTMLButtonElement) => {
    let form = stop.closest<HTMLElement>('form') ?? root
    let said = form.querySelector('[data-status]')
    if (said) said.textContent = 'Saving…'
    stop.disabled = true
    try {
      await graph.mutate([{ entity: { eid: mint() }, stopTexts: {} }])
      if (said) said.textContent = ''
    } catch (error) {
      if (said) {
        said.textContent = refusal(
          error,
          'Your texts were not stopped. Try again.',
        )
      }
    }
    stop.disabled = false
  }
  let revealed = (reveal: HTMLElement) => {
    let shown = reveal.getAttribute('aria-controls')!.split(' ').map((id) =>
      root.ownerDocument.getElementById(id)!
    )
    for (let s of shown) s.hidden = false
    reveal.hidden = true
    reveal.setAttribute('aria-expanded', 'true')
    shown[0].querySelector('input')?.focus()
  }
  let changed = () => fit(root)
  // A draft of a new number brought back shows the fields it was typed in.
  let restored = (e: Event) => {
    if ((e.target as Element).id != 'texts') return
    let number = root.querySelector<HTMLInputElement>('#texts-number')
    let agreed = root.querySelector<HTMLInputElement>('#texts [name=agreed]')
    let reveal = root.querySelector<HTMLElement>('#texts [data-reveal]')
    if (reveal && !reveal.hidden && (number?.value || agreed?.checked)) {
      revealed(reveal)
    }
    fit(root)
  }
  root.addEventListener('click', click)
  root.addEventListener('change', changed)
  root.addEventListener('save-restored', restored)
  draw()
  fit(root)
  return () => {
    root.removeEventListener('click', click)
    root.removeEventListener('change', changed)
    root.removeEventListener('save-restored', restored)
    playing?.pause()
    for (let stop of off) stop()
    for (let w of all) w.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.operatorView!) as OperatorView
      let stop = bindSettings(
        root,
        pageGraph([accountWords, operatorSettingsWords], person),
      )
      leaving(doc).addEventListener('abort', () => {
        bound.delete(root)
        stop()
      }, { once: true })
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

if (typeof document != 'undefined') start()
