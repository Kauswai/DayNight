/**
 * Day/night overlay rendered with our own small WebGL canvas.
 *
 * Every pixel is turned into a point on the Earth, the sun altitude there is computed, and the
 * fragment shader draws the twilight shading, tints and constant-altitude lines (anti-aliased,
 * constant pixel width, optionally dashed). The same shader serves both of Windy's views:
 *
 *  - 2D map (MapLibre, web mercator): pixel → lon/lat from the map centre and zoom.
 *  - 3D globe (Windy's own WebGL renderer on `#globeCanvas`, not MapLibre): the globe draws a
 *    unit sphere P = (cosφ·cosλ, cosφ·sinλ, sinφ) with a `uMatMVP` matrix. A page-wide hook on
 *    WebGL `uniformMatrix4fv` records that matrix; we cast a ray through every pixel
 *    with its inverse and intersect it with the sphere.
 */
import { map as leafletMap } from '@windy/map';

import { sunVector } from './solar';
import { ZONES, zoneAltitude } from './zones';

import type { SunPosition } from './solar';
import type { DayNightOptions } from './zones';

const N_LINES = ZONES.length;

const VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FS = `
#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform vec2 uRes;          // drawing buffer size, device px
uniform float uDpr;
uniform float uMode;        // 0 = 2D mercator, 1 = 3D globe
uniform mat4 uInvMVP;
uniform vec4 uMerc;         // lon0 (deg), deg per css px, mercY0, mercY per css px
uniform vec3 uSun;          // unit vector of the sub-solar point
uniform float uLineAlt[${N_LINES}];
uniform vec4 uLineColor[${N_LINES}];   // rgb, alpha (0 = off)
uniform float uLineWidth[${N_LINES}];  // css px
uniform vec2 uLineDash[${N_LINES}];    // on/off css px, x = 0 -> solid
uniform vec4 uShadeAlt;     // darkness step thresholds
uniform float uShadeOpacity;
uniform vec4 uGold;         // rgb, alpha
uniform vec4 uLow;          // rgb, alpha
uniform vec4 uSunMark;      // rgb, alpha (0 = off)

const float PI = 3.14159265359;

vec4 over(vec4 dst, vec3 rgb, float a) {
    // premultiplied "source over"
    return vec4(rgb * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}

void main() {
    vec3 P;
    if (uMode < 0.5) {
        vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
        float lon = radians(uMerc.x + px.x * uMerc.y);
        float my = uMerc.z + px.y * uMerc.w;
        float lat = 2.0 * atan(exp(my)) - 0.5 * PI;
        P = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
    } else {
        vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
        vec4 n = uInvMVP * vec4(ndc, -1.0, 1.0);
        vec4 f = uInvMVP * vec4(ndc, 1.0, 1.0);
        vec3 o = n.xyz / n.w;
        vec3 d = normalize(f.xyz / f.w - o);
        float b = dot(o, d);
        float c = dot(o, o) - 1.0;
        float disc = b * b - c;
        if (disc < 0.0) discard;
        P = o + (-b - sqrt(disc)) * d;
    }

    float s = clamp(dot(P, uSun), -1.0, 1.0);
    float alt = degrees(asin(s));
    float fw = max(fwidth(alt), 1e-5);              // degrees of altitude per device px
    float pxRad = max(length(fwidth(P)), 1e-9);      // radians on the sphere per device px

    vec4 col = vec4(0.0);

    // ---- tints and darkness steps (smooth 1px edges)
    float hw = 0.5 * fw;
    float below20 = 1.0 - smoothstep(20.0 - hw, 20.0 + hw, alt);
    float below6 = 1.0 - smoothstep(6.0 - hw, 6.0 + hw, alt);
    float belowSet = 1.0 - smoothstep(-0.833 - hw, -0.833 + hw, alt);
    col = over(col, uLow.rgb, uLow.a * (below20 - below6));
    col = over(col, uGold.rgb, uGold.a * (below6 - belowSet));

    float k = 0.0;
    for (int i = 0; i < 4; i++) {
        float h = uShadeAlt[i];
        k += 1.0 - smoothstep(h - hw, h + hw, alt);
    }
    float dark = 1.0 - pow(1.0 - uShadeOpacity, k);
    col = over(col, vec3(0.0, 0.012, 0.06), dark);

    // ---- lines
    // position along the circle of constant altitude, in css px, for dashes
    vec3 e1 = normalize(cross(uSun, vec3(0.0, 0.0, 1.0)));
    vec3 e2 = cross(uSun, e1);
    float theta = atan(dot(P, e2), dot(P, e1));
    float along = theta * cos(radians(alt)) / pxRad / uDpr;

    for (int i = 0; i < ${N_LINES}; i++) {
        vec4 lc = uLineColor[i];
        if (lc.a <= 0.0) continue;
        float dpx = abs(alt - uLineAlt[i]) / fw;           // device px from the line
        float w = uLineWidth[i] * uDpr;
        float a = clamp(0.5 * w + 0.5 - dpx, 0.0, 1.0);
        if (a <= 0.0) continue;
        vec2 dash = uLineDash[i];
        if (dash.x > 0.0) {
            float period = dash.x + dash.y;
            float ph = mod(along, period);
            // on for ph < dash.x, with a 1px soft edge at both ends of each dash
            a *= clamp(dash.x - ph + 0.5, 0.0, 1.0) + clamp(ph - period + 0.5, 0.0, 1.0);
        }
        // thin dark casing makes light lines readable on light weather layers
        float casing = clamp(0.5 * w + 1.5 - dpx, 0.0, 1.0) * 0.35;
        col = over(col, vec3(0.0), casing * lc.a * (1.0 - a));
        col = over(col, lc.rgb, a * lc.a);
    }

    // ---- sub-solar point
    if (uSunMark.a > 0.0) {
        float dpx = acos(s) / pxRad / uDpr;   // css px from the sub-solar point
        float halo = (1.0 - smoothstep(6.0, 16.0, dpx)) * 0.35;
        col = over(col, uSunMark.rgb, halo * uSunMark.a);
        float ring = clamp(7.5 - dpx, 0.0, 1.0);
        col = over(col, vec3(0.48, 0.29, 0.0), ring * uSunMark.a);
        float disc = clamp(6.0 - dpx, 0.0, 1.0);
        col = over(col, uSunMark.rgb, disc * uSunMark.a);
    }

    gl_FragColor = col;
}
`;

