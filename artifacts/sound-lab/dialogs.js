import { render, wav } from './audio.js'
import { duration } from './music.js'
import { validate } from './store.js'

export let dialogs = (
  {
    $,
    click,
    modal,
    close,
    storage,
    getSong,
    switchSong,
    changed,
    status,
    fail,
    download,
    esc,
    timeText,
    letters,
  },
) => {
  click(
    'install-link',
    () =>
      modal(
        'Get your own studio',
        '<div class="modal-prose"><p>Ask your connected yaks.app assistant:</p><p><strong>Install sound-lab in my space.</strong></p><p>Your copy has its own saved beats.</p><p><a href="https://yaks.app">Connect yaks.app ↗</a></p></div>',
      ),
  )
  click('library', async () => {
    modal('The beat shelf', '<p class="sub">Opening saved beats…</p>')
    let rows = await storage.list()
    $('modal-body').innerHTML =
      '<p class="sub">Public beats from this studio. Open any one to make your own remix.</p>' +
      (rows.length
        ? rows.map((row) =>
          `<div class="modal-row"><div><strong>${
            esc(row.doc?.title || 'Untitled beat')
          }</strong><p>${row.composition.tempo} BPM · ${
            esc(row.created?.at?.slice(0, 10) || '')
          }</p></div><button data-open="${row.entity.eid}">Open ↗</button></div>`
        ).join('')
        : '<p class="modal-prose">Your first beat belongs here. Make a change or press Save beat.</p>')
  })
  $('modal-body').addEventListener('click', async (e) => {
    let open = e.target.closest('[data-open]'),
      exporting = e.target.closest('[data-export]')
    try {
      if (open) {
        open.disabled = true
        let next = await storage.load(open.dataset.open)
        await switchSong(next)
        close()
      }
      if (exporting) {
        if (exporting.dataset.export === 'json') {
          download(
            JSON.stringify(getSong(), null, 2),
            'application/json',
            '.soundlab.json',
          )
          return
        }
        exporting.disabled = true
        exporting.textContent = 'Rendering your audio…'
        let mode = exporting.dataset.export,
          buffer = await render(structuredClone(getSong()), { mode })
        download(
          wav(buffer),
          'audio/wav',
          mode === 'chain' ? '-song.wav' : `-${letters[getSong().pattern]}.wav`,
        )
        close()
        status('WAV exported · stereo, 44.1 kHz · includes the echo tail.')
      }
    } catch (error) {
      fail(error)
      if (open) open.disabled = false
      if (exporting) {
        exporting.disabled = false
        exporting.textContent = 'Try export again'
      }
    }
  })
  click(
    'export',
    () =>
      modal(
        'Take your sound with you.',
        `<div class="exports"><button data-export="pattern">Current pattern → WAV<small>Pattern ${
          letters[getSong().pattern]
        } · ${
          timeText(duration(getSong(), { mode: 'pattern' }))
        } + effect tail</small></button><button data-export="chain">Full arrangement → WAV<small>All eight scenes · ${
          timeText(duration(getSong(), { mode: 'chain' }))
        } + effect tail</small></button><button data-export="json">Project file → JSON<small>Keep every note and setting. Import it to continue anywhere.</small></button><label class="sub">Import a Sound Lab project<input id="import" type="file" accept=".json,application/json"></label></div>`,
      ),
  )
  $('modal-body').addEventListener('change', async (e) => {
    if (e.target.id !== 'import' || !e.target.files[0]) return
    try {
      let file = e.target.files[0]
      if (file.size > 1e6) throw new Error('This project file is too large.')
      let next = validate(JSON.parse(await file.text()))
      await switchSong(next)
      changed()
      close()
    } catch (error) {
      fail(error)
    }
  })
  click(
    'help-button',
    () =>
      modal(
        'Your pocket studio, in a minute.',
        `<div class="modal-prose"><p><strong>Start with play.</strong> Four pattern banks are already full of ideas. Choose a starter groove for a different mood.</p><p><strong>Write the rhythm.</strong> Each square is a sixteenth note. Click to add or remove a hit. Shift + click selects it for velocity or pitch editing. Bass and Keys play notes; the other lanes are drums.</p><p><strong>Shape the sound.</strong> Swing loosens the timing. Echo adds space. Each mixer lane has level, pan and tone, with Mute and Solo buttons.</p><p><strong>Make a song.</strong> Copy a bank, change a few notes, and set the letters in the eight-scene arrangement. Switch Pattern loop to Song loop to hear the whole sequence.</p><p><strong>Play it in.</strong> Press <kbd>A S D F G H J K</kbd> or tap a pad. Arm Record while playing to place hits at the nearest step. <kbd>Space</kbd> starts and stops; <kbd>Ctrl / ⌘ Z</kbd> undoes an edit.</p><p><strong>Watch what you hear.</strong> Wave shows the output waveform, Spectrum shows its frequencies, and Level shows loudness and peak. These read the audio output after the master limiter.</p><p><strong>Keep it.</strong> Edits save automatically as a new public beat. Copy the page address to return. Open a beat to remix it without changing its source. Export a WAV or a project file anytime.</p></div>`,
      ),
  )
}
