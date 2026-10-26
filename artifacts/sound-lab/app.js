import { apply, me, query } from './api/client.js'
import { engine } from './audio.js'
import {
  advance,
  duration,
  noteName,
  presets,
  song,
  stepDuration,
  tracks,
} from './music.js'
import { persistence } from './store.js'
import { dialogs } from './dialogs.js'
import { scope } from './scope.js'

let $ = (id) => document.getElementById(id)
let letters = ['A', 'B', 'C', 'D'], keys = 'asdfghjk'
let esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (
      c,
    ) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]),
  )
let value = song(),
  selected = { track: 0, step: 0 },
  view = 'wave',
  recording = false
let edits = 0
let historyStack = [],
  events = [],
  position = null,
  started = 0,
  who = null
let audio = engine({
  getSong: () => value,
  onStep: (event) => events.push(event),
})
let status = (text, error = false) => {
  $('save-status').textContent = text
  $('save-status').classList.toggle('error', error)
}
let fail = (error) => {
  status(error?.message || String(error), true)
  globalThis.reportError?.(error)
}
let storage = persistence({
  apply,
  query,
  status,
  saved: (eid) => history.replaceState(null, '', `#beat=${eid}`),
})
let checkpoint = () => {
  historyStack.push(structuredClone(value))
  if (historyStack.length > 60) historyStack.shift()
  $('undo').disabled = false
}
let changed = () => {
  edits++
  audio.setMix()
  storage.change(value)
  drawDuration()
}
let edit = (fn, redraw = true) => {
  checkpoint()
  fn()
  changed()
  if (redraw) draw()
}
let bank = () => value.patterns[value.pattern]
let selectedNote = () => bank().steps[selected.track][selected.step]
let pitch = (track) => track === 6 ? 38 : 62
let timeText = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${
    String(Math.floor(seconds % 60)).padStart(2, '0')
  }`
let click = (id, fn) =>
  $(id).addEventListener('click', () => Promise.resolve().then(fn).catch(fail))
let modal = (title, html) => {
  $('modal-title').textContent = title
  $('modal-body').innerHTML = html
  $('modal').showModal()
}
let close = () => $('modal').close()
let download = (data, type, suffix) => {
  let url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement('a')
  a.href = url
  a.download = `${
    value.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'sound-lab'
  }${suffix}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