const hexToRgb = (hex: string): [number, number, number] => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    if (!m) return [1, 1, 1];
    return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
};

/** Inverse of a column-major 4x4 matrix (null if singular) */
function invert(m: ArrayLike<number>): Float32Array | null {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] =
        Array.from(m);
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;
    return new Float32Array([
        (a11 * b11 - a12 * b10 + a13 * b09) * det,
        (a02 * b10 - a01 * b11 - a03 * b09) * det,
        (a31 * b05 - a32 * b04 + a33 * b03) * det,
        (a22 * b04 - a21 * b05 - a23 * b03) * det,
        (a12 * b08 - a10 * b11 - a13 * b07) * det,
        (a00 * b11 - a02 * b08 + a03 * b07) * det,
        (a32 * b02 - a30 * b05 - a33 * b01) * det,
        (a20 * b05 - a22 * b02 + a23 * b01) * det,
        (a10 * b10 - a11 * b08 + a13 * b06) * det,
        (a01 * b08 - a00 * b10 - a03 * b06) * det,
        (a30 * b04 - a31 * b02 + a33 * b00) * det,
        (a21 * b02 - a20 * b04 - a23 * b00) * det,
        (a11 * b07 - a10 * b09 - a12 * b06) * det,
        (a00 * b09 - a01 * b07 + a02 * b06) * det,
        (a31 * b01 - a30 * b03 - a32 * b00) * det,
        (a20 * b03 - a21 * b01 + a22 * b00) * det,
    ]);
}

