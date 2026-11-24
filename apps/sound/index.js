import store from './lib/data-store.js'
import vars from './lib/css-var.js'
import { createPitchDetector, noteName } from './lib/pitch.js'

store()
vars()

let ffsSize = 16384

let dpr = 1 // devicePixelRatio || 1
let width = output.width = innerWidth * dpr
let height = output.height = Math.min(main.clientHeight * dpr, ffsSize / 2)
let buffer = new Uint8Array(height)
let liveBuffer = Uint8Array.from(buffer)
let outputCtx = output.getContext('2d')
let bufferCtx = cloneCtx(outputCtx)

let analyser
let readPitch
let color = getColor()
const microphonePrompt = document.getElementById('microphone-prompt')
const microphoneStatus = document.getElementById('microphone-status')
const microphoneRetry = document.getElementById('microphone-retry')
const currentNote = document.getElementById('current-note')

outputCtx.scale(dpr, dpr)
save.onclick = () => save.href = output.toDataURL('image/png')
microphoneRetry.addEventListener('click', startMicrophone)
startMicrophone()

async function startMicrophone() {
  microphoneRetry.disabled = true
  microphoneStatus.textContent = 'Waiting for microphone access…'
  if (!navigator.mediaDevices?.getUserMedia) {
    microphoneStatus.textContent =
      'Microphone access is unavailable here. Open Audio Spectrogram directly in a browser that supports microphones.'
    return
  }

  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
      case 'SecurityError':
        microphoneStatus.textContent =
          'Microphone access was blocked. Allow it in your browser or device settings, then try again.'
        break
      case 'NotFoundError':
        microphoneStatus.textContent =
          'No microphone was found. Connect or enable one, then try again.'
        break
      default:
        microphoneStatus.textContent =
          'The microphone could not start. Check that it is connected and available, then try again.'
    }
    microphoneRetry.hidden = false
    microphoneRetry.disabled = false
    return
  }

  const audio = new AudioContext()
  const source = audio.createMediaStreamSource(stream)
  analyser = audio.createAnalyser()
  analyser.smoothingTimeConstant = 0
  analyser.ffsSize = ffsSize
  source.connect(analyser)
  readPitch = startPitchReadout(audio, source, stream.getAudioTracks()[0])
  microphonePrompt.hidden = true
  draw()
}

function startPitchReadout(audio, source, track) {
  const pitchAnalyser = audio.createAnalyser()
  pitchAnalyser.fftSize = 16384
  source.connect(pitchAnalyser)
  const samples = new Float32Array(pitchAnalyser.fftSize)
  const detectPitch = createPitchDetector(audio.sampleRate)
  let previous = null
  let displayed = null
  let unsettled = 0
  let nextSample = 0

  return (now) => {
    if (now < nextSample) return
    nextSample = now + 65
    let note = null
    if (
      audio.state === 'running' && track?.readyState === 'live' && !track.muted
    ) {
      pitchAnalyser.getFloatTimeDomainData(samples)
      note = detectPitch(samples)
    }
    // Wait for two matching reads, but don't leave a stale note on screen
    // when several frames in a row disagree with it.
    unsettled = note === displayed ? 0 : unsettled + 1
    if (note === previous || unsettled >= 3) {
      displayed = note === previous ? note : null
      const text = displayed === null ? 'No clear note' : noteName(displayed)
      if (currentNote.textContent !== text) {
        currentNote.textContent = text
        currentNote.toggleAttribute('data-empty', displayed === null)
      }
      unsettled = 0
    }
    previous = note
  }
}

function draw(now = performance.now()) {
  readPitch(now)
  analyser.minDecibels = -sensitivity.value
  color = getColor()
  analyser.getByteFrequencyData(buffer)
  drawSpectrogram(bufferCtx)
  outputCtx.clearRect(0, 0, width, height)
  outputCtx.drawImage(bufferCtx.canvas, 0, 0)
  if (live.checked) drawLive(outputCtx)
  requestAnimationFrame(draw)
}

function drawSpectrogram(ctx) {
  ctx.drawImage(ctx.canvas, -1, 0)

  ctx.save()
  ctx.translate(width - 1, 0)
  drawBuffer(ctx)
  ctx.restore()
}

function drawBuffer(ctx) {
  let max = { v: 0, y: 0 }
  ctx.save()
  for (let y = 0; y < height; y++) {
    let v = buffer[y]
    if (v > max.v) max = { v, y }

    ctx.globalAlpha = 1
    ctx.fillStyle = color.bg
    ctx.fillRect(0, y, 1, 1)
    ctx.fillStyle = color.fg
    ctx.globalAlpha = v / 255
    ctx.fillRect(0, y, 1, 1)
  }

  if (globalThis.max.checked) {
    ctx.globalAlpha = 1
    ctx.fillStyle = color.accent
    ctx.fillRect(0, max.y, 1, 1)
  }

  ctx.restore()
}

function drawLive(ctx) {
  ctx.beginPath()
  // ctx.moveTo(width, 0)

  for (let y = 0; y < height; y++) {
    let v = liveBuffer[y] = Math.max(buffer[y], liveBuffer[y])
    let x = width - v

    ctx.lineTo(x, y)

    // let bg = ctx.createLinearGradient(x, 0, width, 0)
    // bg.addColorStop(0, color.accent + '00')
    // bg.addColorStop(0.1, color.accent)
    // bg.addColorStop(0.9, color.accent + '44')
    // ctx.fillStyle = bg
    // ctx.fillRect(x, y, v, 1)
    liveBuffer[y] *= 0.9
  }
  ctx.lineWidth = 2
  ctx.strokeStyle = color.accent
  // ctx.lineTo(width, height)
  ctx.stroke()
}

function cloneCtx(ctx) {
  let canvas = document.createElement('canvas')
  canvas.width = ctx.canvas.width
  canvas.height = ctx.canvas.height
  return canvas.getContext('2d')
}

function getColor() {
  let style = getComputedStyle(output)
  return {
    fg: style.getPropertyValue('--fg'),
    bg: style.getPropertyValue('--bg'),
    accent: style.getPropertyValue('--accent'),
  }
}
