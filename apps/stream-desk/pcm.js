// Hands on each tenth of a second the microphone hears as 16-bit PCM, for
// ear.js to send to ./api/speech/listen.
registerProcessor(
  'pcm',
  class extends AudioWorkletProcessor {
    held = []
    process([input]) {
      let samples = input[0]
      if (samples) this.held.push(...samples)
      if (this.held.length >= sampleRate / 10) {
        let pcm = Int16Array.from(
          this.held,
          (x) => Math.max(-1, Math.min(1, x)) * 0x7fff,
        )
        this.held = []
        this.port.postMessage(pcm.buffer, [pcm.buffer])
      }
      return true
    }
  },
)
