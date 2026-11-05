import store from './lib/data-store.js'
import vars from './lib/css-var.js'

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

let stream = await navigator.mediaDevices.getUserMedia({ audio: true })
let audio = new AudioContext()
let source = audio.createMediaStreamSource(stream)
let analyser = audio.createAnalyser()
let color = getColor()

analyser.smoothingTimeConstant = 0
analyser.ffsSize = ffsSize
source.connect(analyser)
outputCtx.scale(dpr, dpr)

save.onclick = () => save.href = output.toDataURL('image/png')

draw()

function draw() {
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
