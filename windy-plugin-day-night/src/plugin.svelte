<section class="dn">
    <div class="dn__head">
        <span class="dn__title">🌗 Day-Night</span>
        <span class="dn__time size-xs" title="Time used for the terminator (UTC)">
            {followTimeline ? '' : 'LIVE · '}{fmtTime(currentTs)}
        </span>
    </div>

    {#if error}
        <div class="dn__error size-s">{error}</div>
    {/if}

    <div class="dn__zones">
        {#each ZONES as zone}
            <label class="dn__zone" title={zone.hint}>
                <input type="checkbox" bind:checked={opts.lines[zone.id]} />
                <svg width="26" height="8" class="dn__swatch">
                    <line
                        x1="1"
                        y1="4"
                        x2="25"
                        y2="4"
                        stroke={zone.color}
                        stroke-width={zone.width + 0.6}
                        stroke-dasharray={zone.dash ? zone.dash.map(d => d * zone.width * 1.6).join(' ') : ''}
                    />
                </svg>
                <span>{zone.label}</span>
            </label>
        {/each}
    </div>

    <div class="dn__row">
        <label class="dn__check">
            <input type="checkbox" bind:checked={opts.shading} /> Shade twilight &amp; night
        </label>
    </div>
    {#if opts.shading}
        <div class="dn__row dn__slider">
            <span class="size-xs">Shade</span>
            <input type="range" min="0.03" max="0.35" step="0.01" bind:value={opts.shadeOpacity} />
        </div>
    {/if}
    <div class="dn__row dn__slider">
        <span class="size-xs">Lines</span>
        <input type="range" min="0.2" max="1" step="0.05" bind:value={opts.lineOpacity} />
    </div>

    <div class="dn__row">
        <label class="dn__check">
            <input type="checkbox" bind:checked={opts.showSun} /> Sub-solar point ☀
        </label>
    </div>
    <div class="dn__row">
        <label class="dn__check" title="Off = always show the current real time">
            <input type="checkbox" bind:checked={followTimeline} /> Follow forecast timeline
        </label>
    </div>

    {#if sun}
        <div class="dn__info size-xs">
            Sun overhead at <b>{fmtLat(sun.lat)}, {fmtLon(sun.lon)}</b>
            {#if center}
                <br />Sun altitude at map centre: <b>{centerAlt.toFixed(1)}°</b> — {phaseName(centerAlt)}
            {/if}
        </div>
    {/if}
</section>

<script lang="ts">
    import { map } from '@windy/map';
    import store from '@windy/store';
    import { onDestroy, onMount } from 'svelte';

    import { DayNightLayer, ZONES } from './dayNightLayer';
    import { sunAltitude } from './solar';

    import type { DayNightOptions } from './dayNightLayer';
    import type { SunPosition } from './solar';

    const STORAGE_KEY = 'windy-plugin-day-night-options';

    const defaults: DayNightOptions & { followTimeline: boolean } = {
        lines: { geometric: false, day: true, civil: true, nautical: true, astro: true },
        shading: true,
        shadeOpacity: 0.15,
        lineOpacity: 0.9,
        showSun: true,
        followTimeline: true,
    };

    const loadOpts = () => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                return { ...defaults, ...saved, lines: { ...defaults.lines, ...(saved.lines || {}) } };
            }
        } catch {
            /* ignore */
        }
        return { ...defaults, lines: { ...defaults.lines } };
    };

    const initial = loadOpts();
    let opts: DayNightOptions = {
        lines: initial.lines,
        shading: initial.shading,
        shadeOpacity: initial.shadeOpacity,
        lineOpacity: initial.lineOpacity,
        showSun: initial.showSun,
    };
    let followTimeline: boolean = initial.followTimeline;

    let layer: DayNightLayer | null = null;
    let error: string | null = null;
    let currentTs = Date.now();
    let sun: SunPosition | null = null;
    let center: { lat: number; lng: number } | null = null;
    let tsListener: number | null = null;
    let liveTimer: ReturnType<typeof setInterval> | null = null;

    $: centerAlt = sun && center ? sunAltitude(sun, center.lat, center.lng) : 0;

    $: {
        // react to option changes
        if (layer) {
            layer.setOptions({ ...opts, lines: { ...opts.lines } });
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...opts, followTimeline }));
        } catch {
            /* ignore */
        }
    }

    $: followTimeline, refreshTime();

    function refreshTime() {
        const ts = followTimeline ? (store.get('timestamp') as number) || Date.now() : Date.now();
        currentTs = ts;
        if (layer) {
            layer.update(ts);
            sun = layer.sun;
        }
    }

    const onTimestamp = () => {
        if (followTimeline) refreshTime();
    };

    const onMove = () => {
        const c = map.getCenter();
        center = { lat: c.lat, lng: ((((c.lng + 180) % 360) + 360) % 360) - 180 };
    };

    const pad = (n: number) => String(n).padStart(2, '0');
    const fmtTime = (ts: number) => {
        const d = new Date(ts);
        return (
            `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
            `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
        );
    };
    const fmtLat = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`;
    const fmtLon = (v: number) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'E' : 'W'}`;
    const phaseName = (alt: number) =>
        alt > -0.833
            ? 'day'
            : alt > -6
              ? 'civil twilight'
              : alt > -12
                ? 'nautical twilight'
                : alt > -18
                  ? 'astronomical twilight'
                  : 'night';

    export const onopen = (_params: unknown) => {
        refreshTime();
    };

    onMount(() => {
        try {
            layer = new DayNightLayer({ ...opts, lines: { ...opts.lines } });
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            return;
        }
        tsListener = store.on('timestamp', onTimestamp);
        map.on('moveend', onMove);
        onMove();
        refreshTime();
        // keep "live" mode (and the sun position at the present) ticking
        liveTimer = setInterval(() => {
            if (!followTimeline) refreshTime();
        }, 60000);
    });

    onDestroy(() => {
        if (tsListener !== null) store.off(tsListener);
        if (liveTimer) clearInterval(liveTimer);
        map.off('moveend', onMove);
        layer?.destroy();
        layer = null;
    });
</script>

<style lang="less">
    .dn {
        padding: 4px 2px;
        min-width: 250px;
        &__head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 6px;
        }
        &__title {
            font-size: 15px;
            font-weight: bold;
        }
        &__time {
            opacity: 0.75;
            white-space: nowrap;
        }
        &__error {
            color: #ff8080;
            margin-bottom: 6px;
        }
        &__zones {
            display: flex;
            flex-direction: column;
            gap: 3px;
            margin-bottom: 6px;
        }
        &__zone,
        &__check {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            font-size: 12px;
            line-height: 1.3;
            input {
                margin: 0;
                cursor: pointer;
            }
        }
        &__swatch {
            flex: none;
            background: rgba(0, 0, 0, 0.35);
            border-radius: 2px;
        }
        &__row {
            margin: 3px 0;
        }
        &__slider {
            display: flex;
            align-items: center;
            gap: 8px;
            span {
                width: 34px;
                opacity: 0.75;
            }
            input {
                flex: 1;
            }
        }
        &__info {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid rgba(255, 255, 255, 0.15);
            opacity: 0.85;
            line-height: 1.45;
        }
    }
</style>