/**
 * Page-wide hook on WebGL's `useProgram` / `uniformMatrix4fv` that records the camera matrix
 * of Windy's 3D globe (`#globeCanvas`). Installed once per page and kept installed (removing
 * prototype wrappers is unsafe if anything wrapped them after us); it costs one property check
 * per call. Because it stays installed, the last camera survives closing/reopening the plugin.
 *
 * Accepted programs are the globe's surface shaders, which all place the unit sphere
 * P = (cosφ·cosλ, cosφ·sinλ, sinφ) with `uMatMVP`: the per-frame colour-map program
 * (has `uDirToCam`) and the tile programs (have `uXYRange`).
 */
interface GlobeHookState {
    mvp: Float32Array | null;
    canvas: HTMLCanvasElement | null;
    listener: (() => void) | null;
}

const HOOK_KEY = '__windyPluginDayNightGlobeHook';

function installGlobeHook(): GlobeHookState {
    const w = window as any;
    if (w[HOOK_KEY]) return w[HOOK_KEY];
    const state: GlobeHookState = { mvp: null, canvas: null, listener: null };
    w[HOOK_KEY] = state;

    const CUR = Symbol('dnCurrentProgram');
    const kind = new WeakMap<WebGLProgram, boolean>();

    const isCameraProgram = (gl: WebGLRenderingContext, p: WebGLProgram): boolean => {
        let v = kind.get(p);
        if (v === undefined) {
            v = false;
            try {
                const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
                const names: string[] = [];
                for (let i = 0; i < n; i++) names.push(gl.getActiveUniform(p, i)!.name);
                v =
                    names.includes('uMatMVP') &&
                    (names.includes('uXYRange') || names.includes('uDirToCam'));
            } catch {
                v = false;
            }
            kind.set(p, v);
        }
        return v;
    };

    for (const Ctx of [
        (window as any).WebGLRenderingContext,
        (window as any).WebGL2RenderingContext,
    ]) {
        if (!Ctx) continue;
        const proto = Ctx.prototype;
        const origUse = proto.useProgram;
        const origMat = proto.uniformMatrix4fv;
        proto.useProgram = function (this: any, p: WebGLProgram | null) {
            this[CUR] = p;
            return origUse.call(this, p);
        };
        proto.uniformMatrix4fv = function (this: any, loc: any, transpose: boolean, data: any) {
            // eslint-disable-next-line prefer-rest-params
            const res = origMat.apply(this, arguments);
            const canvas = this.canvas;
            if (canvas && canvas.id === 'globeCanvas' && data && this[CUR]) {
                if (isCameraProgram(this, this[CUR])) {
                    // eslint-disable-next-line prefer-rest-params
                    const off = typeof arguments[3] === 'number' ? arguments[3] : 0;
                    let changed = !state.mvp || state.canvas !== canvas;
                    const m = state.mvp ?? new Float32Array(16);
                    for (let i = 0; i < 16; i++) {
                        const v = data[off + i];
                        if (m[i] !== v) {
                            m[i] = v;
                            changed = true;
                        }
                    }
                    state.mvp = m;
                    state.canvas = canvas;
                    if (changed && state.listener) state.listener();
                }
            }
            return res;
        };
    }
    return state;
}

export class DayNightOverlay {
    private canvas: HTMLCanvasElement;
    private gl: WebGLRenderingContext;
    private prog: WebGLProgram;
    private u: Record<string, WebGLUniformLocation | null> = {};
    private ml: any;
    private hook: GlobeHookState;
    private globeCanvas: HTMLCanvasElement | null = null;
    private mode: '2d' | '3d' | null = null;
    private sun: SunPosition | null = null;
    private opts: DayNightOptions;
    private destroyed = false;
    private pending = false;
    private pollTimer: ReturnType<typeof setInterval>;
    private readonly redraw2D = () => this.mode === '2d' && this.draw();
    private readonly schedule = () => {
        if (this.pending) return;
        this.pending = true;
        // same task as the globe's own frame → no visible lag
        queueMicrotask(() => {
            this.pending = false;
            this.draw();
        });
    };

