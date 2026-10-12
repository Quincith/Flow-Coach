# Flow Coach

A personal AI strength and conditioning coach. It reads your wearables automatically, scores every number against your own threshold table, and proposes the day's workout in chat. Approve it and you get a one-page workout PDF.

## How it works

```
iPhone app (Apple Health)  ─┐
Ultrahuman API             ─┼─> server: readings DB ─> rules engine (code) ─> coach (Claude) ─> chat + PDF
intervals.icu (Zepp, etc.) ─┘
```

- **Rules engine** (`server/src/rules.ts`): bands each reading against `server/config/thresholds.json` (absolute lines plus change vs your 30 day baseline, worse one wins). Flags vendor labels that disagree with your table, sources that disagree (Zepp vs ring sleep), missing sources (ring disconnected), trends, and multi-week red HRV.
- **Coach** (`server/src/coach.ts`): Claude gets the computed report, recent training and your rules (`server/config/coach-rules.md`) and writes the readiness read, the call and the plan. Approval ("yes", "lock it in") turns the agreed plan into structured data for the PDF.
- **PDF** (`server/src/pdf.ts`): one page. Header with the call, readiness strip, why today, session blocks, scale-down rule, tomorrow.
- **iPhone app** (`app/`): Expo + HealthKit. Reads every app that writes to Apple Health, keeps each source separate, syncs in the background, and hosts the chat.

## Data sources

| Source | Lane | Setup |
|---|---|---|
| Anything in Apple Health (Zepp, Ultrahuman, Oura, Garmin, Whoop, Apple Watch) | iPhone app | Allow Health access on first launch |
| Ultrahuman ring | `ULTRAHUMAN_TOKEN` | Personal token from vision.ultrahuman.com/developer |
| Zepp/Amazfit (and Garmin, Oura, Whoop, Polar, Suunto, Coros) | intervals.icu | Link Zepp in intervals.icu settings, then copy athlete id + API key |

## Run the server

```bash
cd server
npm install
cp .env.example .env   # fill in values
npm test               # rules engine tests
npm run sample-pdf     # out/flow-sample.pdf from sample data
npm start              # API on :8787
npm run morning -- --report-only   # sync + print today's computed report, no Claude call
```

API (all need `Authorization: Bearer $FLOW_API_TOKEN`): `POST /health`, `POST /sync`, `GET /today`, `POST /checkin`, `POST /chat`, `GET /pdf/:date`.

## Build the iPhone app

Needs a Mac with Xcode and the Apple Developer account.

```bash
cd app
npm install && npx expo install --fix
npx expo run:ios --device     # or: npx eas build -p ios --profile preview
```

On first launch enter the server URL and `FLOW_API_TOKEN`, then allow Health access.

## Status

Milestone 1 (data in + morning read) in progress. Starter threshold table and PDF layout are drafts awaiting approval.
