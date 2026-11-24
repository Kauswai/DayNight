/**
 * The sun-altitude lines the plugin can draw, and the user options.
 */

export type ZoneId = 'low' | 'golden' | 'geometric' | 'day' | 'civil' | 'nautical' | 'astro';

export interface ZoneDef {
    id: ZoneId;
    label: string;
    /** Sun altitude threshold in degrees */
    altitude: number;
    color: string;
    /** [on, off] dash lengths in CSS pixels, null = solid */
    dash: [number, number] | null;
    /** Line width in CSS pixels */
    width: number;
    hint: string;
}

/** Sun's apparent angular radius (semi-diameter), degrees */
export const SUN_SEMI_DIAMETER = 0.2667;

/** Ordered from highest sun to lowest */
export const ZONES: ZoneDef[] = [
    {
        id: 'low',
        label: 'Low sun (18°)',
        altitude: 18,
        color: '#fff1a6',
        dash: [10, 6],
        width: 1.5,
        hint: 'Sun 18° above the horizon (mirror of the −18° astronomical-night line): below this the sun is low, with long shadows and weak heating.',
    },
    {
        id: 'golden',
        label: 'Golden hour (6°)',
        altitude: 6,
        color: '#ffa94d',
        dash: null,
        width: 1.8,
        hint: 'Sun 6° above the horizon: start/end of the golden hour.',
    },
    {
        id: 'geometric',
        label: 'True terminator (0°)',
        altitude: 0,
        color: '#ffd23f',
        dash: [2, 4],
        width: 1.8,
        hint: 'Geometric day/night line, no refraction. Optionally uses the upper limb of the sun (−0.27°).',
    },
    {
        id: 'day',
        label: 'Sunrise / sunset (−0.833°)',
        altitude: -0.833,
        color: '#ffffff',
        dash: null,
        width: 2.2,
        hint: 'Official day/night line: upper limb of the sun on the horizon, including refraction.',
    },
    {
        id: 'civil',
        label: 'Civil twilight (−6°)',
        altitude: -6,
        color: '#5ec8ff',
        dash: null,
        width: 1.6,
        hint: 'End of civil twilight: brightest stars visible, artificial light needed outdoors.',
    },
    {
        id: 'nautical',
        label: 'Nautical twilight (−12°)',
        altitude: -12,
        color: '#3d7bff',
        dash: [8, 4],
        width: 1.6,
        hint: 'End of nautical twilight: sea horizon no longer visible.',
    },
    {
        id: 'astro',
        label: 'Astronomical twilight (−18°)',
        altitude: -18,
        color: '#b07cff',
        dash: [3, 4],
        width: 1.6,
        hint: 'End of astronomical twilight: sky fully dark — true night.',
    },
];

export interface DayNightOptions {
    lines: Record<ZoneId, boolean>;
    colors: Record<ZoneId, string>;
    /** Darken civil / nautical / astronomical twilight and night in steps */
    shading: boolean;
    /** Opacity of each darkness step (they stack, so true night is darkest) */
    shadeOpacity: number;
    /** Orange tint between sunrise/sunset and 6° */
    goldenTint: boolean;
    /** Pale yellow tint between 6° and 18° */
    lowTint: boolean;
    tintOpacity: number;
    lineOpacity: number;
    showSun: boolean;
    /** True terminator uses the sun's upper limb (−semi-diameter) instead of its centre */
    sunDiameter: boolean;
}

export const defaultColors = (): Record<ZoneId, string> =>
    Object.fromEntries(ZONES.map(z => [z.id, z.color])) as Record<ZoneId, string>;

export const zoneAltitude = (zone: ZoneDef, opts: DayNightOptions): number =>
    zone.id === 'geometric' && opts.sunDiameter ? -SUN_SEMI_DIAMETER : zone.altitude;
