import "../utils/Vector3Float32";

export type SkyPreset = "day" | "sunset" | "procedural";

export interface ProceduralSkySettings {
    inclination: number;
    azimuth: number;
    luminance: number;
    turbidity: number;
    rayleigh: number;
    mieCoefficient: number;
    mieDirectionalG: number;
    sunPosition: BABYLON.Vector3;
}

const REAL_SKY_VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vLocalPos;

void main(void) {
    vLocalPos = position;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const REAL_PHOTO_SKY_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vLocalPos;

uniform sampler2D uSkyTex;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHorizonColor;
uniform float uAzimuthOffset;
uniform float uTime;
uniform float uCloudSpeed;
uniform float uCloudCoverage;
uniform float uExposure;
uniform float uIsUnderwater;

float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm3(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
    for (int i = 0; i < 3; i++) {
        v += amp * valueNoise(p);
        p = rot * p * 2.04 + vec2(17.1, 31.7);
        amp *= 0.5;
    }
    return v;
}

void main(void) {
    vec3 d = normalize(vLocalPos);
    float ca = cos(uAzimuthOffset);
    float sa = sin(uAzimuthOffset);
    vec3 rd = vec3(d.x * ca - d.z * sa, d.y, d.x * sa + d.z * ca);

    float safeX = (abs(rd.x) < 1e-5 && abs(rd.z) < 1e-5) ? 1e-5 : rd.x;
    float lon = atan(rd.z, safeX);
    float lat = acos(clamp(rd.y, -1.0, 1.0));
    vec2 skyUV = vec2(lon * 0.15915494309 + 0.5, 1.0 - lat * 0.31830988618);

    vec3 col = texture2D(uSkyTex, skyUV).rgb * uExposure;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = max(vec3(0.0), mix(vec3(lum), col, 1.16));

    // Gentle living high-altitude cirrus wisps drifting with the sea wind
    if (d.y > 0.01 && uCloudSpeed > 0.001) {
        vec2 domeUV = rd.xz / (max(d.y, 0.06) + 0.24);
        vec2 wind = vec2(uTime * uCloudSpeed * 0.012, uTime * uCloudSpeed * 0.004);
        float w1 = fbm3(domeUV * 1.45 + wind);
        float w2 = fbm3(domeUV * 3.10 - wind * 0.6 + vec2(w1 * 0.65));
        float wisp = smoothstep(0.56 - (uCloudCoverage - 0.5) * 0.14, 0.88, w1 * 0.65 + w2 * 0.35);
        float horizonMask = smoothstep(0.02, 0.28, d.y);
        vec3 wispTint = mix(vec3(0.95, 0.97, 1.0), uSunColor * 1.05, 0.35);
        col = mix(col, wispTint, wisp * horizonMask * 0.18);
    }

    // Subtle real-time solar aura aligned with HDR sun vector
    vec3 sDir = normalize(uSunDir);
    float sunCos = max(dot(d, sDir), 0.0001);
    float aboveHorizon = smoothstep(-0.02, 0.08, d.y);
    float mieGlow = pow(sunCos, 10.0) * 0.08 + pow(sunCos, 96.0) * 0.24;
    float sunCore = smoothstep(0.9990, 0.99982, sunCos) * 0.55;
    col += (mieGlow + sunCore) * uSunColor * aboveHorizon;

    // Seamless transition between distant horizon sky and ocean distance mist
    float horizonBlend = 1.0 - smoothstep(-0.02, 0.08, d.y);
    col = mix(col, uHorizonColor, horizonBlend * 0.78);

    // Submersion underwater teal absorption
    col = mix(col, vec3(0.02, 0.22, 0.34), clamp(uIsUnderwater, 0.0, 1.0) * 0.96);

    gl_FragColor = vec4(col, 1.0);
}
`;

const DYNAMIC_CLOUD_SKY_FRAGMENT_SHADER = `
precision highp float;
varying vec3 vLocalPos;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHorizonColor;
uniform float uTurbidity;
uniform float uRayleigh;
uniform float uMieCoeff;
uniform float uMieG;
uniform float uLuminance;
uniform float uCloudCoverage;
uniform float uCloudSpeed;
uniform float uTime;
uniform float uIsUnderwater;

float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

float vNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cloudFbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
    for (int i = 0; i < 4; i++) {
        sum += amp * vNoise(p);
        p = rot * p * 2.03 + vec2(19.3, 47.7);
        amp *= 0.5;
    }
    return sum;
}

