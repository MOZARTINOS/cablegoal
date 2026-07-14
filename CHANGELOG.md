# CHANGELOG

## v9.1 — pre-launch audit pass
Cross-browser, honesty and repo-hygiene pass before the public/open-source launch.

- **Voting backend rewritten for honesty + reliability** (`netlify/functions/vote.mjs`):
  - Counter is now updated with an optimistic compare-and-swap (`onlyIfMatch` etag,
    5 retries) instead of a plain read-modify-write — concurrent votes are no longer
    lost during a traffic spike.
  - Server-side per-browser dedup via an HttpOnly `cgv` token cookie: the server
    remembers each browser's current choice, so re-votes only ever move one vote.
    The client `prev` field is no longer trusted.
  - Per-IP rate limit tightened 8 → 3 writes/min.
  - Tally now tracks per-country counts from Netlify edge geo (`{hit, no, byCountry}`).
- **Dashboard is real-data only** (`index.html`): removed the seeded demo leaderboard,
  fake session feed and client-side `demoHit/demoClean` numbers. The dashboard now
  shows the live global split and a per-country leaderboard from the backend, with an
  empty state until real votes arrive. Voting is anonymous (choice + edge-geo country).
- **Safari / mobile compatibility:** added the missing `-webkit-backdrop-filter`
  prefix to every glass panel (iOS 15–17 now renders the blur); restored pinch-zoom
  by dropping `maximum-scale/user-scalable=no` (a11y); WebGL context-loss now shows a
  visible reload overlay instead of a hidden status line.
- **Repo hygiene for the public release:** `.env` added to `.gitignore`; README credits
  the real audio sources (Alanga Music anthems; Viking Row / Sweet Caroline chants) as
  a fan tribute and removed dead links to the private `CLAUDE.md`; in-app Settings now
  carries an audio-credit line; `og.png` optimized.
- Dead code removed and public version metadata unified to **9.1-forensic**.

## v9.0 — forensic + community build
Physics, presentation and community layer over v8.

- Full-team flight choreography (all 22 players traverse the pitch during the 2.6 s
  flight) + a ~430 ms wind-up phase so the ball launches off Nyland's foot.
- Goals seated on the bylines with keepers standing in front of the nets.
- Share card: square 1080×1080 only, verdict-inverted "alternate reality" scoreline,
  EN/NO interface copy, clipboard invite with the cablegoal.com link and an inlined QR.
- Bilingual (EN/NO) Case File wiki (story / timeline / camps / facts) with a toolbar entry.
- Positional stadium audio: pre-goal fan chants + goal-triggered anthems (offline base64).
- Community vote counter (Netlify Functions + Blobs) surfaced in the result panel.
- Drag-crisis aerodynamics for the Trionda ball; sloped spidercam cable geometry.

---

# CHANGELOG — v8.0 (production pass over v7.2)

## Localization: Russian fully removed, EN + NO only
Root cause of the leakage: the i18n dictionary (74 keys × 3 locales) was complete, but (a) `ru` was the default and the `tr()` fallback locale, (b) ~30 strings in the app script and 8 boot-loader stage messages were hardcoded in Russian outside the dictionary, (c) 21 static HTML nodes had no `data-i18n` and kept their initial Russian text, and (d) many runtime strings used `lang==='no'?X:lang==='en'?Y:РУ` triples whose Russian tail rendered for any non-en/no browser.