let drawGrid = () => {
  let length = bank().length, cells = bank().steps
  let row = `step-row ${length === 16 ? 'sixteen' : ''}`
  $('grid').innerHTML =
    `<div class="${row} steps-header" style="--steps:${length}"><span>Instrument</span>${
      Array.from({ length }, (_, s) =>
        `<span>${String(s + 1).padStart(2, '0')}</span>`).join('')
    }</div>` + tracks.map((track, t) =>
      `<div class="${row}" style="--steps:${length};--track:${track.color}"><button class="track-label" data-track="${t}" aria-pressed="${
        selected.track === t
      }"><i></i>${track.name}</button>${
        Array.from({ length }, (_, s) => {
          let cell = cells[t][s],
            title = `${track.name}, step ${s + 1}${
              cell?.note != null ? ', ' + noteName(cell.note) : ''
            }`
          return `<button class="step ${s % 4 === 0 ? 'beat' : ''} ${
            selected.track === t && selected.step === s ? 'selected' : ''
          }" data-step="${s}" data-lane="${t}" aria-label="${title}" aria-pressed="${!!cell}" style="--velocity:${
            cell?.velocity || 0
          }"></button>`
        }).join('')
      }</div>`
    ).join('')
}
let drawEditor = () => {
  let cell = selectedNote(), melodic = tracks[selected.track].melodic
  $('selected-step').textContent = `${tracks[selected.track].name} · step ${
    selected.step + 1
  }${
    cell
      ? ' · ' + (melodic ? noteName(cell.note ?? pitch(selected.track)) : 'hit')
      : ' · empty'
  }`
  $('note').disabled = !melodic || !cell
  $('note').value = cell?.note ?? pitch(selected.track)
  $('velocity').disabled = !cell
  $('velocity').value = cell?.velocity ?? .8
  $('velocity-value').textContent = Math.round((cell?.velocity ?? .8) * 100) +
    '%'
}
let drawMixers = () => {
  $('mixers').innerHTML = tracks.map((track, t) =>
    `<div class="strip ${
      selected.track === t ? 'selected' : ''
    }" style="--track:${track.color}"><div class="strip-name"><i></i>${track.name}</div>${
      ['volume', 'pan', 'tone'].map((name) =>
        `<label>${
          { volume: 'Level', pan: 'Pan', tone: 'Tone' }[name]
        }<output id="mix-${t}-${name}">${
          Math.round(value.mix[t][name] * 100)
        }</output><input data-mix="${name}" data-track="${t}" aria-label="${track.name} ${name}" type="range" min="${
          name === 'pan' ? -1 : 0
        }" max="1" step="0.01" value="${value.mix[t][name]}"></label>`
      ).join('')
    }<div class="strip-buttons"><button data-mix="mute" data-track="${t}" aria-pressed="${
      value.mix[t].mute
    }" aria-label="Mute ${track.name}">M</button><button data-mix="solo" data-track="${t}" aria-pressed="${
      value.mix[t].solo
    }" aria-label="Solo ${track.name}">S</button></div></div>`
  ).join('')
}
let drawChain = () => {
  $('chain').innerHTML = value.chain.map((pattern, i) =>
    `<button data-scene="${i}" aria-label="Scene ${i + 1}: pattern ${
      letters[pattern]
    }. Click to change."><small>${String(i + 1).padStart(2, '0')}</small>${
      letters[pattern]
    }</button>`
  ).join('')
}
let drawDuration = () => {
  $('duration').textContent = `${
    timeText(duration(value, { mode: 'chain' }))
  } arrangement · ${
    value.chain.reduce((n, i) => n + value.patterns[i].length / 16, 0)
  } bars · loops continuously`
}
let draw = () => {
  $('title').value = value.title
  $('tempo').value = value.bpm
  $('length').value = bank().length
  for (let name of ['swing', 'delay', 'master']) {
    $(name).value = value[name]
    $(name + '-value').textContent = Math.round(value[name] * 100) + '%'
    $(name + '-knob').style.setProperty(
      '--rotation',
      `${-130 + value[name] / Number($(name).max) * 260}deg`,
    )
  }
  document.querySelector('.pattern-tabs').innerHTML = letters.map((letter, i) =>
    `<button data-bank="${i}" aria-pressed="${
      value.pattern === i
    }" aria-label="Pattern ${letter}">${letter}</button>`
  ).join('')
  $('mode').textContent = value.mode === 'chain' ? 'Song loop' : 'Pattern loop'
  $('mode').setAttribute('aria-pressed', value.mode === 'chain')
  drawGrid()
  drawEditor()
  drawMixers()
  drawChain()
  drawDuration()
  $('undo').disabled = !historyStack.length
}
let stop = () => {
  audio.stop()
  events = []
  position = null
  $('play').innerHTML = '<span>▶</span> Play'
  $('play').setAttribute('aria-label', 'Play')
  $('run-state').textContent = 'Stopped'
  $('clock').textContent = '00:00'
  $('display-progress').style.setProperty('--progress', '0%')
  document.querySelectorAll('.playhead,.current').forEach((el) =>
    el.classList.remove('playhead', 'current')
  )
}
let play = async () => {
  if (audio.playing) return stop()
  await audio.start()
  if (!audio.playing) return
  $('play').setAttribute('aria-label', 'Stop')
  started = audio.context().currentTime
  $('play').innerHTML = '<span>■</span> Stop'
  $('run-state').textContent = recording ? 'Recording' : 'Playing'
}
let hit = async (track) => {
  let same = selected.track === track
  selected.track = track
  let note = tracks[track].melodic && same
    ? Number($('note').value || pitch(track))
    : pitch(track)
  await audio.preview(track, note)
  let pad = document.querySelector(`[data-pad="${track}"]`)
  pad?.classList.add('active')
  setTimeout(() => pad?.classList.remove('active'), 100)
  if (recording && audio.playing && position) {
    let event = position, now = audio.context().currentTime, step = event.step
    if (now - event.time > stepDuration(value, step) / 2) {
      event = advance(value, event)
      step = event.step
    }
    let pattern = value.patterns[event.pattern]
    edit(() => {
      pattern.steps[track][step] = {
        velocity: .8,
        ...(tracks[track].melodic ? { note } : {}),
      }
      value.pattern = event.pattern
      selected.step = step
    })
  } else drawEditor()
}
let switchSong = async (next) => {
  edits++
  await storage.fork()
  stop()
  value = next
  historyStack = []
  selected = { track: 0, step: 0 }
  history.replaceState(null, '', location.pathname)
  draw()
  status('Ready to remix. Your first edit makes a new beat.')
}

$('preset').innerHTML = '<option value="">Choose a groove…</option>' +
  presets.map((p) =>
    `<option value="${p.id}">${p.name} · ${p.bpm} BPM</option>`
  ).join('')
