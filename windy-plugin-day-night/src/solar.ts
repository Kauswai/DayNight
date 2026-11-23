/**
 * Solar position (NOAA solar calculator equations, accurate to ~0.01°).
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
        d.getUTCHours() * 60 +
        d.getUTCMinutes() +
        d.getUTCSeconds() / 60 +
        d.getUTCMilliseconds() / 60000;

    // Sun is overhead where local apparent solar time is 12:00
    const lon = wrapLon(-(utcMinutes + eqTime - 720) / 4);

    return { lat: decl, lon, eqTime };
}

/** Unit vector of the sub-solar point in the globe's frame (x→0°E, y→90°E, z→north) */
export function sunVector(sun: SunPosition): [number, number, number] {
    const la = sun.lat * RAD;
    const lo = sun.lon * RAD;
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/** Sun altitude (degrees, geometric) at a point */
export function sunAltitude(sun: SunPosition, lat: number, lon: number): number {
    const h = (lon - sun.lon) * RAD;
    const s =
        Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) +
        Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos(h);
    return Math.asin(Math.max(-1, Math.min(1, s))) * DEG;
}
