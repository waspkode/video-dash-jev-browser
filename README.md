# Jev local · VideoExpress

A local, Jev-style inspector that runs the VideoExpress production workflow
with **Julia 1** and **d1-2B** as the decision models instead of the hosted Jev
policy.

One visible Chromium window, one brief, one unit at a time:

```
observe the page -> ask Julia 1 (or d1-2B) -> execute one verified flow unit -> record
```

The models only answer narrow questions the workflow already needs (start this
unit, wait/retry/stop on this message, was the clip accepted). They never name a
selector. All DOM work stays in `lib/flow-videoexpress.js`, copied byte-for-byte
from the verified clone.

## Source folders are read-only

Nothing here writes to these folders:

| Folder | Used for |
| --- | --- |
| `C:\Users\LENOVO\Downloads\jev-ultrafast-main` | The architecture and dashboard language: one observation, a typed decision, a bounded executor, a live inspector. |
| `C:\Users\LENOVO\Downloads\codex-browser-clone-v5-copy` | The VideoExpress step order, selectors, brief grammar and decision-task questions. The needed files were copied into `lib/`. |
| `C:\Users\LENOVO\Downloads\Julia-1` | The local Julia 1 checkpoint. Loaded in place; never modified. |

## Requirements

- Node.js 20+ and Playwright Chromium (`npx playwright install chromium`)
- Python 3.11+ with the Julia package installed (already true on this machine)
- Optional: a local llama.cpp `/v1/systemone` server for d1-2B on
  `http://127.0.0.1:8080` (native vision), or a d1 model pulled in Ollama
  (text decisions only)
- A VideoExpress account. Sign in once in the opened browser window; the profile
  stays in `state/profile/`.

## Run

```bash
npm install
npx playwright install chromium
npm start
```

Open <http://127.0.0.1:4318>.

1. The example brief loads automatically. Paste your own or press **Example**.
2. **Start run** parses the brief and opens the visible browser.
3. Sign in inside that window if the app asks. Press **Start run** again if the
   first navigation landed on the login page.
4. **Step** runs one unit. **Run** works through the rest.
   **Pause** stops after the current unit; **Stop after unit** stops the run at
   the same boundary. A unit is never interrupted mid-generation.
5. **Close browser** closes the owned window. The profile is kept.

One visible Chromium window, one brief, one unit at a time:

```
observe the page -> ask Julia 1 (or d1-2B) -> execute one verified flow unit -> record
```

While the run is alive the window stays open (the driver is started with
`KEEP_BROWSER_OPEN=1`; the owned tab keeps its VideoExpress login from
`state/profile/`). **Close browser** is operator-initiated only.

Each unit is a credit-spending boundary: the character sheet, then each scene's
image and its videos. The dashboard shows the parsed units before anything is
spent.

## Image + Video Combo

The default flow step is **Image + Video Combo** (toggle in **Settings ->
Flow steps**; on = combo, off = separated steps).

- Combo (on, default): the scene image prompt is typed, **Create Image** is
  clicked, and the **video prompt** is typed in the same browser session,
  immediately after the click (before the image render settles). When the render
  arrives, the saved image is the preview and **Create Video** is the only
  control clicked. The clips are then submitted back to back: clip 2 is clicked
  ~0.5 s after clip 1, inside one page session, waiting only while the app holds
  the button disabled.
- The video prompt is typed **once per scene**; the clip submission re-uses it
  and only re-types if the panel lost it.

Separated steps (combo off): each scene's image renders, gets saved, and the
clips are submitted with the video prompt typed right before each Create Video.

Never navigate the preview carousel: after the render arrives the newest image is
the preview and the flow only presses **Create Video** (and, when needed, the
panel's checkmark **Save** to point the app at the saved render).

## Decisions

The chain is **primary -> fallback**, both configurable in the dashboard:

| Model | Transport | Role |
| --- | --- | --- |
| Julia 1 | Local Python worker (`lib/julia-bridge.py`), kept warm | Default. First call loads the checkpoint (~45 s on CPU); later decisions are sub-second. |
| d1-2B | llama.cpp `/v1/systemone` (native text + images) or Ollama (text only) | Fallback. When `systemone` is available its native vision also reviews each saved scene image, advisory only. |

Decision checkpoints:

- **Proceed** (pure code) before a unit spends a credit: the unit's prompts must
  exist. Calibration showed Julia 1 keys on surface tokens ("saved", prompt
  length) rather than prompt completeness, so this gate is not handed to a model.
- **Diagnose** (`choice`: wait / retry / stop) when a unit throws or the app
  refuses. The deterministic detector is the judge; a model may only make the
  answer more careful.
- **Check video** (`choice`: processing / done / rejected) after clips are
  submitted. An unconfirmed submit can never be upgraded to "done".
- **Image review** (`noul`, d1 native vision only) after a scene image is saved.
  Advisory: it is recorded and shown, but never blocks the run.

If neither model is reachable, the deterministic answer runs and the dashboard
names the skipped engine. It never pretends a model answered.

## Dashboard

- Live JPEG view of the controlled page
- Numbered element table, like Jev's observation
- The latest decision with the model's probabilities and latency
- Parsed unit list with waiting / now / done / failed
- Trace of decisions, logs and every annotated browser action

## Brief format

A character block, then scenes. A scene has an `Image:` prompt and a `Video:`
prompt; the spoken line is composed into the end of the video prompt. See
`briefs/example.md`.

```text
# Character
Ratio: Landscape 16:9
Appearance: <character sheet prompt>
Voice: Ethan Sterling

# Scene 1
Length: 8
Style: photo
Image:
<the still frame>

Video:
<the action, camera move and audio>

Mara says: "One spoken sentence."
```

## Limits

- The executor is deterministic by design; the models diagnose failures, watch
  the video queue and review saved images. They do not invent clicks. That is
  what keeps a bad answer from spending credits on a wrong control.
- **Stop** takes effect after the current unit. Generation is never interrupted
  halfway.
- d1 image review only works on the native `systemone` transport. With Ollama
  the review is skipped by name.
- One browser window and one run per server process. There is no MCP surface and
  no cloud call.
- The verified flow was tested against the live app by its author, but this
  dashboard cannot test generation without spending credits. The first run on a
  new account should be a short, single-scene brief.

## Test

```bash
npm test
```

Offline checks: brief parse, unit split, deterministic decision detectors, the
model-answer judge, and the `runProgram` adapter. Model calls and browser work
are not part of it.

## Environment

| Variable | Default |
| --- | --- |
| `PORT` | `4318` |
| `VIDEOEXPRESS_URL` | `https://app.videoexpress.ai/` |
| `JULIA_PYTHON` | `python` |
| `JULIA_MODEL_DIR` | `C:/Users/LENOVO/Downloads/Julia-1/Julia-1` |
| `JULIA_START_TIMEOUT_MS` | `240000` |
| `D1_BASE_URL` | `http://127.0.0.1:8080` |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` |
| `D1_OLLAMA_MODEL` | `d1-2b` |
| `PROGRAM_TIMEOUT_MS` | `600000` |
| `KEEP_BROWSER_OPEN` | `1` |

## Local-only models

No hosted inference and no AI keys: decisions come only from the local Julia 1
checkpoint (`lib/julia-bridge.py` → `C:/Users/LENOVO/Downloads/Julia-1/Julia-1`)
and the local d1-2B (`http://127.0.0.1:8080/v1/systemone` or Ollama). `decision-models.json`
in `app/` lists the engines the dashboard offers; the pre-credit gates and the
deterministic failure detectors run in code when no engine is reachable.
