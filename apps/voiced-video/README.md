# Voiced Video

A short video made from a request, as a workflow of builders (D-467): the person
gives a title and what it is about, a model writes the script, voices audition
for each character, the person chooses each voice, every line is voiced in it,
and the voiced lines are assembled in script order. The page plays the cut, each
line shown as it is said.

The app lives in `jeff/voiced-video`.

- `seed.json` writes the four steps, each an `immediate` builder, and a
  `requires` edge from each step to every step it reads, which the app's page on
  yaks.app draws under "How it runs". A store is seeded once, so a change to a
  step reaches an existing copy only as an edit of its builder row.
- `worker.js` answers the three code steps (`/audition`, `/voice`, `/assemble`),
  commands declared in `vocab.json`. Voices come from ElevenLabs through
  `./api/speech`, so the space needs its own ElevenLabs connection; without one
  each step fails with the platform's reason, shown on the page.
- The person's choice of voice is a `decision` the auditions step answers,
  assigned to whoever asked for the video and asked in their Updates. Answering
  it there or on the page writes `decided{choice}`, which the line step's query
  matches.
- `workflow_test.ts` runs the whole workflow on the platform in memory, the
  script step answered by a stand-in for the model.
