# SharpShot

Unlimited precision shooting challenges for your phone. Drag to aim, release to fire, and put every shot through the gaps in the wooden post to knock down the bottles, cans, balloons and more on the other side.

Inspired by the split-screen "hit all the bottles in fewer attempts" challenge videos, but with an endless supply of generated levels.

## Game modes

| Mode | What it is |
| --- | --- |
| **Endless** | A never-ending campaign. Each level is generated from its number, so level 37 is the same for everyone and always replayable. |
| **Duel** | Two players, one phone. Both get the exact same level; fewer shots to clear it wins the round. Ties go to sudden death. Running score is kept. |
| **Daily challenge** | One new level per day, identical for every player. |
| **Random & codes** | Pick a difficulty (Easy to Insane) and optionally a weapon, and get a fresh level. Every level has a code like `7-K3P9A2` that you can share and replay. |

Optional **camera background** shows the front camera behind the targets so both players appear on screen, like the original videos. Nothing is recorded or uploaded.

## What makes levels unlimited

Every level comes from a seed and a difficulty tier. The generator mixes:

- 8 weapons: pistol, revolver, sniper rifle (with sway), crossbow, shuriken, bow, slingshot and throwing knife. Guns fire straight with a little drop; the others arc, with pull length setting the power.
- 13 target types: bottles, cans, balloons, plates, apples, ducks, cups, vases, bulbs, clay discs, tomatoes, eggs and coins. Targets shrink as the tier rises.
- Target motion: bobbing, sliding, swinging on ropes, rising, flying across, orbiting.
- Obstacles: the signature wooden post with narrowing gaps, glass panes that cost a shot to break, sliding planks, spinning bars and walls to lob over.
- Wind, time limits, par shot counts and a shot cap.

Every target is placed on a trajectory the generator actually simulated with the same physics the game uses, so every level is solvable. The hint button (costs one shot) replays one of those trajectories.

## Install on iPhone

The app is a Progressive Web App, so it installs straight from Safari with no App Store:

1. Open the app's URL in **Safari** (once GitHub Pages is enabled, that is `https://aizad-eng.github.io/App/`).
2. Tap the **Share** button, then **Add to Home Screen**.
3. Launch it from the home screen. It runs full-screen and works offline.

### Enabling the hosted version (one-time)

The included GitHub Actions workflow deploys the `www/` folder to GitHub Pages on every push to `main`. To turn it on: repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. The first deployment runs on the next push (or from the Actions tab via "Run workflow").

## Run locally

Any static file server works, for example:

```bash
npm start            # serves www/ on http://localhost:8080
# or
python3 -m http.server 8080 --directory www
```

To test on your phone, open your computer's local IP on the same Wi-Fi network. Note that the camera background and installation need HTTPS (or localhost), so use the hosted version for those.

## Native iOS build (optional)

A Capacitor config is included for a real App Store style build. On a Mac with Xcode:

```bash
npm install
npm run ios:add      # creates the ios/ project (first time only)
npm run ios:sync     # copies www/ into the iOS project
npm run ios:open     # opens Xcode; run on your device
```

## Project layout

```
www/               the app (static, no build step)
  index.html       screens and HUD
  css/style.css
  js/rng.js        seeded random numbers + level codes
  js/levels.js     procedural level generator
  js/game.js       physics, input and rendering
  js/audio.js      synthesized sound effects
  js/app.js        modes, progress, PWA glue
  sw.js            offline cache
  manifest.webmanifest
  icons/
tools/make_icons.py   regenerates the icons (pure Python)
capacitor.config.json native wrapper config
.github/workflows/pages.yml  GitHub Pages deploy
```