    constructor(opts: DayNightOptions) {
        this.opts = opts;
        this.ml = (leafletMap as any).maplibreMap ?? (leafletMap as any)._maplibreMap;

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'windy-plugin-day-night-overlay';
        Object.assign(this.canvas.style, {
            position: 'absolute',
            left: '0px',
            top: '0px',
            pointerEvents: 'none',
        });
        const gl = this.canvas.getContext('webgl', {
            premultipliedAlpha: true,
            alpha: true,
            antialias: false,
            depth: false,
        });
        if (!gl) throw new Error('WebGL is not available');
        this.gl = gl;
        if (!gl.getExtension('OES_standard_derivatives')) {
            throw new Error('WebGL extension OES_standard_derivatives is missing');
        }
        this.prog = this.buildProgram();

        this.hook = installGlobeHook();
        this.hook.listener = this.schedule;

        if (this.ml) {
            this.ml.on('render', this.redraw2D);
            this.ml.on('resize', this.redraw2D);
        }
        this.pollTimer = setInterval(() => this.syncMode(), 500);
        this.syncMode();
    }

    private buildProgram(): WebGLProgram {
        const gl = this.gl;
        const sh = (type: number, src: string) => {
            const s = gl.createShader(type)!;
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                throw new Error('Shader error: ' + gl.getShaderInfoLog(s));
            }
            return s;
        };
        const p = gl.createProgram()!;
        gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
        gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
        gl.bindAttribLocation(p, 0, 'aPos');
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            throw new Error('Shader link error: ' + gl.getProgramInfoLog(p));
        }
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        for (const name of [
            'uRes',
            'uDpr',
            'uMode',
            'uInvMVP',
            'uMerc',
            'uSun',
            'uLineAlt',
            'uLineColor',
            'uLineWidth',
            'uLineDash',
            'uShadeAlt',
            'uShadeOpacity',
            'uGold',
            'uLow',
            'uSunMark',
        ]) {
            this.u[name] = gl.getUniformLocation(p, name);
        }
        return p;
    }

    /** Which view is Windy showing? Moves the overlay canvas accordingly. */
    private syncMode(): void {
        if (this.destroyed) return;
        const globeCanvas = document.getElementById('globeCanvas') as HTMLCanvasElement | null;
        const globeVisible = !!globeCanvas && globeCanvas.isConnected && globeCanvas.offsetWidth > 0;

        if (globeVisible) {
            this.globeCanvas = globeCanvas;
            if (this.mode !== '3d' || this.canvas.previousElementSibling !== globeCanvas) {
                globeCanvas.insertAdjacentElement('afterend', this.canvas);
                this.mode = '3d';
            }
        } else {
            this.globeCanvas = null;
            const mlCanvas: HTMLCanvasElement | undefined = this.ml?.getCanvas?.();
            if (mlCanvas && (this.mode !== '2d' || this.canvas.previousElementSibling !== mlCanvas)) {
                mlCanvas.insertAdjacentElement('afterend', this.canvas);
                this.mode = '2d';
            }
        }
        this.draw();
    }

    /** 3D globe is shown but has not rendered a frame since we started listening */
    get waitingForGlobe(): boolean {
        return this.mode === '3d' && !(this.hook.mvp && this.hook.canvas === this.globeCanvas);
    }

    update(sun: SunPosition, opts: DayNightOptions): void {
        this.sun = sun;
        this.opts = opts;
        this.draw();
    }

    /** Matches our canvas to the one underneath; returns css size */
    private fitTo(target: HTMLCanvasElement): { w: number; h: number; dpr: number } | null {
        const w = target.clientWidth;
        const h = target.clientHeight;
        if (!w || !h) return null;
        const bw = target.width;
        const bh = target.height;
        if (this.canvas.width !== bw || this.canvas.height !== bh) {
            this.canvas.width = bw;
            this.canvas.height = bh;
        }
        const st = this.canvas.style;
        const left = `${target.offsetLeft}px`;
        const top = `${target.offsetTop}px`;
        if (st.width !== `${w}px`) st.width = `${w}px`;
        if (st.height !== `${h}px`) st.height = `${h}px`;
        if (st.left !== left) st.left = left;
        if (st.top !== top) st.top = top;
        return { w, h, dpr: bw / w };
    }

    draw(): void {
        if (this.destroyed || !this.sun || !this.mode) return;
        const gl = this.gl;
        const u = this.u;

        let size: { w: number; h: number; dpr: number } | null = null;
        let invMvp: Float32Array | null = null;
        let merc = [0, 0, 0, 0];

        if (this.mode === '3d') {
            if (!this.globeCanvas) return;
            size = this.fitTo(this.globeCanvas);
            if (!size) return;
            const mvp = this.hook.canvas === this.globeCanvas ? this.hook.mvp : null;
            if (!mvp) {
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                return;
            }
            invMvp = invert(mvp);
            if (!invMvp) return;
        } else {
            const mlCanvas: HTMLCanvasElement | undefined = this.ml?.getCanvas?.();
            if (!mlCanvas) return;
            size = this.fitTo(mlCanvas);
            if (!size) return;
            const c = this.ml.getCenter();
            const worldPx = 512 * Math.pow(2, this.ml.getZoom());
            const degPerPx = 360 / worldPx;
            const radPerPx = (2 * Math.PI) / worldPx;
            const latR = (Math.max(-85.06, Math.min(85.06, c.lat)) * Math.PI) / 180;
            const mercC = Math.log(Math.tan(Math.PI / 4 + latR / 2));
            merc = [c.lng - (size.w / 2) * degPerPx, degPerPx, mercC + (size.h / 2) * radPerPx, -radPerPx];
        }

        const o = this.opts;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.prog);
        gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
        gl.uniform1f(u.uDpr, size.dpr);
        gl.uniform1f(u.uMode, this.mode === '3d' ? 1 : 0);
        gl.uniformMatrix4fv(u.uInvMVP, false, invMvp ?? new Float32Array(16));
        gl.uniform4fv(u.uMerc, merc);
        gl.uniform3fv(u.uSun, sunVector(this.sun));

        const alts: number[] = [];
        const cols: number[] = [];
        const widths: number[] = [];
        const dashes: number[] = [];
        for (const z of ZONES) {
            alts.push(zoneAltitude(z, o));
            const rgb = hexToRgb(o.colors[z.id] || z.color);
            cols.push(...rgb, o.lines[z.id] ? o.lineOpacity : 0);
            widths.push(z.width);
            dashes.push(...(z.dash ?? [0, 0]));
        }
        gl.uniform1fv(u.uLineAlt, alts);
        gl.uniform4fv(u.uLineColor, cols);
        gl.uniform1fv(u.uLineWidth, widths);
        gl.uniform2fv(u.uLineDash, dashes);
        gl.uniform4fv(u.uShadeAlt, [-0.833, -6, -12, -18]);
        gl.uniform1f(u.uShadeOpacity, o.shading ? o.shadeOpacity : 0);
        gl.uniform4f(u.uGold, 1.0, 0.6, 0.15, o.goldenTint ? o.tintOpacity : 0);
        gl.uniform4f(u.uLow, 1.0, 0.93, 0.55, o.lowTint ? o.tintOpacity * 0.6 : 0);
        gl.uniform4f(u.uSunMark, 1.0, 0.8, 0.2, o.showSun ? 1 : 0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    destroy(): void {
        this.destroyed = true;
        clearInterval(this.pollTimer);
        if (this.ml) {
            this.ml.off('render', this.redraw2D);
            this.ml.off('resize', this.redraw2D);
        }
        if (this.hook.listener === this.schedule) this.hook.listener = null;
        this.canvas.remove();
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}