- Default language is now **English**; **Norwegian (bokmål)** is selected automatically for `no/nb/nn` browser locales and via the NO/EN switcher; the choice persists (guarded `localStorage`).
- `ru` locale deleted from `TEXT` and `SEQ_TEXT`; `tr()` falls back to `en`. The RU button was removed.
- All hardcoded Russian strings replaced with EN/NO pairs: boot stages (ENGINE/WEBGL/SCENE/PITCH/STADIUM/STANDS/PLAYERS/DETAILS/FINAL), startup errors and the 25 s timeout message, verdicts (CABLE CONTACT / TREFFER VAIEREN, misses the cable / forbi vaieren), clearance templates ("on the cable line (Δ …)" / "på vaierlinjen (Δ …)", "passes above/below by …" / "går over/under med …"), OUT / throw-in / goal-line cards, camera-restored and 360°-active toasts, HUD defaults, units (м → m, м/с → m/s), aria-labels, `<title>`, `<html lang>`, and code comments.
- All 87 static Russian HTML nodes rewritten in English (runtime i18n still switches them to Norwegian).
- The boot loader now detects `no/nb/nn` itself, so even the first loading frames are EN/NO.
- Verified by scan: **zero Cyrillic characters in the file** and zero in rendered `innerText` for both locales.

## Bug fixes
1. **Idle telemetry overwrote the forensic preview** (regression source of "apex 0.0"): `updateTelemetry()` was called outside the phase guard, so at idle it overwrote the preview apex (21.7 m) with `apexH = 0` every 90 ms. Moved inside the active-phase block. Preview at defaults now correctly shows apex 21.7 m / 16.8 m at the cable.
2. **Analysis panel showed the continuation-attack apex** instead of the primary kick's. The primary apex is now frozen (display-side only) once the ball crosses the cable plane and cleared on reset; physics untouched.
3. **WebGL context loss** was unhandled. Added `webglcontextlost` / `webglcontextrestored` handlers: prevented default, a localized status message, size restore and a "CAMERA RESTORED / KAMERA GJENOPPRETTET" toast.
4. **Crowd rendered dark / invisible from gameplay cameras.** Root cause: the bowl and animated-fan `InstancedMesh` groups used lit `MeshStandardMaterial` + per-instance colors, which reads near-black under low ambient and is the fragile instancing+lighting+instanceColor path on WebGL1/Safari. All crowd instanced groups now use unlit `MeshBasicMaterial` (slightly toned via material color) — colors can never go black regardless of lighting or tone mapping — and the bowl's `instanceColor.needsUpdate` is now set after the initial fill (it previously was not, so some drivers could skip the color upload entirely).
5. **Washed-out scene:** `FogExp2` density reduced 0.0039 → 0.0029; the stands and roof no longer dissolve into haze from the Stand camera.
6. **Flag overlaps:** flag placement rewritten with a deterministic layout plus a minimum-distance check (5.2 m) between all flags; alternating heights/depths kept, no placement inside the roof band.
7. **Stuck gestures:** orbit pointer state (drag/pinch/pointer map) is now released on window `blur` and when the document becomes hidden, in addition to the existing `pointerup`/`pointercancel`.
8. **Double-tap** on the canvas performs a soft reset of the current camera (orbit → default yaw/pitch/distance; fixed cams → their canonical pose).
9. **Mobile UI hardening:** `#evidencePanel`, `#settings`, `#resultPanel`, intro panel constrained to `max-width: calc(100vw − 16px)` and `max-height: calc(100dvh − 76px)` with internal scrolling; safe-area insets on the top bar and bottom docks; `overscroll-behavior: none`; camera tabs enlarged to ≥44×44 px touch targets.
10. **`visualViewport` resize** hooked (aspect + renderer size) for iOS keyboard/rotation correctness.

## Explicitly NOT changed (invariants verified after the build)
`FIELD_L=105, FIELD_W=68, ORIGIN=(6,0.35,34), GOAL_X=99, goal mouth z=30.34..37.66, GOAL_H=2.44, CABLE_X=55, CABLE_Y=17.0, HIT_TOL=1.15, G=9.81, K=0.006, FIXED=1/120` with accumulator, defaults `30 / 49° / 2°`, kits, scenario branching (cable → England attack + "goal should be disallowed"; clean → Norway counter). End-to-end default run reproduces the canonical outcome: apex 21.6 m, 16.7 m at the cable, Δ −0.3 m, CABLE CONTACT → NOR 1–2 ENG.
