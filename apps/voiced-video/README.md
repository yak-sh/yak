# Voiced Video

A short video made from an idea, as a [@yaks/workflow](../../packages/workflow)
whose steps are rows: the idea, the script, the storyboard (`panel`s, each a
browser recording of a web page or a still), casting (voice auditions and the
person's choice), voice lines, recording, assembly and the finished file. Every
step's output is a row the page shows and lets the person change: the idea, a
line, a panel's steps, the choice of voice. A step runs once for each set of
values its match binds, so a change reruns only the steps that read what
changed: editing a line says that line again and recuts, and leaves the other
lines and every take as they were.

The app lives in `jeff/voiced-video`.

- `seed.json` writes the workflow and its seven steps, each a
  `step{match, write}` the workflow `contains`. Five steps write a `call` to a
  command of the app's worker; Recording and Finished file write a `take` or
  `film` task the studio answers. A store is seeded once, so a change to a step
  reaches an existing copy only as an edit of its row.
- `worker.js` answers the commands declared in `vocab.json`: the script and the
  storyboard from a model (`./api/ai/run`), auditions and voice lines from
  `./api/speech` (the space's own ElevenLabs where connected, else the
  platform's Deepgram and OpenAI voices), and the cut, timed from each line's
  length (`model.js` `timeline`). Each writes what it makes through `env.APP`,
  replacing what it made before for the same item.
- The person's choice of voice is a `decision` the auditions step writes, asked
  in their Updates. Answering it there or on the page writes `decided{choice}`,
  which the voice step's match reads.
- `studio.ts` is the studio, run where the `yak` CLI holds the platform's admin
  connection: it films each open take in Cloudflare's browser
  (`yak admin browse --record`), encodes it with ffmpeg and keeps it at the
  app's `./api/blob`, then renders each open film: the takes held or trimmed to
  the cut, the voiced lines laid in, captions burned. A shot is opened as the
  fleet account its `as` names (the demo space's is `yourname`), so only the
  platform's own studio can film them.

      deno run -A apps/voiced-video/studio.ts jeff/voiced-video [--once]

- `workflow_test.ts` runs the whole workflow on the platform in memory, the
  model and speech answered by stand-ins and the studio's two tasks by the test.
