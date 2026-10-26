# Sound Lab

The playable studio at https://yourname.yaks.app/sound-lab/, published as
`sound-lab`. Its design begins with the Frequency homepage study and takes its
instrument direction from the owner's words in NOTES.md. It has no build step:
the browser modules, stylesheet, HTML, icon and vocabulary deploy together.

`music.js` owns scores and timing. `audio.js` uses one synthesis and mixing path
for live playback and offline WAV export; its analyser sits after the master
limiter. `scope.js` draws those samples and advances the visible playhead
against the audio clock. `app.js` connects editing and playback; `dialogs.js`
owns the beat shelf, import, export and guide.

`store.js` writes a composition and its four patterns and eight channels as one
transaction. A loaded beat is a source: its first edit writes fresh identities,
so playing with another visitor's beat never updates it. The demo is open and
saved beats are public. Edits autosave after 500 ms; unsaved work prompts before
leaving, and a project file is available if the network is unavailable. Bank
selection and playback mode are page state; project-file exports preserve both.

Playback stops when the page is hidden. Audio requires a browser with Web Audio;
WAV export requires OfflineAudioContext. Sounds are synthesized, with no sample
uploads, external sample service or MIDI input. Export includes two seconds for
release and echo tails. Wave and spectrum show the mixed output; the level view
shows RMS and peak of that same output, rather than individual-track meters.

Focused tests cover swing and arrangement boundaries, scheduling recovery,
source cancellation, stereo WAV encoding and graph persistence. In-process
rendering and DOM checks supplement them; no browser or listening verification
is claimed.
