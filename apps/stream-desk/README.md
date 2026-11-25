# Stream Desk

A livestream's crew switches OBS scenes and moves its PTZ camera from their
phones. Each button is a shot: an OBS scene, a camera preset, or both. There are
also zoom buttons. The app lives in `jeff/stream-desk`.

- A press writes a `cue` to the store. A phone never talks to OBS itself: the
  page is https, and a browser refuses `ws://` to another machine from it.
- The **desk** is the page opened on the computer running OBS and connected
  under "This computer runs OBS". It reaches OBS WebSocket v5 on localhost
  (`obs.js`), plays each cue into OBS in the order it was pressed, and marks it
  `aired{at}` or `missed{reason}` (`desk.js`). A cue pressed more than 30 s
  before the desk saw it is missed, not played.
- The camera is reached through OBS too: the obs-ptz plugin drives it (VISCA
  over IP, Pelco or ONVIF) and offers `ptz_preset_recall` and `ptz_move` as
  vendor requests on the same socket. A preset is recalled before its scene is
  cut to, so the camera moves off air.
- The desk writes what OBS has on air, and its scenes, in
  `desk{scene, scenes, seen}`, again every 30 s. A phone takes a desk not seen
  for 75 s as away. (`./api/client.js` sends every write to the store, so a
  `sync: peers` value would not be relayed from this page.)
- The Operator can watch (`watch.js`): every 10 s the desk takes a still of each
  shot's scene from OBS (`GetSourceScreenshot`, 512 px), adds what was said in
  the last minute, and asks Llama 4 Scout through `./api/ai/run` which shot
  should be on air. A different shot is written as a cue marked
  `suggested{why}`. The desk doesn't play it; every phone shows it with a Take
  button, and taking it clears the mark. The look's token counts show under the
  desk's form.
- With "listens" checked, the desk hears the Mac's sound input live through
  `./api/speech/listen` (`ear.js`, `pcm.js`). The transcript stays in the desk's
  memory; only the last minute goes with each look.
- `seed.json` writes four shots to rename or replace: Projector, Stage wide,
  Pulpit and Picture in picture.
- `desk_test.ts` runs the app's vocab and seed on the platform in memory,
  against `mock_obs.ts`: an OBS that asks for a password, has an obs-ptz camera,
  and answers a one-colour still for each scene.
  `deno run --allow-net apps/stream-desk/mock_obs.ts` serves it at
  ws://localhost:4455 (password `desk`) for trying the page by hand.
