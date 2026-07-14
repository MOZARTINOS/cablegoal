# Cable Goal — interactive 3D reconstruction

**[▶ Try it live at cablegoal.com](https://cablegoal.com)** · free · runs in your browser · no install

An interactive **3D forensic reconstruction** of the disputed goal in
**Norway 1–2 England**, World Cup 2026 quarter-final (11 July 2026, Hard Rock
Stadium, Miami).

On 45+2, Norway keeper **Ørjan Nyland**'s goal kick appeared to clip an overhead
**Spidercam / TV camera cable**. The ball dropped to Elliot Anderson → Anthony
Gordon → **Jude Bellingham**, who scored to make it 1–1 (England won 2–1 in extra
time). FIFA's Connected-Ball sensor showed "no peak" → no contact → the goal
stood. By IFAB law, a ball touching an outside agent should stop play for a
dropped ball — so many argue the goal should have been disallowed.

**This app lets you re-kick Nyland's ball** — adjust power, angle and aim, see
whether your trajectory clips the cable, and watch each branch play out (cable
hit → England attack; clean → Norway counter). Then cast your vote:
**was there contact, or not?**

---

## Vote: contact or no contact?

The app has a live community vote persisted server-side. The running tally is
shown in the result panel — you decide what really happened at 45+2.

## Features

- Full 3D stadium with crowd, floodlights and broadcast-style cameras
- Physically-based ball flight (gravity + drag, fixed 120 Hz step)
- Models the real drag-crisis aerodynamics of the adidas Trionda ball
- Sloped **spidercam cable** geometry (aerial 4-cable rig, not a flat wire)
- Positional stadium audio: fan chants pre-goal, team anthem on a goal
- English + Norwegian (auto-detected), mobile-friendly, fully offline
- Zero external dependencies — the whole app is one `index.html`

## Run locally

No build step, no server needed:

```
# clone, then just open the file
git clone https://github.com/<your-user>/cablegoal.git
cd cablegoal
# open index.html in any modern browser (double-click, or:)
start index.html      # Windows
open index.html       # macOS
```

## Contributing — help make it better

This is open-source **on purpose**. If you can improve the physics, the 3D
models, the accuracy of the reconstruction, mobile performance, translations —
anything — **pull requests and issues are very welcome.** No contribution is too
small.

Good first areas to dig into:

- **Player/ball motion** — more natural inertia, loose-ball behaviour
- **Rigged 3D player models** (CC0 / open-licensed GLTF) to replace the
  procedural figures
- **Cable geometry accuracy** — real contact point and drop direction
- **Physics tuning** against the published launch/trajectory estimates
- **Translations** beyond EN/NO

The entire app lives in **`index.html`** (Three.js r128 is inlined). Edit the app
code, not the inlined library blob. See [`CLAUDE.md`](CLAUDE.md) for the physics
constants, architecture invariants and the forensic reference data.

## Accuracy & disclaimer

This is a **best-effort reconstruction for public discussion**, not an official
finding. Contact coordinates, cable slope and launch parameters are estimates
drawn from public footage and reporting; confirmed vs. estimated facts are tagged
in [`CLAUDE.md`](CLAUDE.md). It is not affiliated with FIFA, UEFA, or any club or
federation.

## Credits & audio

- Reconstruction & code: **Alexeev Digital Lab**
- Fan chants and national-anthem clips used in the app are third-party recordings;
  rights remain with their respective owners. Contributors redistributing the repo
  should replace them with CC0 / royalty-free equivalents.

## License

Application code is released under the **MIT License** (see `LICENSE`).
Third-party audio clips are **not** covered by this license (see *Credits & audio*).
