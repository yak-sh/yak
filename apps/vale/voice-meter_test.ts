import { assert, assertEquals } from '@std/assert'
import { voiceMeter } from './voice-meter.ts'

Deno.test('the waveform and talking state follow audio samples, not a voice flag', () => {
  let data = new Uint8Array(256).fill(128)
  let analyser = {
    fftSize: data.length,
    getByteTimeDomainData: (out: Uint8Array) => out.set(data),
  } as unknown as AnalyserNode
  assertEquals(voiceMeter(analyser).talking, false)
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.round(128 + Math.sin(i * Math.PI / 13) * 60)
  }
  let heard = voiceMeter(analyser)
  assert(heard.talking)
  assert(new Set(heard.points.split(' ').map((p) => p.split(',')[1])).size > 4)
})