$('note').innerHTML = Array.from(
  { length: 72 },
  (_, i) => `<option value="${i + 24}">${noteName(i + 24)}</option>`,
).join('')
$('pads').innerHTML = tracks.map((track, t) =>
  `<button class="pad" data-pad="${t}" style="--track:${track.color}" aria-label="Play ${track.name}"><b>${
    keys[t].toUpperCase()
  }</b>${
    track.name.replace('Closed ', '').replace('Percussion', 'Perc.')
  }</button>`
).join('')
for (let name of ['mix', 'arrange']) {
  click(name + '-tab', () => {
    for (let panel of ['mix', 'arrange']) {
      $(panel + '-panel').hidden = panel !== name
      $(panel + '-tab').setAttribute('aria-pressed', panel === name)
    }
  })
}
click('play', play)
click('stop', stop)
click('close-modal', close)
click('undo', () => {
  if (!historyStack.length) return
  value = historyStack.pop()
  selected.step = Math.min(selected.step, bank().length - 1)
  changed()
  draw()
})
click('copy', () => {
  let next = (value.pattern + 1) % 4
  edit(() => {
    value.patterns[next] = structuredClone(bank())
    value.pattern = next
  })
  status(`Copied to pattern ${letters[next]}. Undo is available.`)
})
click('clear', () =>
  edit(() => {
    bank().steps = tracks.map(() => Array(32).fill(null))
  }))
click('mode', () => {
  let running = audio.playing
  stop()
  value.mode = value.mode === 'chain' ? 'pattern' : 'chain'
  draw()
  if (running) return play()
})
click('record', () => {
  recording = !recording
  $('record').setAttribute('aria-pressed', recording)
  $('run-state').textContent = audio.playing
    ? recording ? 'Recording' : 'Playing'
    : recording
    ? 'Record armed · press play'
    : 'Ready to play'
})
click('save', async () => {
  if (!who?.writes) {
    throw new Error(
      'Saving is unavailable right now. Export a project file to keep this beat.',
    )
  }
  storage.change(value)
  await storage.flush()
})
$('preset').addEventListener('change', async (e) => {
  if (!e.target.value) return
  try {
    await switchSong(song(e.target.value))
  } catch (error) {
    fail(error)
  }
  e.target.value = ''
})
$('title').addEventListener('input', () => {
  value.title = $('title').value
  changed()
})
$('tempo').addEventListener('change', () =>
  edit(() => {
    value.bpm = Math.max(50, Math.min(190, Number($('tempo').value) || 110))
  }))
$('length').addEventListener('change', () =>
  edit(() => {
    bank().length = Number($('length').value)
    selected.step %= bank().length
  }))
for (let name of ['swing', 'delay', 'master']) {
  $(name).addEventListener('pointerdown', checkpoint)
  $(name).addEventListener('input', () => {
    value[name] = Number($(name).value)
    $(name + '-value').textContent = Math.round(value[name] * 100) + '%'
    $(name + '-knob').style.setProperty(
      '--rotation',
      `${-130 + value[name] / Number($(name).max) * 260}deg`,
    )
    changed()
  })
}
let taps = []
click('tap', () => {
  let now = performance.now()
  if (now - (taps.at(-1) || 0) > 2000) taps = []
  taps.push(now)
  taps = taps.slice(-6)
  if (taps.length > 1) {
    edit(() => {
      value.bpm = Math.max(
        50,
        Math.min(
          190,
          Math.round(60000 / ((now - taps[0]) / (taps.length - 1))),
        ),
      )
    })
  }
})
document.querySelector('.pattern-tabs').addEventListener('click', (e) => {
  let button = e.target.closest('[data-bank]')
  if (!button) return
  value.pattern = Number(button.dataset.bank)
  selected.step %= bank().length
  draw()
})
$('grid').addEventListener('click', (e) => {
  let step = e.target.closest('[data-step]'),
    track = e.target.closest('[data-track]')
  if (track) {
    selected.track = Number(track.dataset.track)
    draw()
    return
  }
  if (!step) return
  selected = {
    track: Number(step.dataset.lane),
    step: Number(step.dataset.step),
  }
  if (e.shiftKey) {
    drawGrid()
    drawEditor()
    return
  }
  edit(() => {
    let lane = bank().steps[selected.track]
    lane[selected.step] = lane[selected.step] ? null : {
      velocity: Number($('velocity').value),
      ...(tracks[selected.track].melodic
        ? { note: pitch(selected.track) }
        : {}),
    }
  })
  if (selectedNote() && !audio.playing) {
    audio.preview(selected.track, selectedNote().note, selectedNote().velocity)
      .catch(fail)
  }
})
$('note').addEventListener('change', () =>
  edit(() => {
    if (selectedNote()) selectedNote().note = Number($('note').value)
  }))
