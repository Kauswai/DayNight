# Day-Night Globe – Windy.com plugin

Draws the day/night terminator, twilight boundaries, golden hour and low-sun lines on
Windy.com, kept in sync with the forecast timeline. It works on the **2D map and on Windy's 3D
globe**.

| Line (default colour) | Sun altitude | Meaning |
|---|---|---|
| Low sun (pale yellow, dashed) | 18° | below this the sun is low (mirror of the −18° astronomical-night line) |
| Golden hour (orange) | 6° | golden hour starts/ends |
| True terminator (optional, yellow dotted) | 0° (or −0.27° with the sun's angular diameter) | geometric day/night line, no refraction |
| Sunrise / sunset (white) | −0.833° | official day/night line (refraction + solar radius) |
| Civil twilight (light blue) | −6° | |
| Nautical twilight (blue dashed) | −12° | |
| Astronomical twilight (purple dotted) | −18° | beyond this it is fully dark |

Options:
- Turn each line on or off, and change its colour.
- Stepped darkness shading for twilight and night.
- Tints for golden hour (< 6°) and low sun (6–18°).
- Opacity sliders.
- A sub-solar point marker.
- "Follow forecast timeline" or live mode.
- Movable panel: the ⇱ button floats the panel so you can drag it anywhere by its title bar (⇲ docks it back). The position is remembered.
- Sun altitude and phase at the map centre.

Settings are saved in localStorage.

## Install in Windy (no local server)

Log in to Windy, then open:

**<https://www.windy.com/dev/kauswai.github.io/DayNight/plugin.js>**

Windy installs the plugin to your account and opens it. It stays in your Windy menu and loads
the latest build from GitHub Pages, which `.github/workflows/pages.yml` rebuilds on every push.
One-time repo setup: **Settings → Pages → Source: GitHub Actions**.

## How it renders (and why it works in 3D)

Windy's 3D globe is not MapLibre. It is Windy's own WebGL renderer on `#globeCanvas`, so
Leaflet or MapLibre layers never reach it. This plugin draws everything in **one fragment
shader on its own transparent WebGL canvas**, stacked directly above the active map canvas:

- **2D:** each pixel's lon/lat comes from the MapLibre centre and zoom (web mercator).
- **3D:** the globe draws a unit sphere `P = (cosφ·cosλ, cosφ·sinλ, sinφ)` with a `uMatMVP`
  matrix. A page-wide wrapper on WebGL `uniformMatrix4fv` (only for `#globeCanvas` and only for
  the globe's surface shaders) records that matrix. The shader inverts it, casts a ray per
  pixel and intersects the sphere.

For every pixel the sun altitude is `asin(P · sun)`. Lines are drawn where the altitude crosses
a threshold, using screen-space derivatives, so they are anti-aliased, constant-width and
dashed in pixels. The sun position uses the NOAA solar equations (`src/solar.ts`).

## Develop

```
cd windy-plugin-day-night
npm install      # or copy node_modules from the MJO plugin
npm start        # serves https://localhost:9997 (PORT env overrides)
```

Then open <https://www.windy.com/dev/localhost:9997/plugin.js> while logged in to Windy.
`npm run build` (or `npm run build:win`) writes `dist/` for publishing.