void main(void) {
    vec3 d = normalize(vLocalPos);
    vec3 sDir = normalize(uSunDir);

    float sunElev = sDir.y;
    float dayFactor = smoothstep(-0.08, 0.38, sunElev);
    float sunsetFactor = smoothstep(-0.12, 0.14, sunElev) * (1.0 - smoothstep(0.14, 0.52, sunElev));
    float nightFactor = 1.0 - smoothstep(-0.22, 0.04, sunElev);

    float rayScale = clamp(uRayleigh * 0.55, 0.25, 2.2);
    float turbScale = clamp((uTurbidity - 1.0) * 0.07, 0.0, 0.85);

    vec3 dayZenith = vec3(0.09, 0.29, 0.64) * mix(1.0, 0.72, turbScale);
    vec3 sunsetZenith = vec3(0.11, 0.18, 0.38);
    vec3 nightZenith = vec3(0.015, 0.03, 0.08);
    vec3 zenithCol = mix(mix(sunsetZenith, dayZenith, dayFactor), nightZenith, nightFactor);

    vec3 dayHorizon = mix(vec3(0.54, 0.73, 0.90), vec3(0.70, 0.76, 0.82), turbScale * 0.5);
    vec3 sunsetHorizon = vec3(0.92, 0.56, 0.34);
    vec3 nightHorizon = vec3(0.05, 0.09, 0.17);
    vec3 horizCol = mix(mix(sunsetHorizon, dayHorizon, dayFactor), nightHorizon, nightFactor);

    float skyT = pow(max(1.0 - clamp(d.y, 0.0, 1.0), 0.0001), 2.6 / max(rayScale, 0.4));
    vec3 skyCol = mix(zenithCol, horizCol, skyT);

    // Directional solar atmospheric scatter + Henyey-Greenstein Mie aureole
    float sunCos = max(dot(d, sDir), 0.0001);
    float g = clamp(uMieG, 0.1, 0.96);
    float g2 = g * g;
    float miePhase = (1.0 - g2) / max(pow(max(1.0 + g2 - 2.0 * g * sunCos, 0.0001), 1.5), 0.001);
    float mieGlow = clamp(miePhase * uMieCoeff * 3.8, 0.0, 1.4);

    vec3 warmSun = mix(uSunColor, vec3(1.0, 0.58, 0.24), sunsetFactor * 0.65);
    float horizonGlow = pow(sunCos, 4.0) * exp(-max(d.y, 0.0) * 4.5) * (0.35 + sunsetFactor * 0.65);
    float sunDisc = smoothstep(0.9992, 0.99985, sunCos) * (1.6 - nightFactor * 1.4);

    skyCol += warmSun * (mieGlow * 0.42 + horizonGlow * 0.55 + sunDisc) * smoothstep(-0.04, 0.05, d.y);

    // Curved 3D perspective sky dome cloud layers
    if (d.y > 0.005) {
        float shellDist = 1.0 / (d.y + 0.11);
        vec2 wind = vec2(uTime * uCloudSpeed * 0.018, uTime * uCloudSpeed * 0.006);
        vec2 cPos = d.xz * shellDist * 1.35 + wind;

        // Domain-warped Cumulus deck
        float warp = cloudFbm(cPos * 0.65 + vec2(3.1, 7.4));
        float baseN = cloudFbm(cPos + vec2(warp * 0.55));
        float detailN = cloudFbm(cPos * 2.6 - wind * 0.7);
        float rawCloud = baseN * 0.74 + detailN * 0.26;

        float thresh = mix(0.76, 0.34, clamp(uCloudCoverage, 0.0, 1.0));
        float density = smoothstep(thresh, thresh + 0.22, rawCloud);

        // Self-shadow offset toward sun
        vec2 sunStep = normalize(sDir.xz + vec2(0.0001, 0.0001)) * 0.14;
        float shadowSample = cloudFbm(cPos + sunStep + vec2(warp * 0.55));
        float sunAccess = clamp(0.62 + (rawCloud - shadowSample) * 3.4, 0.15, 1.0);

        vec3 cloudLit = mix(vec3(1.0, 0.99, 0.97), vec3(1.0, 0.76, 0.50), sunsetFactor * 0.9);
        cloudLit = mix(cloudLit, vec3(0.22, 0.27, 0.38), nightFactor);
        vec3 cloudShade = mix(vec3(0.45, 0.55, 0.69), vec3(0.32, 0.26, 0.36), sunsetFactor);
        cloudShade = mix(cloudShade, vec3(0.06, 0.09, 0.16), nightFactor);

        vec3 cloudCol = mix(cloudShade, cloudLit, sunAccess);
        cloudCol += warmSun * pow(sunCos, 8.0) * (1.0 - density * 0.65) * 0.45;

        // High-altitude Cirrus wisps
        vec2 cirrusUV = d.xz * (1.0 / (d.y + 0.18)) * 2.3 + wind * 1.4;
        float cirrus = smoothstep(0.60, 0.88, cloudFbm(cirrusUV * vec2(1.0, 2.2)));
        float totalCloud = clamp(density + cirrus * 0.25 * (1.0 - density), 0.0, 0.96);

        float distFade = smoothstep(0.005, 0.14, d.y);
        skyCol = mix(skyCol, mix(cloudLit * 0.95, cloudCol, density / max(totalCloud, 0.001)), totalCloud * distFade);
    }

    skyCol *= clamp(uLuminance, 0.2, 2.0);
    float horizonBlend = 1.0 - smoothstep(-0.03, 0.04, d.y);
    skyCol = mix(skyCol, uHorizonColor, horizonBlend * 0.90);
    skyCol = mix(skyCol, vec3(0.02, 0.22, 0.34), clamp(uIsUnderwater, 0.0, 1.0) * 0.96);

    gl_FragColor = vec4(skyCol, 1.0);
}
`;

const PRESET_CONFIGS: Record<"day" | "sunset", {
    textureUrl: string;
    sunU: number;
    sunV: number;
    defaultAzimuth: number;
    sunColor: BABYLON.Color3;
    horizonColor: BABYLON.Vector3;
    exposure: number;
}> = {
    day: {
        textureUrl: "sky/day_sky.jpg",
        sunU: 0.5947,
        sunV: 0.2331,
        defaultAzimuth: 2.65,
        sunColor: new BABYLON.Color3(1.0, 0.96, 0.89),
        horizonColor: new BABYLON.Vector3(0.42, 0.62, 0.84),
        exposure: 0.92,
    },
    sunset: {
        textureUrl: "sky/sunset_sky.jpg",
        sunU: 0.5708,
        sunV: 0.3663,
        defaultAzimuth: 2.65,
        sunColor: new BABYLON.Color3(1.0, 0.74, 0.45),
        horizonColor: new BABYLON.Vector3(0.68, 0.52, 0.45),
        exposure: 0.96,
    },
};

export class SkyBox {
    private static _ShadersRegistered = false;

    private _scene: BABYLON.Scene;
    private _skybox: BABYLON.Mesh;
    private _probe: BABYLON.ReflectionProbe;
    private _skyboxObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>>;

    private _photoMaterial: BABYLON.ShaderMaterial | null = null;
    private _proceduralMaterial: BABYLON.ShaderMaterial | null = null;
    private _photoTextures: Partial<Record<"day" | "sunset", BABYLON.Texture>> = {};

    private _preset: SkyPreset = "day";
    private _azimuthTurns = 0.42; // 0..1 normalized turns around horizon
    private _cloudSpeed = 1.0;
    private _cloudCoverage = 0.48;
    private _time = 0;

    private _dirty = true;
    private _dirtyCount = 2;
    private _needPolynomialsRegen = false;

    private readonly _sunDir = new BABYLON.Vector3(-0.31, 0.74, -0.59);
    private readonly _sunColor = new BABYLON.Color3(1.0, 0.96, 0.89);
    private readonly _horizonColor = new BABYLON.Vector3(0.42, 0.62, 0.84);
    private readonly _tmpSunColorVec = new BABYLON.Vector3(1.0, 0.96, 0.89);

    public readonly skyMaterial: ProceduralSkySettings = {
        inclination: 0.26,
        azimuth: 0.42,
        luminance: 1.0,
        turbidity: 4.5,
        rayleigh: 1.8,
        mieCoefficient: 0.006,
        mieDirectionalG: 0.82,
        sunPosition: new BABYLON.Vector3(-15, 37, -29),
    };

    public get probe(): BABYLON.Nullable<BABYLON.ReflectionProbe> {
        return this._probe;
    }

    public get preset(): SkyPreset {
        return this._preset;
    }

    public get azimuthTurns(): number {
        return this._azimuthTurns;
    }

    public set azimuthTurns(v: number) {
        this._azimuthTurns = BABYLON.Scalar.Clamp(v, 0, 1);
        this.skyMaterial.azimuth = this._azimuthTurns;
        this.setAsDirty();
    }

    public get cloudSpeed(): number {
        return this._cloudSpeed;
    }

    public set cloudSpeed(v: number) {
        this._cloudSpeed = BABYLON.Scalar.Clamp(v, 0, 3);
    }

    public get cloudCoverage(): number {
        return this._cloudCoverage;
    }

    public set cloudCoverage(v: number) {
        this._cloudCoverage = BABYLON.Scalar.Clamp(v, 0, 1);
        this.setAsDirty();
    }

    public setAsDirty(): void {
        this._dirty = true;
        this._dirtyCount = 2;
        this._probe.cubeTexture.refreshRate = 1;
        this._needPolynomialsRegen = true;
    }

    private static _EnsureShadersRegistered(): void {
        if (SkyBox._ShadersRegistered) return;
        SkyBox._ShadersRegistered = true;

        BABYLON.Effect.ShadersStore["realSkyVertexShader"] = REAL_SKY_VERTEX_SHADER;
        BABYLON.Effect.ShadersStore["realPhotoSkyFragmentShader"] = REAL_PHOTO_SKY_FRAGMENT_SHADER;
        BABYLON.Effect.ShadersStore["dynamicCloudSkyFragmentShader"] = DYNAMIC_CLOUD_SKY_FRAGMENT_SHADER;
    }

    constructor(initialPresetOrProcedural: SkyPreset | boolean, scene: BABYLON.Scene) {
        this._scene = scene;
        SkyBox._EnsureShadersRegistered();

        if (typeof initialPresetOrProcedural === "boolean") {
            this._preset = initialPresetOrProcedural ? "procedural" : "day";
        } else {
            this._preset = initialPresetOrProcedural;
        }

        this._skybox = BABYLON.MeshBuilder.CreateBox(
            "skyBox",
            { size: 1000.0, sideOrientation: BABYLON.Mesh.BACKSIDE },
            this._scene
        );
        this._skybox.isPickable = false;

        scene.meshes.splice(scene.meshes.indexOf(this._skybox), 1);
        scene.meshes.splice(0, 0, this._skybox);

        this._skyboxObserver = scene.onBeforeRenderObservable.add(() => {
            this.syncPosition();
        });

        // linearSpace=false so gammaSpace=true matches our sRGB shader output (prevents double-gamma sea washout)
        this._probe = new BABYLON.ReflectionProbe("skyProbe", 128, this._scene, true, true, false);
        this._probe.renderList!.push(this._skybox);
        this._probe.attachToMesh(this._skybox);
        this._probe.cubeTexture.activeCamera = this._scene.activeCameras?.[0] ?? this._scene.activeCamera!;
        this._probe.cubeTexture.refreshRate = 0;

        this._probe.cubeTexture.onAfterUnbindObservable.add(() => {
            const texture = this._probe.cubeTexture.getInternalTexture();
            if (!texture) return;
            if (texture._sphericalPolynomialComputed) {
                this._probe.cubeTexture.forceSphericalPolynomialsRecompute();
                this._needPolynomialsRegen = false;
            } else {
                this._needPolynomialsRegen = true;
            }
        });

        this._scene.environmentTexture = this._probe.cubeTexture;
        this._scene.customRenderTargets.push(this._probe.cubeTexture);

        this._initMaterials();
        this.setPreset(this._preset);
    }

    private _initMaterials(): void {
        this._photoMaterial = new BABYLON.ShaderMaterial(
            "realPhotoSkyMat",
            this._scene,
            { vertex: "realSky", fragment: "realPhotoSky" },
            {
                attributes: ["position"],
                uniforms: [
                    "worldViewProjection",
                    "uSunDir",
                    "uSunColor",
                    "uHorizonColor",
                    "uAzimuthOffset",
                    "uTime",
                    "uCloudSpeed",
                    "uCloudCoverage",
                    "uExposure",
                    "uIsUnderwater",
                ],
                samplers: ["uSkyTex"],
            }
        );
        this._photoMaterial.backFaceCulling = false;
        this._photoMaterial.disableDepthWrite = true;
        this._photoMaterial.fogEnabled = false;

        this._proceduralMaterial = new BABYLON.ShaderMaterial(
            "dynamicCloudSkyMat",
            this._scene,
            { vertex: "realSky", fragment: "dynamicCloudSky" },
            {
                attributes: ["position"],
                uniforms: [
                    "worldViewProjection",
                    "uSunDir",
                    "uSunColor",
                    "uHorizonColor",
                    "uTurbidity",
                    "uRayleigh",
                    "uMieCoeff",
                    "uMieG",
                    "uLuminance",
                    "uCloudCoverage",
                    "uCloudSpeed",
                    "uTime",
                    "uIsUnderwater",
                ],
            }
        );
        this._proceduralMaterial.backFaceCulling = false;
        this._proceduralMaterial.disableDepthWrite = true;
        this._proceduralMaterial.fogEnabled = false;
    }

    private _getPhotoTexture(preset: "day" | "sunset"): BABYLON.Texture {
        let tex = this._photoTextures[preset];
        if (!tex) {
            const cfg = PRESET_CONFIGS[preset];
            tex = new BABYLON.Texture(
                cfg.textureUrl,
                this._scene,
                true,
                true,
                BABYLON.Texture.BILINEAR_SAMPLINGMODE
            );
            tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
            tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
            tex.onLoadObservable.addOnce(() => {
                if (this._preset === preset) {
                    this.setAsDirty();
                }
            });
            this._photoTextures[preset] = tex;
        }
        return tex;
    }

    public setPreset(preset: SkyPreset): void {
        this._preset = preset;

        if (preset === "procedural") {
            this._skybox.material = this._proceduralMaterial;
        } else {
            const cfg = PRESET_CONFIGS[preset];
            this.skyMaterial.azimuth = this._azimuthTurns;
            const tex = this._getPhotoTexture(preset);
            this._photoMaterial?.setTexture("uSkyTex", tex);
            this._photoMaterial?.setFloat("uExposure", cfg.exposure);
            this._skybox.material = this._photoMaterial;
        }

        this._updateSkyLightingState();
        this.setAsDirty();
    }

    private _updateSkyLightingState(): void {
        if (this._preset === "procedural") {
            const theta = Math.PI * (this.skyMaterial.inclination - 0.5);
            const phi = 2 * Math.PI * (this.skyMaterial.azimuth - 0.5);
            const cosTheta = Math.cos(theta);
            const sx = cosTheta * Math.cos(phi);
            const sy = Math.sin(-theta);
            const sz = cosTheta * Math.sin(phi);
            this._sunDir.set(sx, sy, sz).normalize();
            this.skyMaterial.sunPosition.copyFrom(this._sunDir).scaleInPlace(500);

            const dayF = BABYLON.Scalar.Clamp((sy + 0.08) / 0.45, 0, 1);
            const sunsetF = BABYLON.Scalar.Clamp(1.0 - Math.abs(sy - 0.06) / 0.24, 0, 1);
            const nightF = BABYLON.Scalar.Clamp((-sy - 0.02) / 0.20, 0, 1);

            const r = BABYLON.Scalar.Lerp(BABYLON.Scalar.Lerp(1.0, 1.0, dayF), 0.35, nightF);
            const g = BABYLON.Scalar.Lerp(BABYLON.Scalar.Lerp(0.68, 0.96, dayF), 0.42, nightF);
            const b = BABYLON.Scalar.Lerp(BABYLON.Scalar.Lerp(0.38, 0.89, dayF), 0.65, nightF);
            this._sunColor.set(r, g, b);

            const hr = BABYLON.Scalar.Lerp(0.86 * sunsetF + 0.52 * (1 - sunsetF), 0.06, nightF);
            const hg = BABYLON.Scalar.Lerp(0.58 * sunsetF + 0.72 * (1 - sunsetF), 0.10, nightF);
            const hb = BABYLON.Scalar.Lerp(0.40 * sunsetF + 0.88 * (1 - sunsetF), 0.18, nightF);
            this._horizonColor.set(hr, hg, hb);
            return;
        }

        const cfg = PRESET_CONFIGS[this._preset];
        const azRad = this._azimuthTurns * Math.PI * 2;
        const lon = (cfg.sunU - 0.5) * Math.PI * 2;
        const lat = cfg.sunV * Math.PI;
        const rawX = Math.sin(lat) * Math.cos(lon);
        const rawY = Math.cos(lat);
        const rawZ = Math.sin(lat) * Math.sin(lon);

        // Inverse of shader Y-rotation (+azRad) so _sunDir aligns to exact sun pixel
        const ca = Math.cos(azRad);
        const sa = Math.sin(azRad);
        this._sunDir.set(rawX * ca + rawZ * sa, rawY, -rawX * sa + rawZ * ca).normalize();
        this.skyMaterial.sunPosition.copyFrom(this._sunDir).scaleInPlace(500);
        this._sunColor.copyFrom(cfg.sunColor);
        this._horizonColor.copyFrom(cfg.horizonColor);
    }

    public update(light: BABYLON.ShadowLight, dt = 0.016): boolean {
        this._time += dt;
        this._updateSkyLightingState();

        const isUnderwater = this._scene.fogMode === BABYLON.Scene.FOGMODE_EXP2 ? 1.0 : 0.0;
        this._tmpSunColorVec.set(this._sunColor.r, this._sunColor.g, this._sunColor.b);

        if (this._preset === "procedural" && this._proceduralMaterial) {
            this._proceduralMaterial.setVector3("uSunDir", this._sunDir);
            this._proceduralMaterial.setVector3("uSunColor", this._tmpSunColorVec);
            this._proceduralMaterial.setVector3("uHorizonColor", this._horizonColor);
            this._proceduralMaterial.setFloat("uTurbidity", this.skyMaterial.turbidity);
            this._proceduralMaterial.setFloat("uRayleigh", this.skyMaterial.rayleigh);
            this._proceduralMaterial.setFloat("uMieCoeff", this.skyMaterial.mieCoefficient);
            this._proceduralMaterial.setFloat("uMieG", this.skyMaterial.mieDirectionalG);
            this._proceduralMaterial.setFloat("uLuminance", this.skyMaterial.luminance);
            this._proceduralMaterial.setFloat("uCloudCoverage", this._cloudCoverage);
            this._proceduralMaterial.setFloat("uCloudSpeed", this._cloudSpeed);
            this._proceduralMaterial.setFloat("uTime", this._time);
            this._proceduralMaterial.setFloat("uIsUnderwater", isUnderwater);
        } else if (this._photoMaterial) {
            const azRad = this._azimuthTurns * Math.PI * 2;
            this._photoMaterial.setVector3("uSunDir", this._sunDir);
            this._photoMaterial.setVector3("uSunColor", this._tmpSunColorVec);
            this._photoMaterial.setVector3("uHorizonColor", this._horizonColor);
            this._photoMaterial.setFloat("uAzimuthOffset", azRad);
            this._photoMaterial.setFloat("uTime", this._time);
            this._photoMaterial.setFloat("uCloudSpeed", this._cloudSpeed);
            this._photoMaterial.setFloat("uCloudCoverage", this._cloudCoverage);
            this._photoMaterial.setFloat("uIsUnderwater", isUnderwater);
        }

        let updated = false;
        const texture = this._probe.cubeTexture.getInternalTexture();

        if (this._dirty) {
            light.position = this._sunDir.scale(30);
            light.direction = this._sunDir.negate().normalize();
            light.diffuse = this._sunColor.toLinearSpace();

            if (this._dirtyCount-- <= 0) {
                this._dirty = false;
                this._probe.cubeTexture.refreshRate = 0;
            }
            updated = true;
        }

        if (!this._dirty && this._needPolynomialsRegen && texture && texture._sphericalPolynomialComputed) {
            this._probe.cubeTexture.forceSphericalPolynomialsRecompute();
            this._needPolynomialsRegen = false;
        }

        return updated;
    }

    public syncPosition(): void {
        const activeCam = this._scene.activeCameras?.[0] ?? this._scene.activeCamera;
        if (activeCam) {
            this._skybox.position.copyFrom(activeCam.globalPosition);
        }
    }

    public getHorizonColor(): BABYLON.Vector3 {
        return this._horizonColor;
    }

    public dispose(): void {
        this._scene.onBeforeRenderObservable.remove(this._skyboxObserver);
        this._scene.customRenderTargets = [];

        this._probe.dispose();
        for (const key of Object.keys(this._photoTextures) as Array<"day" | "sunset">) {
            this._photoTextures[key]?.dispose();
        }
        this._photoMaterial?.dispose();
        this._proceduralMaterial?.dispose();
        this._skybox.dispose();
        this._scene.environmentTexture = null;
    }
}
