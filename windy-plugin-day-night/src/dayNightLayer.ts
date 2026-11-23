/**
 * Draws the day/night terminator and twilight zones straight into Windy's MapLibre map.
 *
 * Windy's Leaflet-GL `L.Polyline` / `L.Polygon` are drawn by a flat SVG/canvas overlay that
 * does not follow the 3D globe, so instead we add native MapLibre GeoJSON sources + fill /
 * line / circle layers. MapLibre projects those itself, so they work identically on the 2D
 * map and the 3D globe.
 */
import { map } from '@windy/map';

import { sunPosition, terminator } from './solar';

import type { SunPosition } from './solar';

export type ZoneId = 'day' | 'geometric' | 'civil' | 'nautical' | 'astro';

export interface ZoneDef {
    id: ZoneId;
    label: string;
    /** Sun altitude threshold in degrees */
    altitude: number;
    /** Does this zone contribute to the darkness shading */
    shades: boolean;
    color: string;
    dash: number[] | null;
    width: number;
    hint: string;
}

/** Ordered from lightest to darkest */
export const ZONES: ZoneDef[] = [
    {
        id: 'geometric',
        label: 'True terminator (0°)',
        altitude: 0,
        shades: false,
        color: '#ffd23f',
        dash: [1, 2],
        width: 1.6,
        hint: 'Geometric day/night line: sun centre exactly on the horizon, no refraction.',
    },
    {
        id: 'day',
        label: 'Sunrise / sunset (−0.833°)',
        altitude: -0.833,
        shades: true,
        color: '#ffffff',
        dash: null,
        width: 2.2,
        hint: 'Official day/night line: upper limb of the sun on the horizon, including refraction.',
    },
    {
        id: 'civil',
        label: 'Civil twilight (−6°)',
        altitude: -6,
        shades: true,
        color: '#5ec8ff',
        dash: null,
        width: 1.6,
        hint: 'End of civil twilight: brightest stars visible, artificial light needed outdoors.',
    },
    {
        id: 'nautical',
        label: 'Nautical twilight (−12°)',
        altitude: -12,
        shades: true,
        color: '#3d7bff',
        dash: [4, 2],
        width: 1.6,
        hint: 'End of nautical twilight: sea horizon no longer visible.',
    },
    {
        id: 'astro',
        label: 'Astronomical twilight (−18°)',
        altitude: -18,
        shades: true,
        color: '#b07cff',
        dash: [2, 2],
        width: 1.6,
        hint: 'End of astronomical twilight: sky fully dark — true night.',
    },
];

export interface DayNightOptions {
    lines: Record<ZoneId, boolean>;
    shading: boolean;
    /** Opacity of each shading step (they stack, so true night is darkest) */
    shadeOpacity: number;
    lineOpacity: number;
    showSun: boolean;
}

const PREFIX = 'windy-plugin-day-night';
const SRC_FILL = `${PREFIX}-fill`;
const SRC_LINE = `${PREFIX}-line`;
const SRC_SUN = `${PREFIX}-sun`;
const LYR_FILL = `${PREFIX}-fill-layer`;
const LYR_SUN_HALO = `${PREFIX}-sun-halo`;
const LYR_SUN = `${PREFIX}-sun-layer`;
const lineLayerId = (z: ZoneId) => `${PREFIX}-line-${z}`;

/** Empty FeatureCollection */
const emptyFc = () => ({ type: 'FeatureCollection', features: [] as unknown[] });

export class DayNightLayer {
    private ml: any;
    private options: DayNightOptions;
    private fillData: any = emptyFc();
    private lineData: any = emptyFc();
    private sunData: any = emptyFc();
    private destroyed = false;
    private readonly onStyle = () => this.ensureLayers();

    sun: SunPosition = sunPosition(Date.now());

    constructor(options: DayNightOptions) {
        this.options = options;
        this.ml = (map as any).maplibreMap ?? (map as any)._maplibreMap;
        if (!this.ml) {
            throw new Error('MapLibre map not found – this Windy version is not supported');
        }
        // Windy rebuilds parts of the style when switching 2D/3D, base maps etc.
        // Re-create our layers whenever they disappear.
        this.ml.on('styledata', this.onStyle);
        this.ml.on('style.load', this.onStyle);
        this.update(Date.now());
    }

    setOptions(options: DayNightOptions): void {
        this.options = options;
        this.rebuildData();
        this.applyStyle();
    }

    update(timestamp: number): void {
        this.sun = sunPosition(timestamp);
        this.rebuildData();
    }