$('velocity').addEventListener('pointerdown', checkpoint)
$('velocity').addEventListener('input', () => {
  if (!selectedNote()) return
  selectedNote().velocity = Number($('velocity').value)
  changed()
  drawEditor()
  drawGrid()
})
$('mixers').addEventListener('pointerdown', (e) => {
  if (e.target.matches('input')) checkpoint()
})
$('mixers').addEventListener('input', (e) => {
  let t = Number(e.target.dataset.track), name = e.target.dataset.mix
  if (!name) return
  value.mix[t][name] = Number(e.target.value)
  $(`mix-${t}-${name}`).textContent = Math.round(value.mix[t][name] * 100)
  changed()
})
$('mixers').addEventListener('click', (e) => {
  let button = e.target.closest('button[data-mix]')
  if (!button) return
  let t = Number(button.dataset.track), name = button.dataset.mix
  edit(() => {
    value.mix[t][name] = !value.mix[t][name]
  })
})
$('chain').addEventListener('click', (e) => {
  let button = e.target.closest('[data-scene]')
  if (!button) return
  edit(() => {
    let i = Number(button.dataset.scene)
    value.chain[i] = (value.chain[i] + 1) % 4
  })
})
$('pads').addEventListener('click', (e) => {
  if (e.detail !== 0) return
  let button = e.target.closest('[data-pad]')
  if (button) hit(Number(button.dataset.pad)).catch(fail)
})
$('pads').addEventListener('pointerdown', (e) => {
  let button = e.target.closest('[data-pad]')
  if (button) hit(Number(button.dataset.pad)).catch(fail)
})
document.addEventListener('keydown', (e) => {
  if (
    e.target.matches('input,select,textarea') || $('modal').open || e.repeat
  ) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    $('undo').click()
    return
  }
  if (e.code === 'Space') {
    e.preventDefault()
    play().catch(fail)
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  let index = keys.indexOf(e.key.toLowerCase())
  if (index >= 0) {
    e.preventDefault()
    hit(index).catch(fail)
  }
})
document.querySelector('.display-modes').addEventListener('click', (e) => {
  let button = e.target.closest('[data-view]')
  if (!button) return
  view = button.dataset.view
  document.querySelectorAll('[data-view]').forEach((b) =>
    b.setAttribute('aria-pressed', b === button)
  )
})

let update = () => {
  let now = audio.context()?.currentTime || 0, next
  while (events.length && events[0].time <= now) next = events.shift()
  if (next) {
    position = next
    document.querySelectorAll('.playhead,.current').forEach((el) =>
      el.classList.remove('playhead', 'current')
    )
    if (next.pattern === value.pattern) {
      document.querySelectorAll(`[data-step="${next.step}"]`).forEach((el) =>
        el.classList.add('playhead')
      )
    }
    if (value.mode === 'chain') {
      document.querySelector(`[data-scene="${next.chain}"]`)?.classList.add(
        'current',
      )
    }
    $('position').textContent = `${letters[next.pattern]} : ${
      String(next.step + 1).padStart(2, '0')
    } / ${value.patterns[next.pattern].length}`
    $('display-progress').style.setProperty(
      '--progress',
      `${(next.step + 1) / value.patterns[next.pattern].length * 100}%`,
    )
  }
  if (audio.playing) $('clock').textContent = timeText(now - started)
}
scope({
  canvas: $('scope'),
  audio,
  getView: () => view,
  playing: () => audio.playing,
  update,
})

dialogs({
  $,
  click,
  modal,
  close,
  storage,
  getSong: () => value,
  switchSong,
  changed,
  status,
  fail,
  download,
  esc,
  timeText,
  letters,
})

globalThis.addEventListener('beforeunload', (event) => {
  if (storage.dirty()) {
    event.preventDefault()
    event.returnValue = ''
  }
})
globalThis.addEventListener('pagehide', stop)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && audio.playing) {
    stop()
    status('Playback paused while the studio is in the background.')
  }
})

draw()
try {
  who = await me()
  if (!who.writes) {
    status(
      'You can play and export. Saving needs write access to this studio.',
      true,
    )
  }
  let id = new URLSearchParams(location.hash.slice(1)).get('beat')
  if (id && /^[0-9a-f-]{36}$/.test(id)) {
    let loaded = await storage.load(id)
    if (!edits) {
      stop()
      value = loaded
      draw()
      status('Beat loaded. Your first edit will save a separate remix.')
    } else {status(
        'Your new edits are kept. Open the beat shelf to load the earlier beat.',
      )}
  }
} catch (error) {
  fail(error)
}
