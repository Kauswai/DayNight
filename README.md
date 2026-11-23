# Day-Night Globe – Windy.com plugin

Draws the day/night terminator and twilight boundaries on Windy.com and keeps them in sync
with the forecast timeline. Unlike the old terminator plugin, it **works on the 3D globe**.

| Line | Sun altitude | Meaning |
|---|---|---|
| True terminator (optional, yellow dotted) | 0° | geometric day/night line |
| Sunrise / sunset (white) | −0.833° | official day/night line (refraction + solar radius) |
| Civil twilight (light blue) | −6° | |
| Nautical twilight (blue dashed) | −12° | |
| Astronomical twilight (purple dotted) | −18° | beyond this it is fully dark |

The zones are shaded in steps, so the darkest area is true night. There is also an optional
sub-solar point marker ☀ and a readout of the sun altitude at the map centre. Settings are
saved in localStorage.

## Why it works in 3D

Windy's map is Leaflet-GL on top of MapLibre. Leaflet-GL `L.Polyline` / `L.Polygon` are drawn
by a flat SVG/canvas overlay, which does not follow the globe. This plugin adds native
**MapLibre GeoJSON sources with fill/line/circle layers** via `map.maplibreMap`, so MapLibre
projects them itself, in both mercator and globe modes. The layers are re-added when Windy
rebuilds its style (`styledata`), for example when switching between 2D and 3D.

Each boundary is the small circle of radius `90° + h0` around the antisolar point. The polygons
are closed over the pole when needed and split at the antimeridian (`src/solar.ts`). The sun
position uses the NOAA solar equations.

## Develop / install

```
cd windy-plugin-day-night
npm install      # or copy node_modules from the MJO plugin
npm start        # serves https://localhost:9997 (PORT env overrides)
```

Then open <https://www.windy.com/dev/localhost:9997/plugin.js> while logged in to Windy.
`npm run build` (or `npm run build:win`) writes `dist/` for publishing.
