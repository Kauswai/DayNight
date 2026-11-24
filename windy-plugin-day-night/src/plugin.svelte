<section class="dn">
    <div class="dn__head">
        <span class="dn__title">🌗 Day-Night</span>
        <span class="dn__time size-xs" title="Time used for the terminator (UTC)">
            {followTimeline ? '' : 'LIVE · '}{fmtTime(currentTs)}
        </span>
    </div>

    <div class="dn__body" on:wheel|stopPropagation>
    {#if error}
        <div class="dn__error size-s">{error}</div>
    {/if}
    {#if waitingForGlobe}
        <div class="dn__hint size-xs">
            Waiting for the 3D globe to draw… if the lines don't appear, drag the globe once.
        </div>
    {/if}

    <div class="dn__zones">
        {#each ZONES as zone}
            <div class="dn__zone" title={zone.hint}>
                <input type="checkbox" bind:checked={opts.lines[zone.id]} id="dn-{zone.id}" />
                <input
                    type="color"
                    class="dn__color"
                    title="Line colour"
                    bind:value={opts.colors[zone.id]}
                />
                <svg width="24" height="8" class="dn__swatch">
                    <line
                        x1="1"
                        y1="4"
                        x2="23"
                        y2="4"
                        stroke={opts.colors[zone.id]}
                        stroke-width={zone.width + 0.4}
                        stroke-dasharray={zone.dash ? zone.dash.map(d => d * 0.6).join(' ') : ''}
                    />
                </svg>
                <label for="dn-{zone.id}">
                    {#if zone.id === 'geometric' && opts.sunDiameter}
                        True terminator (−0.27°)
                    {:else}
                        {zone.label}
                    {/if}
                </label>
            </div>
            {#if zone.id === 'geometric'}
                <label class="dn__check dn__sub" title="Use the sun's upper limb (angular radius 16′) instead of its centre">
                    <input type="checkbox" bind:checked={opts.sunDiameter} /> include sun's angular diameter
                </label>
            {/if}
        {/each}
        <button class="dn__reset size-xxs" on:click={resetColors}>reset colours</button>
    </div>

    <details class="dn__group" bind:open={ui.shadeOpen}>
        <summary class="dn__summary">Shading &amp; tints</summary>
        <label class="dn__check">
            <input type="checkbox" bind:checked={opts.shading} /> Shade twilight &amp; night
        </label>
        {#if opts.shading}
            <div class="dn__slider">
                <span class="size-xs">Dark</span>
                <input type="range" min="0.03" max="0.35" step="0.01" bind:value={opts.shadeOpacity} />
            </div>
        {/if}
        <label class="dn__check">
            <input type="checkbox" bind:checked={opts.goldenTint} /> Tint golden hour (&lt; 6°)
        </label>
        <label class="dn__check">
            <input type="checkbox" bind:checked={opts.lowTint} /> Tint low sun (6–20°)
        </label>
        {#if opts.goldenTint || opts.lowTint}
            <div class="dn__slider">
                <span class="size-xs">Tint</span>
                <input type="range" min="0.03" max="0.4" step="0.01" bind:value={opts.tintOpacity} />
            </div>
        {/if}
        <div class="dn__slider">
            <span class="size-xs">Lines</span>
            <input type="range" min="0.2" max="1" step="0.05" bind:value={opts.lineOpacity} />
        </div>
    </details>

    <details class="dn__group" bind:open={ui.moreOpen}>
        <summary class="dn__summary">Sun &amp; time</summary>
        <label class="dn__check">
            <input type="checkbox" bind:checked={opts.showSun} /> Sub-solar point ☀
        </label>
        <label class="dn__check" title="Off = always show the current real time">
            <input type="checkbox" bind:checked={followTimeline} /> Follow forecast timeline
        </label>
    </details>

    {#if sun}
        <div class="dn__info size-xs">
            Sun overhead at <b>{fmtLat(sun.lat)}, {fmtLon(sun.lon)}</b>
            {#if center}
                <br />Sun altitude at map centre: <b>{centerAlt.toFixed(1)}°</b> — {phaseName(centerAlt)}
            {/if}
        </div>
    {/if}
    </div>
</section>

<script lang="ts">
    import { map } from '@windy/map';
    import store from '@windy/store';
    import { onDestroy, onMount } from 'svelte';

    import { DayNightOverlay } from './overlay';
    import { sunAltitude, sunPosition } from './solar';
    import { ZONES, defaultColors } from './zones';

    import type { SunPosition } from './solar';
    import type { DayNightOptions } from './zones';

    const STORAGE_KEY = 'windy-plugin-day-night-options';

    type Saved = DayNightOptions & { followTimeline: boolean };

    const defaults = (): Saved => ({
        lines: {
            low: true,
            golden: true,
            geometric: false,
            day: true,
            civil: true,
            nautical: true,
            astro: true,
        },
        colors: defaultColors(),
        shading: true,
        shadeOpacity: 0.15,
        goldenTint: true,
        lowTint: false,
        tintOpacity: 0.12,
        lineOpacity: 0.9,
        showSun: true,
        sunDiameter: false,
        followTimeline: true,
    });

    const loadOpts = (): Saved => {
        const d = defaults();
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                return {
                    ...d,
                    ...saved,
                    lines: { ...d.lines, ...(saved.lines || {}) },
                    colors: { ...d.colors, ...(saved.colors || {}) },
                };
            }
        } catch {
            /* ignore */
        }
        return d;
    };

    const { followTimeline: initialFollow, ...initialOpts } = loadOpts();
    let opts: DayNightOptions = initialOpts;
    let followTimeline = initialFollow;

    let overlay: DayNightOverlay | null = null;
    let error: string | null = null;
    let currentTs = Date.now();
    let sun: SunPosition | null = null;
    let center: { lat: number; lng: number } | null = null;
    let tsListener: number | null = null;
    let liveTimer: ReturnType<typeof setInterval> | null = null;
    let statusTimer: ReturnType<typeof setInterval> | null = null;
    let waitingForGlobe = false;

    /** Which collapsible sections are open (remembered) */
    const UI_KEY = 'windy-plugin-day-night-ui';
    let ui = { shadeOpen: false, moreOpen: false };
    try {
        ui = { ...ui, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') };
    } catch {
        /* ignore */
    }
    $: try {
        localStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch {
        /* ignore */
    }

    $: centerAlt = sun && center ? sunAltitude(sun, center.lat, center.lng) : 0;

    $: {
        overlay?.update(sun ?? sunPosition(currentTs), opts);
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
        sun = sunPosition(ts);
    }

    function resetColors() {
        opts.colors = defaultColors();
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
        alt >= 20
            ? 'day'
            : alt >= 6
              ? 'low sun'
              : alt > -0.833
                ? 'golden hour'
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
            overlay = new DayNightOverlay(opts);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            return;
        }
        tsListener = store.on('timestamp', onTimestamp);
        map.on('moveend', onMove);
        onMove();
        refreshTime();
        // keep "live" mode ticking
        liveTimer = setInterval(() => {
            if (!followTimeline) refreshTime();
        }, 60000);
        statusTimer = setInterval(() => {
            waitingForGlobe = !!overlay?.waitingForGlobe;
        }, 700);
    });

    onDestroy(() => {
        if (tsListener !== null) store.off(tsListener);
        if (liveTimer) clearInterval(liveTimer);
        if (statusTimer) clearInterval(statusTimer);
        map.off('moveend', onMove);
        overlay?.destroy();
        overlay = null;
    });
</script>

<style lang="less">
    .dn {
        padding: 2px 0;
        width: 270px;
        max-width: 100%;
        &__head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px;
            padding: 0 2px 5px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        }
        /* only the body scrolls, so the panel never grows over Windy's own controls */
        &__body {
            max-height: min(42vh, 330px);
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 5px 6px 2px 2px;
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.35) transparent;
            &::-webkit-scrollbar {
                width: 6px;
            }
            &::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.3);
                border-radius: 3px;
            }
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
        &__hint {
            color: #ffd27a;
            margin-bottom: 6px;
        }
        &__zones {
            display: flex;
            flex-direction: column;
            gap: 2px;
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
            input[type='checkbox'] {
                margin: 0;
                cursor: pointer;
            }
            label {
                cursor: pointer;
            }
        }
        &__sub {
            padding-left: 20px;
            font-size: 11px;
            opacity: 0.8;
        }
        &__color {
            -webkit-appearance: none;
            appearance: none;
            width: 14px;
            height: 14px;
            padding: 0;
            border: 1px solid rgba(255, 255, 255, 0.45);
            border-radius: 50%;
            background: none;
            cursor: pointer;
            flex: none;
            overflow: hidden;
            &::-webkit-color-swatch-wrapper {
                padding: 0;
            }
            &::-webkit-color-swatch {
                border: none;
                border-radius: 50%;
            }
            &::-moz-color-swatch {
                border: none;
                border-radius: 50%;
            }
        }
        &__swatch {
            flex: none;
            background: rgba(0, 0, 0, 0.35);
            border-radius: 2px;
        }
        &__reset {
            align-self: flex-end;
            background: none;
            border: none;
            color: inherit;
            opacity: 0.6;
            cursor: pointer;
            text-decoration: underline dotted;
            padding: 0;
        }
        &__group {
            padding-top: 4px;
            margin-top: 3px;
            border-top: 1px solid rgba(255, 255, 255, 0.12);
            > :not(summary) {
                margin: 3px 0 3px 4px;
            }
        }
        &__summary {
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            opacity: 0.85;
            padding: 2px 0;
            user-select: none;
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
            border-top: 1px solid rgba(255, 255, 255, 0.12);
            opacity: 0.85;
            line-height: 1.45;
        }
    }
</style>
