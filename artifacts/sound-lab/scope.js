export let scope = ({ canvas, audio, getView, playing, update }) => {
  let pen = canvas.getContext('2d'),
    wave = new Float32Array(2048),
    bins = new Uint8Array(1024)
  let width = 0, height = 0, last = 0, held = 0, alive = true
  let reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    .matches
  let resize = () => {
    let rect = canvas.getBoundingClientRect(),
      ratio = Math.min(globalThis.devicePixelRatio || 1, 2)
    width = rect.width
    height = rect.height
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    pen.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  let observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  let text = (words, x, y, color = '#879a75') => {
    pen.fillStyle = color
    pen.font = '10px monospace'
    pen.fillText(words, x, y)
  }
  let draw = (now) => {
    if (!alive) return
    requestAnimationFrame(draw)
    if (document.hidden || now - last < (reduced ? 100 : 33)) return
    last = now
    update()
    let analyzer = audio.analyzer(), view = getView(), peak = 0, sum = 0
    wave.fill(0)
    bins.fill(0)
    if (analyzer) {
      analyzer.getFloatTimeDomainData(wave)
      analyzer.getByteFrequencyData(bins)
    }
    for (let sample of wave) {
      peak = Math.max(peak, Math.abs(sample))
      sum += sample * sample
    }
    let rms = Math.sqrt(sum / wave.length),
      db = rms > .00001 ? 20 * Math.log10(rms) : -Infinity
    held = Math.max(peak, held * .94)
    pen.clearRect(0, 0, width, height)
    pen.strokeStyle = '#2d3d2b'
    pen.lineWidth = 1
    for (let i = 0; i <= 8; i++) {
      pen.beginPath()
      pen.moveTo(i * width / 8, 0)
      pen.lineTo(i * width / 8, height)
      pen.stroke()
    }
    for (let i = 1; i < 4; i++) {
      pen.beginPath()
      pen.moveTo(0, i * height / 4)
      pen.lineTo(width, i * height / 4)
      pen.stroke()
    }
    pen.strokeStyle = '#c2df9b'
    pen.fillStyle = '#c2df9b'
    pen.lineWidth = 1.6
    if (view === 'wave') {
      pen.beginPath()
      for (let i = 0; i < wave.length; i++) {
        let x = i / (wave.length - 1) * width,
          y = height / 2 - wave[i] * height * .46
        i ? pen.lineTo(x, y) : pen.moveTo(x, y)
      }
      pen.stroke()
      text('−1', 3, height - 5)
      text('+1', 3, 12)
    } else if (view === 'spectrum') {
      let count = 48, nyquist = (audio.context()?.sampleRate || 44100) / 2
      for (let i = 0; i < count; i++) {
        let low = Math.floor(
          30 * (nyquist / 30) ** (i / count) / nyquist * bins.length,
        )
        let high = Math.max(
          low + 1,
          Math.floor(
            30 * (nyquist / 30) ** ((i + 1) / count) / nyquist * bins.length,
          ),
        )
        let amount = 0
        for (let j = low; j < Math.min(high, bins.length); j++) {
          amount = Math.max(amount, bins[j])
        }
        let bar = amount / 255 * (height - 22)
        pen.fillStyle = i > 35 ? '#88b29d' : '#c2df9b'
        pen.fillRect(
          i * width / count,
          height - 17 - bar,
          Math.max(1, width / count - 2),
          bar,
        )
      }
      text('30 Hz', 2, height - 2)
      text('1k', width * .5, height - 2)
      text('20k', width - 25, height - 2)
    } else {
      let level = Number.isFinite(db)
        ? Math.max(0, Math.min(1, (db + 60) / 60))
        : 0
      for (let i = 0; i < 32; i++) {
        pen.fillStyle = i / 32 < level
          ? i > 28 ? '#f48966' : '#c2df9b'
          : '#2e3c2b'
        pen.fillRect(
          i * width / 32 + 1,
          height * .3,
          width / 32 - 3,
          height * .3,
        )
      }
      let marker = held > 0 ? Math.max(0, (20 * Math.log10(held) + 60) / 60) : 0
      pen.fillStyle = '#f48966'
      pen.fillRect(marker * width - 2, height * .26, 2, height * .38)
      text('−60', 0, height * .82)
      text('−30', width / 2 - 8, height * .82)
      text('0 dBFS', width - 39, height * .82)
    }
    if (!analyzer || (!playing() && peak < .00001)) {
      text(
        'Sound appears here. Press play or a pad.',
        Math.max(8, width / 2 - 115),
        height / 2 - 17,
      )
    }
    document.getElementById('meter').textContent = Number.isFinite(db)
      ? `${db.toFixed(1)} dB`
      : '−∞ dB'
    canvas.setAttribute(
      'aria-label',
      `Live output ${view}; ${
        Number.isFinite(db) ? db.toFixed(0) + ' decibels' : 'silent'
      }`,
    )
  }
  requestAnimationFrame(draw)
  return () => {
    alive = false
    observer.disconnect()
  }
}
