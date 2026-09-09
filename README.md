# Hue Hop

A tap-to-bounce arcade game for your phone. Keep a glowing ball climbing through spinning colour obstacles. The ball only passes through the part of each obstacle that matches its own colour; touch any other colour and the run is over.

## How to play

- **Tap** anywhere to make the ball jump. Gravity pulls it back down, so keep tapping.
- **Match the colour.** Every obstacle is split into coloured segments and rotates. Time your jumps so you pass through your own colour.
- **Stars** sit in the middle of every obstacle. Each one is a point.
- **Colour wheels** between obstacles change your colour to a new one, so re-read the next obstacle before you go through.
- Fall off the bottom of the screen and it's game over too.

Your best score and game count are saved on the device.

## Obstacles

New shapes unlock as your score climbs, and everything spins faster the further you get:

| Score | Shape |
| --- | --- |
| 0 | Circle ring, sliding colour line |
| 3 | Square ring |
| 6 | Double circle (counter-rotating) |
| 9 | Triangle (three colours only, the wheel before it never gives you the missing colour) |
| 12 | Spinning cross |
| 16 | Hexagon |
| 20 | Circle inside a square |
| 25 | Triple circle |

## Install on iPhone

The app is a Progressive Web App, so it installs straight from Safari with no App Store:

1. Open **https://aizad-eng.github.io/App/** in **Safari** on your iPhone.
2. Tap the **Share** button, then **Add to Home Screen**.
3. Launch it from the home screen. It runs full-screen and works offline.

Hosting is GitHub Pages, deploying the `main` branch (Settings → Pages → Source: Deploy from a branch, `main`, root). The root page redirects into `www/`, so every push to `main` updates the live game within a minute or two.

## Run locally

Any static file server works, for example:

```bash
npm start            # serves www/ on http://localhost:8080
# or
python3 -m http.server 8080 --directory www
```

On a desktop browser you can also press Space to jump.

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
  js/game.js       physics, obstacles, collision and rendering
  js/audio.js      synthesized sound effects
  js/app.js        screens, score persistence, PWA glue
  sw.js            offline cache
  manifest.webmanifest
  icons/
tools/make_icons.py   regenerates the icons (pure Python)
capacitor.config.json native wrapper config
index.html            redirects the GitHub Pages root into www/
```
