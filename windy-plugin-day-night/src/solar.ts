/**
 * Solar geometry and terminator construction.
 *
 * Every twilight boundary (sun altitude = h0) is a small circle on the sphere centred on the
 * antisolar point with angular radius 90° + h0. The region where the sun is *below* h0 is
 * therefore a spherical cap, which we turn into GeoJSON polygons that MapLibre can draw both
 * on the flat mercator map and on the 3D globe.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface SunPosition {
    /** Sub-solar latitude = solar declination, degrees */
    lat: number;
    /** Sub-solar longitude, degrees in [-180, 180) */
    lon: number;
    /** Equation of time, minutes */
    eqTime: number;
}

/** Normalise longitude to [-180, 180) */
export const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * Sub-solar point using the NOAA solar calculator equations (accurate to ~0.01°,
 * far better than anything visible on a map).
 */
export function sunPosition(timestamp: number): SunPosition {
    const jd = timestamp / 86400000 + 2440587.5;
    const t = (jd - 2451545.0) / 36525; // Julian centuries since J2000.0

    const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360; // geom. mean longitude
    const m = 357.52911 + t * (35999.05029 - 0.0001537 * t); // mean anomaly
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t); // orbit eccentricity

    const mr = m * RAD;
    const c =
        Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
        Math.sin(2 * mr) * (0.019993 - 0.000101 * t) +
        Math.sin(3 * mr) * 0.000289; // equation of centre

    const trueLon = l0 + c;
    const omega = 125.04 - 1934.136 * t;
    const appLon = trueLon - 0.00569 - 0.00478 * Math.sin(omega * RAD);

    const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
    const meanObliq = 23 + (26 + seconds / 60) / 60;
    const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);

    const decl = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLon * RAD)) * DEG;

    const y = Math.tan((obliq / 2) * RAD) ** 2;
    const l0r = l0 * RAD;
    const eqTime =
        4 *
        DEG *
        (y * Math.sin(2 * l0r) -
            2 * e * Math.sin(mr) +
            4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) -
            0.5 * y * y * Math.sin(4 * l0r) -
            1.25 * e * e * Math.sin(2 * mr));

    const d = new Date(timestamp);
    const utcMinutes =
        d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;

    // Sun is overhead where local apparent solar time is 12:00
    const lon = wrapLon(-(utcMinutes + eqTime - 720) / 4);

    return { lat: decl, lon, eqTime };
}

/** Sun altitude (degrees, geometric) at a point */
export function sunAltitude(sun: SunPosition, lat: number, lon: number): number {
    const h = (lon - sun.lon) * RAD;
    const s =
        Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) +
        Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos(h);
    return Math.asin(Math.max(-1, Math.min(1, s))) * DEG;
}

/** Point at angular distance `dist` (deg) from (lat, lon) along initial bearing `brg` (deg) */
function destination(lat: number, lon: number, dist: number, brg: number): [number, number] {
    const φ1 = lat * RAD;
    const δ = dist * RAD;
    const θ = brg * RAD;
    const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
    const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
    const λ2 =
        lon * RAD +
        Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * sinφ2);
    return [λ2 * DEG, φ2 * DEG];
}

type Ring = [number, number][]; // [lon, lat]

/**
 * Small circle of angular radius `radius` around (lat, lon), with *unwrapped* (continuous)
 * longitudes. Returns the ring without repeating the first point.
 */
function smallCircle(lat: number, lon: number, radius: number, steps: number): Ring {
    const ring: Ring = [];
    let prev = 0;
    for (let i = 0; i < steps; i++) {
        let [x, y] = destination(lat, lon, radius, (360 * i) / steps);
        if (i > 0) {
            while (x - prev > 180) x -= 360;
            while (x - prev < -180) x += 360;
        }
        ring.push([x, y]);
        prev = x;
    }
    return ring;
}

/** Sutherland–Hodgman clip of a polygon ring to the vertical strip minX <= x <= maxX */
function clipStrip(ring: Ring, minX: number, maxX: number): Ring {
    const clipEdge = (pts: Ring, inside: (p: [number, number]) => boolean, xEdge: number): Ring => {
        const out: Ring = [];
        for (let i = 0; i < pts.length; i++) {
            const cur = pts[i];
            const prev = pts[(i + pts.length - 1) % pts.length];
            const curIn = inside(cur);
            const prevIn = inside(prev);
            if (curIn !== prevIn) {
                const f = (xEdge - prev[0]) / (cur[0] - prev[0]);
                out.push([xEdge, prev[1] + f * (cur[1] - prev[1])]);
            }
            if (curIn) {
                out.push(cur);
            }
        }
        return out;
    };
    let pts = clipEdge(ring, p => p[0] >= minX, minX);
    if (pts.length) {
        pts = clipEdge(pts, p => p[0] <= maxX, maxX);
    }
    return pts;
}

export interface Terminator {
    /** Area where the sun is below the threshold (MultiPolygon coordinates, lon in [-180,180]) */
    polygons: number[][][][];
    /** Boundary line split at the antimeridian (MultiLineString coordinates) */
    lines: number[][][];
}

/**
 * Builds the region where sun altitude < `altitude` (degrees, e.g. -6 for civil twilight)
 * and its boundary line.
 */
export function terminator(sun: SunPosition, altitude: number, steps = 720): Terminator {
    const antiLat = -sun.lat;
    const antiLon = wrapLon(sun.lon + 180);
    const radius = 90 + altitude;

    const circle = smallCircle(antiLat, antiLon, radius, steps);

    // ---- boundary line, split where it crosses the antimeridian
    const lines: number[][][] = [];
    let cur: number[][] = [];
    const closed = [...circle, circle[0]];
    for (let i = 0; i < closed.length; i++) {
        const lon = wrapLon(closed[i][0]);
        const lat = closed[i][1];
        if (i > 0) {
            const pLon = wrapLon(closed[i - 1][0]);
            const pLat = closed[i - 1][1];
            if (Math.abs(lon - pLon) > 180) {
                // crossing: interpolate latitude at the ±180 seam
                const edge = pLon > 0 ? 180 : -180;
                const lonU = lon + (pLon > 0 ? 360 : -360);
                const f = (edge - pLon) / (lonU - pLon);
                const latX = pLat + f * (lat - pLat);
                cur.push([edge, latX]);
                lines.push(cur);
                cur = [[-edge, latX]];
            }
        }
        cur.push([lon, lat]);
    }
    if (cur.length > 1) lines.push(cur);

    // ---- filled cap
    const net = circle[circle.length - 1][0] - circle[0][0];
    // Does the cap enclose a pole? (pole within `radius` of the cap centre)
    const northIn = 90 - antiLat < radius;
    const southIn = 90 + antiLat < radius;
    let ring: Ring = circle.slice();

    if (northIn || southIn) {
        // The boundary winds once around the pole; close the ring along the pole.
        // Make sure the longitude span is exactly one full turn.
        const dir = net >= 0 ? 1 : -1;
        const start = ring[0][0];
        const end = start + dir * 360;
        const poleLat = northIn ? 90 : -90;
        const edgeLat = ring[0][1];
        ring = [...ring, [end, edgeLat], [end, poleLat], [start, poleLat]];
    }

    const polygons: number[][][][] = [];
    for (let k = -2; k <= 2; k++) {
        const clipped = clipStrip(ring, -180 + 360 * k, 180 + 360 * k);
        if (clipped.length >= 3) {
            const shifted = clipped.map(([x, y]) => [x - 360 * k, y]);
            shifted.push(shifted[0]);
            polygons.push([shifted]);
        }
    }

    return { polygons, lines };
}