    private rebuildData(): void {
        const fills: unknown[] = [];
        const lines: unknown[] = [];
        for (const zone of ZONES) {
            const wantLine = this.options.lines[zone.id];
            const wantFill = this.options.shading && zone.shades;
            if (!wantLine && !wantFill) {
                continue;
            }
            const t = terminator(this.sun, zone.altitude);
            if (wantFill) {
                fills.push({
                    type: 'Feature',
                    properties: { zone: zone.id },
                    geometry: { type: 'MultiPolygon', coordinates: t.polygons },
                });
            }
            if (wantLine) {
                lines.push({
                    type: 'Feature',
                    properties: { zone: zone.id },
                    geometry: { type: 'MultiLineString', coordinates: t.lines },
                });
            }
        }
        this.fillData = { type: 'FeatureCollection', features: fills };
        this.lineData = { type: 'FeatureCollection', features: lines };
        this.sunData = {
            type: 'FeatureCollection',
            features: this.options.showSun
                ? [
                      {
                          type: 'Feature',
                          properties: {},
                          geometry: { type: 'Point', coordinates: [this.sun.lon, this.sun.lat] },
                      },
                  ]
                : [],
        };
        this.pushData();
    }

    private pushData(): void {
        if (this.destroyed) return;
        if (!this.ensureLayers()) return;
        this.ml.getSource(SRC_FILL)?.setData(this.fillData);
        this.ml.getSource(SRC_LINE)?.setData(this.lineData);
        this.ml.getSource(SRC_SUN)?.setData(this.sunData);
    }

    /** Adds sources/layers if missing. Returns false if the style is not ready yet. */
    private ensureLayers(): boolean {
        if (this.destroyed) return false;
        const ml = this.ml;
        let style: any;
        try {
            style = ml.getStyle?.();
        } catch {
            return false;
        }
        if (!style) return false;

        let added = false;
        try {
            if (!ml.getSource(SRC_FILL)) {
                ml.addSource(SRC_FILL, { type: 'geojson', data: this.fillData, tolerance: 0.2 });
                added = true;
            }
            if (!ml.getSource(SRC_LINE)) {
                ml.addSource(SRC_LINE, { type: 'geojson', data: this.lineData, tolerance: 0.2 });
                added = true;
            }
            if (!ml.getSource(SRC_SUN)) {
                ml.addSource(SRC_SUN, { type: 'geojson', data: this.sunData });
                added = true;
            }
            if (!ml.getLayer(LYR_FILL)) {
                ml.addLayer({
                    id: LYR_FILL,
                    type: 'fill',
                    source: SRC_FILL,
                    paint: { 'fill-color': '#000814', 'fill-antialias': false },
                });
                added = true;
            }
            for (const zone of ZONES) {
                const id = lineLayerId(zone.id);
                if (!ml.getLayer(id)) {
                    const layer: any = {
                        id,
                        type: 'line',
                        source: SRC_LINE,
                        filter: ['==', ['get', 'zone'], zone.id],
                        layout: { 'line-join': 'round', 'line-cap': zone.dash ? 'butt' : 'round' },
                        paint: { 'line-color': zone.color, 'line-width': zone.width },
                    };
                    if (zone.dash) {
                        layer.paint['line-dasharray'] = zone.dash;
                    }
                    ml.addLayer(layer);
                    added = true;
                }
            }
            if (!ml.getLayer(LYR_SUN_HALO)) {
                ml.addLayer({
                    id: LYR_SUN_HALO,
                    type: 'circle',
                    source: SRC_SUN,
                    paint: {
                        'circle-radius': 14,
                        'circle-color': '#ffcc33',
                        'circle-opacity': 0.25,
                        'circle-blur': 0.6,
                        'circle-pitch-alignment': 'map',
                    },
                });
                added = true;
            }
            if (!ml.getLayer(LYR_SUN)) {
                ml.addLayer({
                    id: LYR_SUN,
                    type: 'circle',
                    source: SRC_SUN,
                    paint: {
                        'circle-radius': 6,
                        'circle-color': '#ffcc33',
                        'circle-stroke-color': '#7a4a00',
                        'circle-stroke-width': 1.5,
                        'circle-pitch-alignment': 'map',
                    },
                });
                added = true;
            }
        } catch (e) {
            // style mid-update – the next 'styledata' event will retry
            return false;
        }
        if (added) {
            this.applyStyle();
        }
        return true;
    }

    private applyStyle(): void {
        const ml = this.ml;
        if (!ml.getLayer(LYR_FILL)) return;
        ml.setPaintProperty(LYR_FILL, 'fill-opacity', this.options.shadeOpacity);
        for (const zone of ZONES) {
            ml.setPaintProperty(lineLayerId(zone.id), 'line-opacity', this.options.lineOpacity);
        }
        // keep our layers on top of anything Windy adds later
        for (const id of this.layerIds()) {
            try {
                ml.moveLayer(id);
            } catch {
                /* ignore */
            }
        }
    }

    private layerIds(): string[] {
        return [LYR_FILL, ...ZONES.map(z => lineLayerId(z.id)), LYR_SUN_HALO, LYR_SUN];
    }

    destroy(): void {
        this.destroyed = true;
        const ml = this.ml;
        ml.off('styledata', this.onStyle);
        ml.off('style.load', this.onStyle);
        for (const id of this.layerIds()) {
            try {
                if (ml.getLayer(id)) ml.removeLayer(id);
            } catch {
                /* ignore */
            }
        }
        for (const id of [SRC_FILL, SRC_LINE, SRC_SUN]) {
            try {
                if (ml.getSource(id)) ml.removeSource(id);
            } catch {
                /* ignore */
            }
        }
    }
}
