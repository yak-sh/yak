export let transport = (audio, paint) => {
  let wanted = false, generation = 0
  let stop = () => {
    wanted = false
    generation++
    audio.stop()
    paint(false)
  }
  let toggle = async () => {
    if (wanted || audio.playing) return stop()
    wanted = true
    let request = ++generation
    paint('starting')
    try {
      await audio.start()
      if (request === generation && wanted && audio.playing) paint(true)
    } catch (error) {
      if (request === generation) stop()
      throw error
    }
  }
  return { toggle, stop }
}
