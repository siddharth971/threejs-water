import { Buoyancy } from '../ocean/Buoyancy';

export interface IslandSpec {
    name: string;
    centerX: number;
    centerZ: number;
    size: number;
    segments: number;
    radius: number;
    maxHeight: number;
    hasCove: boolean;
    seed: number;
}

interface IslandGrid {
    spec: IslandSpec;
    heights: Float32Array;
    halfSize: number;
    step: number;
    mesh: BABYLON.Mesh;
}

interface SwayItem {
    node: BABYLON.TransformNode;
    baseRotX: number;
    baseRotZ: number;
    phase: number;
    speed: number;
    amp: number;
}

type NPCPoseStyle = 'lookout' | 'relaxed' | 'trader' | 'officer' | 'fisher' | 'patrol';

interface IslandNPC {
    node: BABYLON.TransformNode;
    baseRotY: number;
    baseY: number;
    phase: number;
    style: NPCPoseStyle;
    baseSpineX: number;
    baseHeadY: number;
    bones: {
        spine?: BABYLON.TransformNode;
        spine2?: BABYLON.TransformNode;
        head?: BABYLON.TransformNode;
        leftArm?: BABYLON.TransformNode;
        rightArm?: BABYLON.TransformNode;
        leftForeArm?: BABYLON.TransformNode;
        rightForeArm?: BABYLON.TransformNode;
    };
    patrolStart?: BABYLON.Vector2;
    patrolEnd?: BABYLON.Vector2;
    patrolSpeed?: number;
}

interface MooredBoat {
    node: BABYLON.TransformNode;
    baseY: number;
    phaseOffset: number;
    baseRotY: number;
}

export interface IslandCollisionResult {
    collided: boolean;
    pushX: number;
    pushZ: number;
}

const MAIN_ISLAND: IslandSpec = {
    name: 'pirateCoveIsland',
    centerX: -68,
    centerZ: -78,
    size: 136,
    segments: 120,
    radius: 48,
    maxHeight: 11.4,
    hasCove: true,
    seed: 1.7,
};

const ATOLL_ISLAND: IslandSpec = {
    name: 'seaStackAtoll',
    centerX: 56,
    centerZ: -58,
    size: 68,
    segments: 68,
    radius: 22,
    maxHeight: 7.4,
    hasCove: false,
    seed: 4.3,
};

const COVE_BAY_ANGLE = Math.atan2(64, 70.5);

/**
 * Generates walkable tropical islands with wet-sand shoreline shaders, underwater seabed caustics,
 * asymmetric rocky ridges, sandy footpaths, swaying palms, dense bushes, reef outcrops, and a Pirate Cove pier.
 */
export class PirateIslandWorld {
    private _scene: BABYLON.Scene;
    private _shadowGenerator: BABYLON.ShadowGenerator;
    private _depthRenderList: BABYLON.AbstractMesh[];
    private _buoyancy: Buoyancy;

    private _root: BABYLON.TransformNode;
    private _islands: IslandGrid[] = [];
    private _swayItems: SwayItem[] = [];
    private _terrainMat: BABYLON.PBRCustomMaterial | null = null;
    private _detailTex: BABYLON.DynamicTexture | null = null;
    private _campfireLight: BABYLON.PointLight | null = null;
    private _covePathA = new BABYLON.Vector2(-44, -56);
    private _covePathB = new BABYLON.Vector2(-52, -62);
    private _time = 0;
    private _npcs: IslandNPC[] = [];
    private _mooredBoats: MooredBoat[] = [];

    constructor(
        scene: BABYLON.Scene,
        shadowGenerator: BABYLON.ShadowGenerator,
        depthRenderer: BABYLON.DepthRenderer,
        buoyancy: Buoyancy
    ) {
        this._scene = scene;
        this._shadowGenerator = shadowGenerator;
        this._depthRenderList = depthRenderer.getDepthMap().renderList!;
        this._buoyancy = buoyancy;

        this._root = new BABYLON.TransformNode('pirateIslandsRoot', scene);

        this._detailTex = this._createDetailTexture();
        this._createTerrainMaterial();
        this._buildIslandMesh(MAIN_ISLAND);
        this._buildIslandMesh(ATOLL_ISLAND);
        this._computeCoveAnchors();
        void this._populateWorldPropsAsync();
    }

    private _createDetailTexture(): BABYLON.DynamicTexture {
        const size = 256;
        const tex = new BABYLON.DynamicTexture('pirateIslandDetailTex', { width: size, height: size }, this._scene, true);
        tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        const ctx = tex.getContext();
        const img = ctx.getImageData(0, 0, size, size);
        const data = img.data;

        const hash2 = (ix: number, iy: number, period: number, seed: number): number => {
            const x = ((ix % period) + period) % period;
            const y = ((iy % period) + period) % period;
            let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
            n = ((n ^ (n >> 13)) * 1274126177) | 0;
            return ((n ^ (n >> 16)) >>> 0) / 4294967295;
        };

        const smoothTileNoise = (u: number, v: number, period: number, seed: number): number => {
            const gx = u * period;
            const gy = v * period;
            const ix = Math.floor(gx);
            const iy = Math.floor(gy);
            const fx = gx - ix;
            const fy = gy - iy;
            const sx = fx * fx * (3 - 2 * fx);
            const sy = fy * fy * (3 - 2 * fy);
            const n00 = hash2(ix, iy, period, seed);
            const n10 = hash2(ix + 1, iy, period, seed);
            const n01 = hash2(ix, iy + 1, period, seed);
            const n11 = hash2(ix + 1, iy + 1, period, seed);
            const nx0 = n00 + (n10 - n00) * sx;
            const nx1 = n01 + (n11 - n01) * sx;
            return nx0 + (nx1 - nx0) * sy;
        };

        for (let py = 0; py < size; py++) {
            const v = py / size;
            for (let px = 0; px < size; px++) {
                const u = px / size;
                // R: wind-rippled beach sand & fine mineral grain
                const ripple = 0.5 + 0.5 * Math.sin((u * 8 + v * 6 + smoothTileNoise(u, v, 8, 1) * 1.4) * Math.PI * 2);
                const sandFine = smoothTileNoise(u, v, 32, 3) * 0.55 + smoothTileNoise(u, v, 64, 7) * 0.45;
                const sandVal = ripple * 0.45 + sandFine * 0.55;

                // G: lush foliage clumps & dark forest soil
                const grassVal =
                    smoothTileNoise(u, v, 12, 11) * 0.48 +
                    smoothTileNoise(u, v, 24, 17) * 0.34 +
                    smoothTileNoise(u, v, 64, 23) * 0.18;

                // B: angular rocky cliff fissures & strata ledges
                const rBase = smoothTileNoise(u, v, 10, 31) * 0.6 + smoothTileNoise(u, v, 20, 37) * 0.4;
                const strata = 1.0 - Math.abs((rBase * 2.0 - 1.0));
                const crack = Math.pow(strata, 1.8) * 0.72 + smoothTileNoise(u, v, 48, 43) * 0.28;

                const idx = (py * size + px) * 4;
                data[idx + 0] = Math.round(sandVal * 255);
                data[idx + 1] = Math.round(grassVal * 255);
                data[idx + 2] = Math.round(crack * 255);
                data[idx + 3] = 255;
            }
        }

        ctx.putImageData(img, 0, 0);
        tex.update(true);
        return tex;
    }

    private _computeCoveAnchors(): void {
        let shoreR = MAIN_ISLAND.radius * 0.72;
        for (let rr = MAIN_ISLAND.radius * 0.42; rr <= MAIN_ISLAND.radius * 1.05; rr += 0.5) {
            const probeX = MAIN_ISLAND.centerX + Math.cos(COVE_BAY_ANGLE) * rr;
            const probeZ = MAIN_ISLAND.centerZ + Math.sin(COVE_BAY_ANGLE) * rr;
            if (this.getTerrainHeightAt(probeX, probeZ) <= 0.15) {
                shoreR = rr - 1.2;
                break;
            }
        }
        const pierBaseX = MAIN_ISLAND.centerX + Math.cos(COVE_BAY_ANGLE) * shoreR;
        const pierBaseZ = MAIN_ISLAND.centerZ + Math.sin(COVE_BAY_ANGLE) * shoreR;
        const campR = Math.max(8, shoreR - 8.5);
        const campX = MAIN_ISLAND.centerX + Math.cos(COVE_BAY_ANGLE - 0.18) * campR;
        const campZ = MAIN_ISLAND.centerZ + Math.sin(COVE_BAY_ANGLE - 0.18) * campR;
        this._covePathA.set(pierBaseX, pierBaseZ);
        this._covePathB.set(campX, campZ);
    }

    private _pseudoNoise2D(x: number, z: number, seed: number): number {
        const a = Math.sin(x * 0.11 + seed * 3.1) * Math.cos(z * 0.13 - seed * 1.9);
        const b = Math.sin((x + z) * 0.24 + seed * 5.7) * 0.5;
        const c = Math.cos((x * 0.43 - z * 0.37) + seed * 2.3) * 0.25;
        return (a + b + c) / 1.75;
    }

    private _evaluateProceduralHeight(worldX: number, worldZ: number, spec: IslandSpec): number {
        const dx = worldX - spec.centerX;
        const dz = worldZ - spec.centerZ;
        const dist = Math.hypot(dx, dz);
        const angle = Math.atan2(dz, dx);

        // Organic coastline radius modulation
        const coastWarp =
            1.0 +
            0.14 * Math.sin(angle * 3.0 + spec.seed) +
            0.09 * Math.cos(angle * 5.0 - spec.seed * 1.4) +
            0.05 * Math.sin(angle * 8.0 + spec.seed * 2.1);
        const effRadius = spec.radius * coastWarp;

        // Normalized radial coordinate: 0 at center, 1 at shoreline, >1 shallow turquoise lagoon shelf
        const t = dist / effRadius;

        if (t >= 1.42) {
            return -8.0;
        }

        let baseH = 0;
        if (t < 1.0) {
            const u = 1.0 - t;
            // Flat coastal beach berm transitioning from shore up to ~1.8m dry sand shelf
            const bermT = Math.min(1, u / 0.30);
            const beachBerm = bermT * bermT * (3.0 - 2.0 * bermT) * 1.45 + u * 0.85;

            if (spec.hasCove) {
                // Asymmetric dual-ridge topography: dramatic NW craggy bluff + lower ENE palm knoll
                const d1 = Math.hypot(dx + 12, dz + 10) / (effRadius * 0.64);
                const d2 = Math.hypot(dx - 15, dz + 5) / (effRadius * 0.50);
                const bluff1 = Math.max(0, 1.0 - d1);
                const bluff2 = Math.max(0, 1.0 - d2);
                const ridgeH1 = bluff1 * bluff1 * (3.0 - 2.0 * bluff1) * (spec.maxHeight - 1.8);
                const ridgeH2 = bluff2 * bluff2 * (3.0 - 2.0 * bluff2) * (spec.maxHeight * 0.54);
                baseH = beachBerm + Math.max(ridgeH1, ridgeH2) + Math.min(ridgeH1, ridgeH2) * 0.25;
            } else {
                // Sea-Stack Atoll: off-center limestone outcrop + tapering low sandspit
                const dAtoll = Math.hypot(dx + 5, dz + 4) / (effRadius * 0.72);
                const w = Math.max(0, 1.0 - dAtoll);
                baseH = beachBerm + w * w * (3.0 - 2.0 * w) * (spec.maxHeight - 1.8);
            }
        } else {
            // Wide gentle coral-sand lagoon shelf (0m..-3.2m) before dropping off into deep ocean (-8.0m)
            const s = (t - 1.0) / 0.42;
            baseH = -8.0 * Math.pow(s, 1.45);
        }

        // Carve welcoming crescent sandy bay & wide gently sloped landing beach facing the pirate ship
        if (spec.hasCove) {
            let da = Math.abs(angle - COVE_BAY_ANGLE);
            if (da > Math.PI) da = Math.PI * 2 - da;
            const bayAngularMask = Math.max(0, 1.0 - da / 0.85);
            const bayRadialMask = Math.exp(-Math.pow((t - 0.75) / 0.28, 2));
            const carve = bayAngularMask * bayAngularMask * bayRadialMask * 2.15;
            baseH -= carve;
        }

        // Angular craggy ridges along high rock bluffs + soft organic coastal undulation
        const n1 = this._pseudoNoise2D(worldX * 0.90, worldZ * 0.90, spec.seed);
        const cragNoise = (1.0 - Math.abs(this._pseudoNoise2D(worldX * 1.15, worldZ * 1.15, spec.seed + 3.7))) * 2.0 - 1.0;
        const microNoise = this._pseudoNoise2D(worldX * 2.4, worldZ * 2.4, spec.seed + 9.1) * 0.28;
        const bluffWeight = Math.max(0, Math.min(1, (baseH - 2.2) / 5.5));
        const heightModMask = Math.max(0, 1.0 - Math.max(0, t - 0.85) / 0.57);

        return Math.max(-8.0, baseH + (n1 * 1.15 + cragNoise * 1.45 * bluffWeight + microNoise) * heightModMask);
    }

    private _createTerrainMaterial(): void {
        const mat = new BABYLON.PBRCustomMaterial('pirateIslandTerrainMat', this._scene);
        mat.metallic = 0.0;
        mat.roughness = 0.88;
        mat.backFaceCulling = true;
        mat.environmentIntensity = 0.95;

        mat.AddUniform('_Time', 'float', 0);
        mat.AddUniform('uPathA', 'vec2', this._covePathA);
        mat.AddUniform('uPathB', 'vec2', this._covePathB);
        if (this._detailTex) {
            mat.AddUniform('uDetailTex', 'sampler2D', this._detailTex);
        }

        mat.Fragment_Before_Lights(`
            float h = vPositionW.y;
            float slope = 1.0 - clamp(normalW.y, 0.0, 1.0);

            vec3 det = texture2D(uDetailTex, vPositionW.xz * 0.16).rgb;
            vec3 detMacro = texture2D(uDetailTex, vPositionW.xz * 0.042).rgb;
            float detDx = texture2D(uDetailTex, (vPositionW.xz + vec2(0.18, 0.0)) * 0.16).r - det.r;
            float detDz = texture2D(uDetailTex, (vPositionW.xz + vec2(0.0, 0.18)) * 0.16).r - det.r;
            float rockDx = texture2D(uDetailTex, (vPositionW.xz + vec2(0.18, 0.0)) * 0.16).b - det.b;
            float rockDz = texture2D(uDetailTex, (vPositionW.xz + vec2(0.0, 0.18)) * 0.16).b - det.b;

            vec3 drySand = mix(vec3(0.80, 0.70, 0.49), vec3(0.92, 0.84, 0.64), det.r * 0.65 + detMacro.r * 0.35);
            vec3 wetSand = mix(vec3(0.50, 0.41, 0.26), vec3(0.59, 0.49, 0.32), det.r);
            vec3 trailDirt = mix(vec3(0.66, 0.56, 0.38), vec3(0.76, 0.65, 0.46), det.g);
            vec3 deepMoss = vec3(0.12, 0.25, 0.08);
            vec3 warmGrass = vec3(0.24, 0.38, 0.12);
            vec3 loamSoil = vec3(0.30, 0.25, 0.14);
            vec3 tropicalGrass = mix(deepMoss, warmGrass, det.g * 0.6 + detMacro.g * 0.4);
            tropicalGrass = mix(tropicalGrass, loamSoil, smoothstep(0.58, 0.90, detMacro.b) * 0.48);

            vec3 cliffRock = mix(vec3(0.32, 0.30, 0.27), vec3(0.52, 0.47, 0.41), det.b * 0.72 + detMacro.b * 0.28);

            // Tidal wave wash line oscillating smoothly up and down foreshore
            float tideLine = 0.68 + sin(_Time * 1.4 + vPositionW.x * 0.12) * 0.22;
            float wetFactor = 1.0 - smoothstep(0.10, tideLine + 0.45, h);

            vec3 beachCol = mix(drySand, wetSand, wetFactor);

            // Sandy footpath from pier to campfire clearing
            vec2 pa = vPositionW.xz - uPathA;
            vec2 ba = uPathB - uPathA;
            float hSeg = clamp(dot(pa, ba) / max(dot(ba, ba), 0.001), 0.0, 1.0);
            float distTrail = length(pa - ba * hSeg);
            float campClear = length(vPositionW.xz - uPathB);
            float trailMask = 1.0 - smoothstep(1.0, 2.35, min(distTrail, campClear * 0.62));

            float treeLineH = 1.60 + detMacro.g * 0.75;
            float grassMask = smoothstep(treeLineH, treeLineH + 1.25, h) * (1.0 - smoothstep(0.28, 0.48, slope));
            grassMask *= (1.0 - trailMask * 0.92);

            float rockMask = clamp(smoothstep(0.30, 0.54, slope) + smoothstep(7.2, 10.6, h) * 0.55, 0.0, 1.0);

            vec3 baseCol = mix(beachCol, trailDirt, trailMask * (1.0 - wetFactor) * 0.75);
            baseCol = mix(baseCol, tropicalGrass, grassMask);
            baseCol = mix(baseCol, cliffRock, rockMask);

            // Perturb normalW with world-space sand ripple & fractured rock strata bumps
            float bScale = mix(0.26, 0.85, rockMask);
            float bx = mix(detDx, rockDx, rockMask) * bScale;
            float bz = mix(detDz, rockDz, rockMask) * bScale;
            normalW = normalize(normalW + vec3(-bx, 0.0, -bz));

            // Animated underwater seabed caustics visible both underwater & near shore
            if (h < 0.25) {
                float c1 = sin(vPositionW.x * 1.65 + _Time * 2.1 + cos(vPositionW.z * 1.45 - _Time * 1.6));
                float c2 = cos(vPositionW.z * 1.85 - _Time * 1.9 + sin(vPositionW.x * 1.35 + _Time * 1.4));
                float caustic = pow(clamp(0.5 + 0.25 * (c1 + c2), 0.0, 1.0), 3.8);
                float depthAtten = 1.0 - smoothstep(-5.8, 0.25, h);
                baseCol += vec3(0.14, 0.36, 0.38) * caustic * (1.0 - depthAtten) * 0.92;
            }

            // Convert sRGB-tuned colors roughly to linear PBR albedo
            surfaceAlbedo = pow(max(baseCol, vec3(0.001)), vec3(2.2));
        `);

        mat.Fragment_Custom_MetallicRoughness(`
            float hR = vPositionW.y;
            float slopeR = 1.0 - clamp(normalW.y, 0.0, 1.0);
            float tideR = 0.68 + sin(_Time * 1.4 + vPositionW.x * 0.12) * 0.22;
            float wetR = 1.0 - smoothstep(0.10, tideR + 0.45, hR);
            float grassR = smoothstep(1.60, 2.85, hR) * (1.0 - smoothstep(0.28, 0.48, slopeR));
            float targetRoughness = mix(0.89, 0.16, wetR * (1.0 - grassR));
            metallicRoughness.g = clamp(targetRoughness, 0.12, 0.94);
        `);

        mat.onBindObservable.add(() => {
            const eff = mat.getEffect();
            if (eff) {
                eff.setFloat('_Time', this._time);
                eff.setVector2('uPathA', this._covePathA);
                eff.setVector2('uPathB', this._covePathB);
            }
        });

        this._terrainMat = mat;
    }

    private _buildIslandMesh(spec: IslandSpec): void {
        const seg = spec.segments;
        const countPerAxis = seg + 1;
        const half = spec.size * 0.5;
        const step = spec.size / seg;

        const heights = new Float32Array(countPerAxis * countPerAxis);
        const positions = new Float32Array(countPerAxis * countPerAxis * 3);
        const uvs = new Float32Array(countPerAxis * countPerAxis * 2);
        const indices: number[] = [];

        for (let iz = 0; iz <= seg; iz++) {
            const localZ = -half + iz * step;
            const worldZ = spec.centerZ + localZ;
            for (let ix = 0; ix <= seg; ix++) {
                const localX = -half + ix * step;
                const worldX = spec.centerX + localX;
                const idx = iz * countPerAxis + ix;
                const h = this._evaluateProceduralHeight(worldX, worldZ, spec);

                heights[idx] = h;
                positions[idx * 3 + 0] = localX;
                positions[idx * 3 + 1] = h;
                positions[idx * 3 + 2] = localZ;

                uvs[idx * 2 + 0] = ix / seg;
                uvs[idx * 2 + 1] = iz / seg;
            }
        }

        // Right-handed outward (+Y) counter-clockwise winding
        for (let iz = 0; iz < seg; iz++) {
            for (let ix = 0; ix < seg; ix++) {
                const a = iz * countPerAxis + ix;
                const b = a + 1;
                const c = a + countPerAxis;
                const d = c + 1;
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }

        const normals = new Float32Array(countPerAxis * countPerAxis * 3);
        BABYLON.VertexData.ComputeNormals(positions, indices, normals, { useRightHandedSystem: true });

        const mesh = new BABYLON.Mesh(spec.name, this._scene);
        const vdata = new BABYLON.VertexData();
        vdata.positions = positions;
        vdata.indices = indices;
        vdata.normals = normals;
        vdata.uvs = uvs;
        vdata.applyToMesh(mesh, false);

        mesh.parent = this._root;
        mesh.position.set(spec.centerX, 0, spec.centerZ);
        mesh.material = this._terrainMat;
        mesh.receiveShadows = true;
        mesh.isPickable = false;

        this._shadowGenerator.addShadowCaster(mesh);
        this._depthRenderList.push(mesh);

        this._islands.push({
            spec,
            heights,
            halfSize: half,
            step,
            mesh,
        });
    }

    /**
     * Returns exact terrain Y height at world `(x, z)` using bilinear interpolation,
     * or `-20` in deep open ocean away from all islands.
     */
    public getTerrainHeightAt(worldX: number, worldZ: number): number {
        let bestH = -20;

        for (const island of this._islands) {
            const lx = worldX - island.spec.centerX;
            const lz = worldZ - island.spec.centerZ;
            if (Math.abs(lx) >= island.halfSize || Math.abs(lz) >= island.halfSize) {
                continue;
            }

            const gx = (lx + island.halfSize) / island.step;
            const gz = (lz + island.halfSize) / island.step;
            const ix = Math.min(island.spec.segments - 1, Math.max(0, Math.floor(gx)));
            const iz = Math.min(island.spec.segments - 1, Math.max(0, Math.floor(gz)));
            const tx = gx - ix;
            const tz = gz - iz;

            const stride = island.spec.segments + 1;
            const h00 = island.heights[iz * stride + ix];
            const h10 = island.heights[iz * stride + ix + 1];
            const h01 = island.heights[(iz + 1) * stride + ix];
            const h11 = island.heights[(iz + 1) * stride + ix + 1];

            const h0 = h00 + (h10 - h00) * tx;
            const h1 = h01 + (h11 - h01) * tx;
            const h = h0 + (h1 - h0) * tz;
            if (h > bestH) {
                bestH = h;
            }
        }

        return bestH;
    }

    /**
     * Checks shallow reef / island grounding collision for the pirate ship hull.
     */
    public getShipCollision(shipX: number, shipZ: number, hullRadius = 7.5): IslandCollisionResult {
        for (const island of this._islands) {
            const dx = shipX - island.spec.centerX;
            const dz = shipZ - island.spec.centerZ;
            const dist = Math.hypot(dx, dz);
            const hCenter = this.getTerrainHeightAt(shipX, shipZ);

            // Probe 4 points around hull edge
            let maxEdgeH = hCenter;
            for (let k = 0; k < 4; k++) {
                const ang = (k * Math.PI) / 2;
                const px = shipX + Math.cos(ang) * hullRadius;
                const pz = shipZ + Math.sin(ang) * hullRadius;
                const ph = this.getTerrainHeightAt(px, pz);
                if (ph > maxEdgeH) maxEdgeH = ph;
            }

            // Ground if seabed rises shallower than -2.4m
            if (maxEdgeH > -2.4 && dist > 0.001) {
                const inv = 1 / dist;
                return {
                    collided: true,
                    pushX: dx * inv,
                    pushZ: dz * inv,
                };
            }
        }

        return { collided: false, pushX: 0, pushZ: 0 };
    }

    private _registerInstanceForScene(root: BABYLON.TransformNode, castShadow: boolean, depthFoam: boolean): void {
        const meshes = root.getChildMeshes(false);
        for (const m of meshes) {
            m.isPickable = false;
            m.receiveShadows = true;
            if (castShadow) {
                this._shadowGenerator.addShadowCaster(m);
            }
            if (depthFoam && m.getTotalVertices() > 0) {
                this._depthRenderList.push(m);
            }
        }
    }

    private _tuneContainerMaterials(
        container: BABYLON.AssetContainer,
        roughnessBoost = 0,
        tint?: BABYLON.Color3
    ): void {
        for (const mat of container.materials) {
            const pbr = mat as BABYLON.PBRMaterial;
            if (pbr) {
                pbr.backFaceCulling = false;
                if ('twoSidedLighting' in pbr) pbr.twoSidedLighting = true;
                if ('environmentIntensity' in pbr) pbr.environmentIntensity = 0.95;
                if (roughnessBoost > 0 && typeof pbr.roughness === 'number') {
                    pbr.roughness = Math.min(0.95, pbr.roughness + roughnessBoost);
                }
                if (tint) {
                    pbr.albedoColor = pbr.albedoColor ? pbr.albedoColor.multiply(tint) : tint.clone();
                }
            }
        }
    }

    private async _populateWorldPropsAsync(): Promise<void> {
        try {
            const [
                palmContainer,
                fernContainer,
                grassContainer,
                boulderContainer,
                seaStackContainer,
                pierContainer,
                lanternContainer,
                chestContainer,
                campfireContainer,
                barrelContainer,
                phIslandTree1Container,
                phIslandTree2Container,
                phIslandTree3Container,
                phPachiraContainer,
                palmSaplingContainer,
                tropicalBushContainer,
                bananaContainer,
                taroContainer,
                tiPlantContainer,
                treeFernContainer,
                agaveContainer,
                chileanPalmContainer,
                floweringShrubContainer,
                phFernContainer,
                phCalatheaContainer,
                phAnthuriumContainer,
                phShrubContainer,
                rowboatContainer,
                longboatContainer,
                fishingBoatContainer,
                brigantineContainer,
                deckhHandContainer,
                traderContainer,
                navyContainer,
                fisherContainer,
            ] = await Promise.all([
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'palm_tree.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'fern.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'beach_grass.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'boulder.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'sea_stack.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'pier_section.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'lantern_post.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'treasure_chest.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'campfire.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'barrel.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'ph_island_tree1.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'ph_island_tree2.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'ph_island_tree3.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'ph_pachira.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'palm_sapling.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'tropical_bush.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'banana_plant.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'taro_plant.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'ti_plant.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'tree_fern.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'flowering_agave.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'chilean_palm.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'flowering_shrub.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'ph_fern.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'ph_calathea.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'ph_anthurium.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'ph_shrub.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'rowboat.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'longboat.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'fishing_boat.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'brigantine.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'pirate_deckhand.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'cove_trader.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'naval_officer.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'fisherman.glb', this._scene),
            ]);

            const rockTint = new BABYLON.Color3(0.46, 0.43, 0.38);
            this._tuneContainerMaterials(palmContainer);
            this._tuneContainerMaterials(fernContainer);
            this._tuneContainerMaterials(grassContainer);
            this._tuneContainerMaterials(boulderContainer, 0.14, rockTint);
            this._tuneContainerMaterials(seaStackContainer, 0.14, rockTint);
            this._tuneContainerMaterials(pierContainer);
            this._tuneContainerMaterials(lanternContainer);
            this._tuneContainerMaterials(chestContainer);
            this._tuneContainerMaterials(campfireContainer);
            this._tuneContainerMaterials(barrelContainer);
            this._tuneContainerMaterials(phIslandTree1Container);
            this._tuneContainerMaterials(phIslandTree2Container);
            this._tuneContainerMaterials(phIslandTree3Container);
            this._tuneContainerMaterials(phPachiraContainer);
            this._tuneContainerMaterials(palmSaplingContainer);
            this._tuneContainerMaterials(tropicalBushContainer);
            this._tuneContainerMaterials(bananaContainer);
            this._tuneContainerMaterials(taroContainer);
            this._tuneContainerMaterials(tiPlantContainer);
            this._tuneContainerMaterials(treeFernContainer);
            this._tuneContainerMaterials(agaveContainer);
            this._tuneContainerMaterials(chileanPalmContainer);
            this._tuneContainerMaterials(floweringShrubContainer);
            this._tuneContainerMaterials(phFernContainer);
            this._tuneContainerMaterials(phCalatheaContainer);
            this._tuneContainerMaterials(phAnthuriumContainer);
            this._tuneContainerMaterials(phShrubContainer);
            this._tuneContainerMaterials(rowboatContainer);
            this._tuneContainerMaterials(longboatContainer);
            this._tuneContainerMaterials(fishingBoatContainer);
            this._tuneContainerMaterials(brigantineContainer);
            this._tuneContainerMaterials(deckhHandContainer);
            this._tuneContainerMaterials(traderContainer);
            this._tuneContainerMaterials(navyContainer);
            this._tuneContainerMaterials(fisherContainer);

            const spawnProp = (
                container: BABYLON.AssetContainer,
                name: string,
                x: number,
                y: number,
                z: number,
                rotY: number,
                scale: number,
                castShadow = true,
                depthFoam = false,
                swayAmp = 0,
                tiltX = 0,
                tiltZ = 0,
                doNotInstantiate = false,
                variantPick = -1
            ): BABYLON.TransformNode => {
                const inst = container.instantiateModelsToScene(
                    (sourceName) => `${name}_${sourceName}`,
                    false,
                    { doNotInstantiate: doNotInstantiate || variantPick >= 0 }
                );
                for (const ag of inst.animationGroups) {
                    ag.stop();
                }
                const node = new BABYLON.TransformNode(name, this._scene);
                node.parent = this._root;
                for (const rn of inst.rootNodes) {
                    rn.parent = node;
                }
                // Multi-variant botanical atlases (Poly Haven) pack several separate plants in one grid; pick & center one
                if (variantPick >= 0) {
                    const variants = node.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
                    if (variants.length > 1) {
                        const keepIdx = variantPick % variants.length;
                        variants[keepIdx].position.set(0, 0, 0);
                        for (let vi = 0; vi < variants.length; vi++) {
                            if (vi !== keepIdx) {
                                variants[vi].dispose(false, false);
                            }
                        }
                    }
                }
                node.position.set(x, y, z);
                node.rotation.set(tiltX, rotY, tiltZ);
                node.scaling.setAll(scale);
                this._registerInstanceForScene(node, castShadow, depthFoam);

                if (swayAmp > 0) {
                    this._swayItems.push({
                        node,
                        baseRotX: tiltX,
                        baseRotZ: tiltZ,
                        phase: Math.abs(x * 0.37 + z * 0.53),
                        speed: 1.45 + (Math.abs(Math.sin(x)) * 0.5),
                        amp: swayAmp,
                    });
                }
                return node;
            };

            const isNearCoveTrail = (wx: number, wz: number): boolean => {
                const pax = wx - this._covePathA.x;
                const paz = wz - this._covePathA.y;
                const bax = this._covePathB.x - this._covePathA.x;
                const baz = this._covePathB.y - this._covePathA.y;
                const lenSq = Math.max(0.001, bax * bax + baz * baz);
                const tSeg = Math.max(0, Math.min(1, (pax * bax + paz * baz) / lenSq));
                const distSeg = Math.hypot(pax - bax * tSeg, paz - baz * tSeg);
                const distCamp = Math.hypot(wx - this._covePathB.x, wz - this._covePathB.y);
                const distPier = Math.hypot(wx - (this._covePathA.x + Math.cos(COVE_BAY_ANGLE) * 1.5), wz - (this._covePathA.y + Math.sin(COVE_BAY_ANGLE) * 1.5));
                return distSeg < 2.8 || distCamp < 3.6 || distPier < 4.4;
            };

            // 1. Place swaying coconut palm trees across full 360° of beaches & hills
            let palmIdx = 0;
            const placePalmsRing = (spec: IslandSpec, count: number, minH: number, maxH: number, scaleMin: number, scaleMax: number) => {
                let placed = 0;
                for (let step = 0; step < 190 && placed < count; step++) {
                    const ang = step * 2.3999632 + spec.seed;
                    const rFrac = 0.16 + ((step * 29) % 19) * (0.64 / 18);
                    const r = spec.radius * rFrac;
                    const wx = spec.centerX + Math.cos(ang) * r;
                    const wz = spec.centerZ + Math.sin(ang) * r;
                    if (spec.hasCove && isNearCoveTrail(wx, wz)) continue;
                    const h = this.getTerrainHeightAt(wx, wz);
                    if (h >= minH && h <= maxH) {
                        const s = scaleMin + ((placed * 31) % 10) * 0.1 * (scaleMax - scaleMin);
                        const leanX = Math.cos(ang) * 0.12;
                        const leanZ = Math.sin(ang) * 0.12;
                        spawnProp(
                            palmContainer,
                            `palm_${palmIdx++}`,
                            wx,
                            h - 0.54,
                            wz,
                            ang + 1.2,
                            s,
                            true,
                            false,
                            0.024,
                            leanX,
                            leanZ
                        );
                        placed++;
                    }
                }
            };
            placePalmsRing(MAIN_ISLAND, 24, 1.55, 9.6, 1.08, 1.62);
            placePalmsRing(ATOLL_ISLAND, 7, 1.45, 6.2, 0.95, 1.38);

            // 2. Dense 3-layer tropical jungle bushes, mid ferns & coastal beach-grass tufts
            let vegIdx = 0;
            for (let i = 0; i < 165; i++) {
                const ang = i * 2.3999632;
                const r = 4.0 + ((i * 19) % 28) * 1.48;
                const wx = MAIN_ISLAND.centerX + Math.cos(ang) * r;
                const wz = MAIN_ISLAND.centerZ + Math.sin(ang) * r;
                if (isNearCoveTrail(wx, wz)) continue;
                const h = this.getTerrainHeightAt(wx, wz);
                if (h > 2.25 && h < 9.4) {
                    const isLargeBush = i % 3 === 0;
                    spawnProp(
                        fernContainer,
                        `fern_${vegIdx++}`,
                        wx,
                        h - (isLargeBush ? 0.24 : 0.15),
                        wz,
                        ang,
                        isLargeBush ? 2.25 + (i % 4) * 0.30 : 1.35 + (i % 3) * 0.24,
                        false,
                        false,
                        isLargeBush ? 0.022 : 0.032
                    );
                } else if (h > 1.35 && h <= 2.25) {
                    spawnProp(
                        grassContainer,
                        `grass_${vegIdx++}`,
                        wx,
                        h - 0.10,
                        wz,
                        ang,
                        1.45 + (i % 4) * 0.22,
                        false,
                        false,
                        0.045
                    );
                }
            }

            // Fill secondary Atoll island slopes with bush/grass cover too
            for (let i = 0; i < 36; i++) {
                const ang = i * 2.3999632 + 0.8;
                const r = 2.5 + ((i * 11) % 14) * 1.15;
                const wx = ATOLL_ISLAND.centerX + Math.cos(ang) * r;
                const wz = ATOLL_ISLAND.centerZ + Math.sin(ang) * r;
                const h = this.getTerrainHeightAt(wx, wz);
                if (h > 1.7 && h < 6.4) {
                    spawnProp(fernContainer, `atollFern_${vegIdx++}`, wx, h - 0.16, wz, ang, 1.85 + (i % 3) * 0.35, false, false, 0.026);
                } else if (h > 1.3 && h <= 1.7) {
                    spawnProp(grassContainer, `atollGrass_${vegIdx++}`, wx, h - 0.10, wz, ang, 1.4 + (i % 3) * 0.2, false, false, 0.042);
                }
            }

            // 3. Hillside cliff outcrops, shoreline boulders & underwater reef rocks
            let rockIdx = 0;
            // Embedded rocky cliff boulders on steep NW island bluffs
            for (let i = 0; i < 20; i++) {
                const ang = i * 2.3999632 + 1.1;
                const r = 6.0 + ((i * 13) % 18) * 1.45;
                const wx = MAIN_ISLAND.centerX - 8 + Math.cos(ang) * r;
                const wz = MAIN_ISLAND.centerZ - 6 + Math.sin(ang) * r;
                const h = this.getTerrainHeightAt(wx, wz);
                if (h > 4.2 && h < 11.2) {
                    const node = spawnProp(
                        boulderContainer,
                        `cliffOutcrop_${rockIdx++}`,
                        wx,
                        h - 0.55,
                        wz,
                        ang,
                        1.45 + (i % 4) * 0.38,
                        true,
                        false,
                        0,
                        Math.sin(ang) * 0.18,
                        Math.cos(ang) * 0.18
                    );
                    node.scaling.y *= 1.35;
                }
            }

            // Coastal shoreline boulders (keeping crescent bay landing clean) & submerged reef rocks
            for (let i = 0; i < 26; i++) {
                const spec = i < 18 ? MAIN_ISLAND : ATOLL_ISLAND;
                const ang = i * 2.3999632 + 0.5;
                if (spec.hasCove) {
                    const normAng = Math.atan2(Math.sin(ang), Math.cos(ang));
                    let da = Math.abs(normAng - COVE_BAY_ANGLE);
                    if (da > Math.PI) da = Math.PI * 2 - da;
                    if (da < 0.72) continue;
                }
                const r = spec.radius * (0.92 + ((i * 7) % 9) * 0.042);
                const wx = spec.centerX + Math.cos(ang) * r;
                const wz = spec.centerZ + Math.sin(ang) * r;
                const h = this.getTerrainHeightAt(wx, wz);
                if (h > -2.8 && h < 2.2) {
                    spawnProp(
                        boulderContainer,
                        `coastalBoulder_${rockIdx++}`,
                        wx,
                        h - 0.42,
                        wz,
                        ang,
                        0.95 + (i % 4) * 0.38,
                        true,
                        true
                    );
                }
            }

            const stackSpots: Array<[number, number, number]> = [
                [ATOLL_ISLAND.centerX - 20, ATOLL_ISLAND.centerZ - 11, 1.35],
                [ATOLL_ISLAND.centerX + 16, ATOLL_ISLAND.centerZ + 12, 1.15],
                [MAIN_ISLAND.centerX - 46, MAIN_ISLAND.centerZ + 22, 1.42],
                [MAIN_ISLAND.centerX + 40, MAIN_ISLAND.centerZ - 36, 1.28],
                [MAIN_ISLAND.centerX - 22, MAIN_ISLAND.centerZ - 38, 1.22],
            ];
            stackSpots.forEach(([sx, sz, sc], idx) => {
                const h = this.getTerrainHeightAt(sx, sz);
                spawnProp(seaStackContainer, `seaStack_${idx}`, sx, h - 0.9, sz, idx * 1.4, sc, true, true);
            });

            // 4. Crescent Cove Pier, Lantern, Campfire & Treasure aligned to _covePathA / _covePathB
            const bayDirAngle = COVE_BAY_ANGLE;
            const fwdX = Math.cos(bayDirAngle);
            const fwdZ = Math.sin(bayDirAngle);
            const sideX = -fwdZ;
            const sideZ = fwdX;
            const pierBaseX = this._covePathA.x;
            const pierBaseZ = this._covePathA.y;
            const pierYaw = Math.atan2(fwdX, fwdZ);
            const pierDeckY = 0.82; // plank surface sits at pier (-0.30) + 1.12m local height

            spawnProp(pierContainer, 'covePier_0', pierBaseX, -0.30, pierBaseZ, pierYaw, 1.0, true, true);
            const pierEndX = pierBaseX + fwdX * 2.98;
            const pierEndZ = pierBaseZ + fwdZ * 2.98;
            spawnProp(pierContainer, 'covePier_1', pierEndX, -0.30, pierEndZ, pierYaw, 1.0, true, true);

            // Warm Dock Lantern mounted on seaward corner of pier tip
            const lanternX = pierEndX + fwdX * 1.15 + sideX * 1.55;
            const lanternZ = pierEndZ + fwdZ * 1.15 + sideZ * 1.55;
            spawnProp(lanternContainer, 'coveLantern', lanternX, 0.85, lanternZ, pierYaw, 0.85, true, false);
            const dockLight = new BABYLON.PointLight('coveDockLight', new BABYLON.Vector3(lanternX, 2.95, lanternZ), this._scene);
            dockLight.diffuse = new BABYLON.Color3(1.0, 0.72, 0.30);
            dockLight.intensity = 14;
            dockLight.range = 24;

            // Beach Campfire & Treasure Chest slightly up on the dry sand cove
            const campX = this._covePathB.x;
            const campZ = this._covePathB.y;
            const campY = Math.max(1.0, this.getTerrainHeightAt(campX, campZ));
            spawnProp(campfireContainer, 'coveCampfire', campX, campY - 0.05, campZ, 0.4, 1.15, true, false);

            this._campfireLight = new BABYLON.PointLight('coveCampfireLight', new BABYLON.Vector3(campX, campY + 0.85, campZ), this._scene);
            this._campfireLight.diffuse = new BABYLON.Color3(1.0, 0.48, 0.14);
            this._campfireLight.intensity = 10;
            this._campfireLight.range = 16;

            // Fire embers particle burst on beach campfire
            const fireSys = new BABYLON.ParticleSystem('coveCampEmbers', 60, this._scene);
            fireSys.particleTexture = new BABYLON.Texture('textures/flare.png', this._scene);
            fireSys.emitter = new BABYLON.Vector3(campX, campY + 0.25, campZ);
            fireSys.minEmitBox = new BABYLON.Vector3(-0.18, 0, -0.18);
            fireSys.maxEmitBox = new BABYLON.Vector3(0.18, 0.12, 0.18);
            fireSys.color1 = new BABYLON.Color4(1.0, 0.55, 0.12, 0.95);
            fireSys.color2 = new BABYLON.Color4(1.0, 0.25, 0.05, 0.85);
            fireSys.colorDead = new BABYLON.Color4(0.25, 0.2, 0.2, 0.0);
            fireSys.minSize = 0.08;
            fireSys.maxSize = 0.24;
            fireSys.minLifeTime = 0.45;
            fireSys.maxLifeTime = 1.0;
            fireSys.emitRate = 28;
            fireSys.direction1 = new BABYLON.Vector3(-0.25, 1.4, -0.25);
            fireSys.direction2 = new BABYLON.Vector3(0.25, 2.4, 0.25);
            fireSys.start();

            // Chest & Barrels nestled on the cove beach near campfire
            const chestX = campX + 2.4;
            const chestZ = campZ + 1.6;
            const chestY = Math.max(1.2, this.getTerrainHeightAt(chestX, chestZ));
            spawnProp(chestContainer, 'beachTreasureChest', chestX, chestY - 0.04, chestZ, bayDirAngle + Math.PI * 0.5, 1.15, true, false);
            spawnProp(barrelContainer, 'beachBarrel_0', pierBaseX - 1.5, Math.max(0.8, this.getTerrainHeightAt(pierBaseX - 1.5, pierBaseZ + 0.6)) - 0.04, pierBaseZ + 0.6, 0.3, 1.0, true, false);
            spawnProp(barrelContainer, 'beachBarrel_1', pierBaseX - 2.2, Math.max(0.8, this.getTerrainHeightAt(pierBaseX - 2.2, pierBaseZ + 1.1)) - 0.04, pierBaseZ + 1.1, 1.4, 0.95, true, false);

            // ───────────────────────────────────────────────────────────────────────────
            // 5. DIVERSE REAL TREES & LUSH UNDERBRUSH (Oak, Maple, Pine, Olive, Saplings)
            // ───────────────────────────────────────────────────────────────────────────
            const getTerrainSlope = (wx: number, wz: number): number => {
                const hx = (this.getTerrainHeightAt(wx + 1.0, wz) - this.getTerrainHeightAt(wx - 1.0, wz)) * 0.5;
                const hz = (this.getTerrainHeightAt(wx, wz + 1.0) - this.getTerrainHeightAt(wx, wz - 1.0)) * 0.5;
                return Math.hypot(hx, hz);
            };

            interface TreeDistributionSpec {
                container: BABYLON.AssetContainer;
                prefix: string;
                spec: IslandSpec;
                count: number;
                minH: number;
                maxH: number;
                scaleMin: number;
                scaleMax: number;
                rMinFrac: number;
                rMaxFrac: number;
                sinkY: number;
                swayAmp: number;
                castShadow: boolean;
                maxSlope: number;
                leanAmp: number;
                multiVariant?: boolean;
            }

            const treeDistributions: TreeDistributionSpec[] = [
                // Main island photoreal Poly Haven PBR coastal canopy trees & tropical palms
                { container: phIslandTree1Container, prefix: 'phTree1', spec: MAIN_ISLAND, count: 16, minH: 2.2, maxH: 10.6, scaleMin: 1.35, scaleMax: 1.90, rMinFrac: 0.12, rMaxFrac: 0.72, sinkY: 0.35, swayAmp: 0.011, castShadow: true, maxSlope: 0.75, leanAmp: 0.05 },
                { container: phIslandTree2Container, prefix: 'phTree2', spec: MAIN_ISLAND, count: 14, minH: 2.0, maxH: 10.2, scaleMin: 1.45, scaleMax: 2.05, rMinFrac: 0.15, rMaxFrac: 0.74, sinkY: 0.35, swayAmp: 0.012, castShadow: true, maxSlope: 0.75, leanAmp: 0.06 },
                { container: phIslandTree3Container, prefix: 'phTree3', spec: MAIN_ISLAND, count: 14, minH: 2.4, maxH: 10.8, scaleMin: 1.55, scaleMax: 2.25, rMinFrac: 0.10, rMaxFrac: 0.68, sinkY: 0.30, swayAmp: 0.012, castShadow: true, maxSlope: 0.78, leanAmp: 0.05 },
                { container: phPachiraContainer, prefix: 'phPachira', spec: MAIN_ISLAND, count: 14, minH: 1.85, maxH: 8.8, scaleMin: 2.10, scaleMax: 2.95, rMinFrac: 0.20, rMaxFrac: 0.76, sinkY: 0.25, swayAmp: 0.016, castShadow: true, maxSlope: 0.74, leanAmp: 0.06 },
                { container: chileanPalmContainer, prefix: 'chileanPalm', spec: MAIN_ISLAND, count: 12, minH: 1.85, maxH: 7.8, scaleMin: 0.75, scaleMax: 1.04, rMinFrac: 0.24, rMaxFrac: 0.78, sinkY: 0.45, swayAmp: 0.018, castShadow: true, maxSlope: 0.70, leanAmp: 0.10 },
                { container: treeFernContainer, prefix: 'treeFern', spec: MAIN_ISLAND, count: 12, minH: 2.8, maxH: 10.2, scaleMin: 0.75, scaleMax: 1.05, rMinFrac: 0.14, rMaxFrac: 0.64, sinkY: 0.40, swayAmp: 0.022, castShadow: true, maxSlope: 0.76, leanAmp: 0.06 },
                { container: bananaContainer, prefix: 'banana', spec: MAIN_ISLAND, count: 16, minH: 2.1, maxH: 7.6, scaleMin: 0.88, scaleMax: 1.25, rMinFrac: 0.20, rMaxFrac: 0.72, sinkY: 0.30, swayAmp: 0.024, castShadow: true, maxSlope: 0.74, leanAmp: 0.05 },
                // Dry berm palms, agaves & tropical understory shrubs (strictly above wave wash zone!)
                { container: palmSaplingContainer, prefix: 'palmSapling', spec: MAIN_ISLAND, count: 16, minH: 1.50, maxH: 2.85, scaleMin: 0.95, scaleMax: 1.32, rMinFrac: 0.50, rMaxFrac: 0.86, sinkY: 0.22, swayAmp: 0.030, castShadow: true, maxSlope: 0.65, leanAmp: 0.14 },
                { container: agaveContainer, prefix: 'agave', spec: MAIN_ISLAND, count: 14, minH: 1.55, maxH: 5.2, scaleMin: 0.95, scaleMax: 1.38, rMinFrac: 0.40, rMaxFrac: 0.84, sinkY: 0.14, swayAmp: 0.018, castShadow: true, maxSlope: 0.75, leanAmp: 0.04 },
                { container: tiPlantContainer, prefix: 'tiPlant', spec: MAIN_ISLAND, count: 22, minH: 1.85, maxH: 8.2, scaleMin: 0.90, scaleMax: 1.28, rMinFrac: 0.16, rMaxFrac: 0.76, sinkY: 0.18, swayAmp: 0.030, castShadow: true, maxSlope: 0.80, leanAmp: 0.04 },
                { container: taroContainer, prefix: 'taro', spec: MAIN_ISLAND, count: 24, minH: 1.80, maxH: 7.5, scaleMin: 1.25, scaleMax: 1.75, rMinFrac: 0.18, rMaxFrac: 0.78, sinkY: 0.12, swayAmp: 0.032, castShadow: false, maxSlope: 0.80, leanAmp: 0.03 },
                { container: floweringShrubContainer, prefix: 'flowerShrub', spec: MAIN_ISLAND, count: 22, minH: 1.80, maxH: 8.4, scaleMin: 1.35, scaleMax: 1.90, rMinFrac: 0.15, rMaxFrac: 0.78, sinkY: 0.12, swayAmp: 0.030, castShadow: false, maxSlope: 0.82, leanAmp: 0.02 },
                { container: tropicalBushContainer, prefix: 'tropBush', spec: MAIN_ISLAND, count: 44, minH: 1.85, maxH: 8.6, scaleMin: 1.85, scaleMax: 2.70, rMinFrac: 0.12, rMaxFrac: 0.76, sinkY: 0.12, swayAmp: 0.032, castShadow: false, maxSlope: 0.85, leanAmp: 0.02 },
                // Photoreal CC0 Smuggler's Cove botanical layer (Poly Haven textured PBR cutouts)
                { container: phFernContainer, prefix: 'phFern', spec: MAIN_ISLAND, count: 36, minH: 1.80, maxH: 9.2, scaleMin: 2.30, scaleMax: 3.30, rMinFrac: 0.14, rMaxFrac: 0.76, sinkY: 0.08, swayAmp: 0.034, castShadow: false, maxSlope: 0.82, leanAmp: 0.02, multiVariant: true },
                { container: phCalatheaContainer, prefix: 'phCalathea', spec: MAIN_ISLAND, count: 30, minH: 1.75, maxH: 8.5, scaleMin: 2.40, scaleMax: 3.40, rMinFrac: 0.16, rMaxFrac: 0.78, sinkY: 0.08, swayAmp: 0.032, castShadow: false, maxSlope: 0.80, leanAmp: 0.02, multiVariant: true },
                { container: phAnthuriumContainer, prefix: 'phAnthurium', spec: MAIN_ISLAND, count: 26, minH: 1.75, maxH: 7.8, scaleMin: 2.10, scaleMax: 3.00, rMinFrac: 0.20, rMaxFrac: 0.78, sinkY: 0.08, swayAmp: 0.030, castShadow: false, maxSlope: 0.80, leanAmp: 0.02, multiVariant: true },
                { container: phShrubContainer, prefix: 'phShrub', spec: MAIN_ISLAND, count: 28, minH: 1.85, maxH: 8.8, scaleMin: 2.80, scaleMax: 3.90, rMinFrac: 0.15, rMaxFrac: 0.78, sinkY: 0.10, swayAmp: 0.032, castShadow: false, maxSlope: 0.82, leanAmp: 0.02, multiVariant: true },
                // Sea-Stack Atoll secondary island photoreal canopy & tropical foliage
                { container: phIslandTree1Container, prefix: 'atollPhTree1', spec: ATOLL_ISLAND, count: 4, minH: 2.0, maxH: 6.8, scaleMin: 1.25, scaleMax: 1.65, rMinFrac: 0.15, rMaxFrac: 0.65, sinkY: 0.30, swayAmp: 0.011, castShadow: true, maxSlope: 0.75, leanAmp: 0.05 },
                { container: phIslandTree2Container, prefix: 'atollPhTree2', spec: ATOLL_ISLAND, count: 4, minH: 1.9, maxH: 6.4, scaleMin: 1.35, scaleMax: 1.75, rMinFrac: 0.20, rMaxFrac: 0.68, sinkY: 0.30, swayAmp: 0.012, castShadow: true, maxSlope: 0.75, leanAmp: 0.06 },
                { container: phPachiraContainer, prefix: 'atollPachira', spec: ATOLL_ISLAND, count: 4, minH: 1.8, maxH: 5.8, scaleMin: 1.95, scaleMax: 2.60, rMinFrac: 0.22, rMaxFrac: 0.72, sinkY: 0.25, swayAmp: 0.016, castShadow: true, maxSlope: 0.75, leanAmp: 0.06 },
                { container: chileanPalmContainer, prefix: 'atollChileanPalm', spec: ATOLL_ISLAND, count: 4, minH: 1.8, maxH: 5.8, scaleMin: 0.68, scaleMax: 0.92, rMinFrac: 0.28, rMaxFrac: 0.76, sinkY: 0.40, swayAmp: 0.018, castShadow: true, maxSlope: 0.72, leanAmp: 0.09 },
                { container: bananaContainer, prefix: 'atollBanana', spec: ATOLL_ISLAND, count: 5, minH: 1.9, maxH: 5.6, scaleMin: 0.82, scaleMax: 1.15, rMinFrac: 0.20, rMaxFrac: 0.72, sinkY: 0.28, swayAmp: 0.024, castShadow: true, maxSlope: 0.76, leanAmp: 0.05 },
                { container: palmSaplingContainer, prefix: 'atollSapling', spec: ATOLL_ISLAND, count: 6, minH: 1.45, maxH: 2.4, scaleMin: 0.90, scaleMax: 1.20, rMinFrac: 0.50, rMaxFrac: 0.84, sinkY: 0.20, swayAmp: 0.032, castShadow: true, maxSlope: 0.65, leanAmp: 0.14 },
                { container: agaveContainer, prefix: 'atollAgave', spec: ATOLL_ISLAND, count: 5, minH: 1.45, maxH: 3.8, scaleMin: 0.90, scaleMax: 1.28, rMinFrac: 0.45, rMaxFrac: 0.84, sinkY: 0.14, swayAmp: 0.018, castShadow: true, maxSlope: 0.75, leanAmp: 0.04 },
                { container: phFernContainer, prefix: 'atollPhFern', spec: ATOLL_ISLAND, count: 10, minH: 1.7, maxH: 6.2, scaleMin: 2.10, scaleMax: 3.10, rMinFrac: 0.16, rMaxFrac: 0.74, sinkY: 0.08, swayAmp: 0.034, castShadow: false, maxSlope: 0.82, leanAmp: 0.02, multiVariant: true },
                { container: phCalatheaContainer, prefix: 'atollPhCalathea', spec: ATOLL_ISLAND, count: 8, minH: 1.7, maxH: 5.8, scaleMin: 2.20, scaleMax: 3.10, rMinFrac: 0.18, rMaxFrac: 0.76, sinkY: 0.08, swayAmp: 0.032, castShadow: false, maxSlope: 0.80, leanAmp: 0.02, multiVariant: true },
                { container: tropicalBushContainer, prefix: 'atollBush', spec: ATOLL_ISLAND, count: 14, minH: 1.75, maxH: 6.4, scaleMin: 1.65, scaleMax: 2.35, rMinFrac: 0.15, rMaxFrac: 0.74, sinkY: 0.12, swayAmp: 0.032, castShadow: false, maxSlope: 0.85, leanAmp: 0.02 },
            ];

            let treeIdx = 0;
            for (const cfg of treeDistributions) {
                let placed = 0;
                const seedOffset = cfg.prefix.split('').reduce((acc, ch) => acc + ch.charCodeAt(0) * 0.17, cfg.spec.seed);
                for (let step = 0; step < 260 && placed < cfg.count; step++) {
                    const ang = step * 2.3999632 + seedOffset;
                    const rFrac = cfg.rMinFrac + ((step * 23) % 21) * ((cfg.rMaxFrac - cfg.rMinFrac) / 20);
                    const r = cfg.spec.radius * rFrac;
                    const wx = cfg.spec.centerX + Math.cos(ang) * r;
                    const wz = cfg.spec.centerZ + Math.sin(ang) * r;
                    if (cfg.spec.hasCove && isNearCoveTrail(wx, wz)) continue;
                    const h = this.getTerrainHeightAt(wx, wz);
                    if (h < cfg.minH || h > cfg.maxH) continue;
                    if (getTerrainSlope(wx, wz) > cfg.maxSlope) continue;

                    const frac = ((placed * 37 + step) % 13) / 12;
                    const sc = cfg.scaleMin + frac * (cfg.scaleMax - cfg.scaleMin);
                    const leanX = Math.cos(ang) * cfg.leanAmp;
                    const leanZ = Math.sin(ang) * cfg.leanAmp;
                    spawnProp(
                        cfg.container,
                        `${cfg.prefix}_${treeIdx++}`,
                        wx,
                        h - cfg.sinkY,
                        wz,
                        ang + 0.9,
                        sc,
                        cfg.castShadow,
                        false,
                        cfg.swayAmp,
                        leanX,
                        leanZ,
                        false,
                        cfg.multiVariant ? placed : -1
                    );
                    placed++;
                }
            }

            // Lush framing grove & photoreal tropical flora around cove backdrop behind campfire
            const coveBackdropTrees: Array<[BABYLON.AssetContainer, string, number, number, number, boolean, number]> = [
                [phIslandTree1Container, 'coveBackdropTree1', campX - fwdX * 7.2 + sideX * 6.0, campZ - fwdZ * 7.2 + sideZ * 6.0, 1.55, true, -1],
                [phIslandTree2Container, 'coveBackdropTree2', campX - fwdX * 6.8 - sideX * 6.5, campZ - fwdZ * 6.8 - sideZ * 6.5, 1.65, true, -1],
                [phPachiraContainer, 'coveBackdropPachira', campX - fwdX * 4.5 + sideX * 7.8, campZ - fwdZ * 4.5 + sideZ * 7.8, 2.45, true, -1],
                [bananaContainer, 'coveBackdropBanana0', campX - fwdX * 5.0 - sideX * 4.2, campZ - fwdZ * 5.0 - sideZ * 4.2, 1.10, true, -1],
                [bananaContainer, 'coveBackdropBanana1', campX - fwdX * 3.8 + sideX * 4.8, campZ - fwdZ * 3.8 + sideZ * 4.8, 1.02, true, -1],
                [phAnthuriumContainer, 'coveAccentAnthurium0', campX + sideX * 3.4 - fwdX * 1.2, campZ + sideZ * 3.4 - fwdZ * 1.2, 2.55, false, 0],
                [phCalatheaContainer, 'coveAccentCalathea0', campX - sideX * 3.6 - fwdX * 1.8, campZ - sideZ * 3.6 - fwdZ * 1.8, 2.75, false, 1],
                [phFernContainer, 'coveAccentFern0', campX + sideX * 2.8 + fwdX * 2.4, campZ + sideZ * 2.8 + fwdZ * 2.4, 2.65, false, 0],
                [tiPlantContainer, 'coveAccentTi0', campX - sideX * 4.2 + fwdX * 2.1, campZ - sideZ * 4.2 + fwdZ * 2.1, 1.18, true, -1],
            ];
            for (const [cont, name, tx, tz, sc, castSh, vPick] of coveBackdropTrees) {
                const th = this.getTerrainHeightAt(tx, tz);
                if (th > 1.2) {
                    spawnProp(cont, name, tx, th - (vPick >= 0 ? 0.08 : 0.35), tz, bayDirAngle + tx * 0.2, sc, castSh, false, 0.022, 0, 0, false, vPick);
                }
            }

            // ───────────────────────────────────────────────────────────────────────────
            // 6. ANCHORED BOATS & SHIPS (Buoyancy wave-riding + pier skiff)
            // ───────────────────────────────────────────────────────────────────────────
            const findDeepWaterSpot = (ang: number, minDist: number, maxFloorH: number): [number, number] => {
                for (let rr = minDist; rr < 140; rr += 2.5) {
                    const wx = MAIN_ISLAND.centerX + Math.cos(ang) * rr;
                    const wz = MAIN_ISLAND.centerZ + Math.sin(ang) * rr;
                    if (this.getTerrainHeightAt(wx, wz) <= maxFloorH) {
                        return [wx, wz];
                    }
                }
                return [MAIN_ISLAND.centerX + Math.cos(ang) * minDist, MAIN_ISLAND.centerZ + Math.sin(ang) * minDist];
            };

            const spawnOpenWaterBoat = (
                container: BABYLON.AssetContainer,
                name: string,
                x: number,
                z: number,
                rotY: number,
                scale: number,
                yOffset: number,
                probeFwdZ: number,
                probeSideX: number
            ): void => {
                const node = spawnProp(container, name, x, yOffset, z, rotY, scale, true, true);
                node.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, rotY, 0);
                this._buoyancy.addMesh(
                    node,
                    {
                        v1: new BABYLON.Vector3(0, 0, 0),
                        v2: new BABYLON.Vector3(0, 0, probeFwdZ / scale),
                        v3: new BABYLON.Vector3(probeSideX / scale, 0, 0),
                    },
                    yOffset,
                    2
                );
            };

            // Rowboat — moored beside outer pier end (gentle harbor ripple so it stays clear of pilings)
            let rowDist = 0.8;
            let rowX = pierEndX + sideX * 2.8 + fwdX * rowDist;
            let rowZ = pierEndZ + sideZ * 2.8 + fwdZ * rowDist;
            while (this.getTerrainHeightAt(rowX, rowZ) > -0.34 && rowDist < 8) {
                rowDist += 0.8;
                rowX = pierEndX + sideX * 2.8 + fwdX * rowDist;
                rowZ = pierEndZ + sideZ * 2.8 + fwdZ * rowDist;
            }
            const rowRotY = pierYaw + 0.25;
            const rowNode = spawnProp(rowboatContainer, 'pierRowboat', rowX, -0.14, rowZ, rowRotY, 1.25, true, true);
            this._mooredBoats.push({
                node: rowNode,
                baseY: -0.14,
                phaseOffset: Math.abs(rowX * 0.31 + rowZ * 0.47),
                baseRotY: rowRotY,
            });

            // Ship's Longboat — anchored off port approach into Crescent Cove
            const [longX, longZ] = findDeepWaterSpot(COVE_BAY_ANGLE + 0.28, 56, -2.0);
            spawnOpenWaterBoat(longboatContainer, 'anchoredLongboat', longX, longZ, pierYaw - 0.55, 1.15, -0.22, 3.2, 1.5);

            // Fishing Boat — anchored off starboard lagoon channel
            const [fishBX, fishBZ] = findDeepWaterSpot(COVE_BAY_ANGLE - 0.34, 54, -2.0);
            spawnOpenWaterBoat(fishingBoatContainer, 'coveFishingBoat', fishBX, fishBZ, pierYaw + 1.15, 1.05, -0.32, 3.2, 1.4);

            // Companion Pirate Brigantine — anchored in deep outer channel off port flank
            const [brigX, brigZ] = findDeepWaterSpot(COVE_BAY_ANGLE + 0.52, 92, -5.0);
            spawnOpenWaterBoat(brigantineContainer, 'anchoredBrigantine', brigX, brigZ, pierYaw - 0.95, 1.45, -0.75, 4.5, 4.5);

            // ───────────────────────────────────────────────────────────────────────────
            // 7. ANIMATED NPC PEOPLE on Pier & Cove Beach (true ~1.7m–1.8m scale)
            // ───────────────────────────────────────────────────────────────────────────
            const spawnIslandNPC = (
                container: BABYLON.AssetContainer,
                name: string,
                x: number,
                y: number,
                z: number,
                rotY: number,
                scale: number,
                style: NPCPoseStyle,
                patrolStart?: BABYLON.Vector2,
                patrolEnd?: BABYLON.Vector2
            ): void => {
                const inst = container.instantiateModelsToScene(
                    (sourceName) => `${name}_${sourceName}`,
                    false,
                    { doNotInstantiate: true }
                );
                const node = new BABYLON.TransformNode(name, this._scene);
                node.parent = this._root;
                for (const rn of inst.rootNodes) {
                    rn.parent = node;
                }
                node.position.set(x, y, z);
                node.rotation.set(0, rotY, 0);
                node.scaling.setAll(scale);
                this._registerInstanceForScene(node, true, false);

                if (style === 'patrol') {
                    const walkGroup = inst.animationGroups.find((ag) => ag.name.toLowerCase().includes('walk')) ?? inst.animationGroups[0];
                    for (const ag of inst.animationGroups) {
                        if (ag !== walkGroup) ag.stop();
                    }
                    if (walkGroup) {
                        walkGroup.loopAnimation = true;
                        walkGroup.start(true, 0.78);
                    }
                    this._npcs.push({
                        node,
                        baseRotY: rotY,
                        baseY: y,
                        phase: 0,
                        style,
                        baseSpineX: 0,
                        baseHeadY: 0,
                        bones: {},
                        patrolStart,
                        patrolEnd,
                        patrolSpeed: 0.85,
                    });
                    return;
                }

                // Freeze baked animations (e.g. fisherman Walk) for stationary NPCs and pose bones out of T-pose
                for (const ag of inst.animationGroups) {
                    ag.stop();
                }

                const bySuffix = (suffix: string): BABYLON.TransformNode | undefined =>
                    this._scene.getTransformNodeByName(`${name}_${suffix}`) ?? undefined;

                const spine = bySuffix('Spine');
                const spine2 = bySuffix('Spine2');
                const head = bySuffix('Head');
                const leftShoulder = bySuffix('LeftShoulder');
                const rightShoulder = bySuffix('RightShoulder');
                const leftArm = bySuffix('LeftArm');
                const rightArm = bySuffix('RightArm');
                const leftForeArm = bySuffix('LeftForeArm');
                const rightForeArm = bySuffix('RightForeArm');
                const leftUpLeg = bySuffix('LeftUpLeg');
                const rightUpLeg = bySuffix('RightUpLeg');

                // Natural relaxed shoulder drop & arms lowered cleanly down out of horizontal T-pose
                this._setBoneEuler(leftShoulder, 0, 0, -0.08);
                this._setBoneEuler(rightShoulder, 0, 0, 0.08);

                let baseSpineX = 0.03;
                let baseHeadY = 0;
                if (style === 'lookout') {
                    // One hand resting relaxed, slightly staggered heroic lookout stance
                    this._setBoneEuler(leftArm, -0.10, 0.05, -1.28);
                    this._setBoneEuler(rightArm, -0.24, -0.10, 1.24);
                    this._setBoneEuler(leftForeArm, 0, -0.32, 0);
                    this._setBoneEuler(rightForeArm, 0, 0.55, 0);
                    this._setBoneEuler(leftUpLeg, -0.05, 0.06, 0.03);
                    this._setBoneEuler(rightUpLeg, 0.06, -0.05, -0.03);
                    baseSpineX = 0.04;
                } else if (style === 'officer') {
                    // Disciplined upright harbor sentinel with arms slightly behind flanks
                    this._setBoneEuler(leftArm, 0.08, -0.08, -1.34);
                    this._setBoneEuler(rightArm, 0.08, 0.08, 1.34);
                    this._setBoneEuler(leftForeArm, 0, -0.45, 0);
                    this._setBoneEuler(rightForeArm, 0, 0.45, 0);
                    this._setBoneEuler(leftUpLeg, 0, 0.04, 0.02);
                    this._setBoneEuler(rightUpLeg, 0, -0.04, -0.02);
                    baseSpineX = -0.02;
                } else if (style === 'trader') {
                    // Expressive merchant pose tilted slightly toward treasure & camp
                    this._setBoneEuler(leftArm, -0.28, 0.12, -1.22);
                    this._setBoneEuler(rightArm, -0.14, -0.06, 1.28);
                    this._setBoneEuler(leftForeArm, 0, -0.68, 0);
                    this._setBoneEuler(rightForeArm, 0, 0.38, 0);
                    this._setBoneEuler(leftUpLeg, -0.04, 0.08, 0.02);
                    this._setBoneEuler(rightUpLeg, 0.05, -0.06, -0.02);
                    baseSpineX = 0.05;
                    baseHeadY = 0.12;
                } else if (style === 'fisher') {
                    // Leaning comfortably over the pier end watching fish in the bay
                    this._setBoneEuler(leftArm, -0.26, 0.08, -1.24);
                    this._setBoneEuler(rightArm, -0.32, -0.10, 1.22);
                    this._setBoneEuler(leftForeArm, 0, -0.58, 0);
                    this._setBoneEuler(rightForeArm, 0, 0.62, 0);
                    this._setBoneEuler(leftUpLeg, -0.06, 0.04, 0.02);
                    this._setBoneEuler(rightUpLeg, 0.06, -0.04, -0.02);
                    baseSpineX = 0.10;
                } else {
                    // Casual dock/beach crewman
                    this._setBoneEuler(leftArm, -0.12, 0.04, -1.30);
                    this._setBoneEuler(rightArm, -0.16, -0.06, 1.28);
                    this._setBoneEuler(leftForeArm, 0, -0.30, 0);
                    this._setBoneEuler(rightForeArm, 0, 0.40, 0);
                    this._setBoneEuler(leftUpLeg, -0.04, 0.05, 0.02);
                    this._setBoneEuler(rightUpLeg, 0.04, -0.04, -0.02);
                }

                this._setBoneEuler(spine, baseSpineX, 0, 0);
                this._setBoneEuler(head, 0, baseHeadY, 0);

                this._npcs.push({
                    node,
                    baseRotY: rotY,
                    baseY: y,
                    phase: Math.abs(x * 0.53 + z * 0.37),
                    style,
                    baseSpineX,
                    baseHeadY,
                    bones: { spine, spine2, head, leftArm, rightArm, leftForeArm, rightForeArm },
                });
            };

            // 1. Pirate Deckhand — mid-pier lookout facing bay & flagship (standing cleanly ON 0.82m pier planks)
            const deck0X = pierBaseX + fwdX * 0.85 - sideX * 0.72;
            const deck0Z = pierBaseZ + fwdZ * 0.85 - sideZ * 0.72;
            spawnIslandNPC(deckhHandContainer, 'deckhand_0', deck0X, pierDeckY, deck0Z, pierYaw - 0.25, 1.0, 'lookout');

            // 2. Fisherman — outer pier end looking over crystal cove waters
            const fishX = pierEndX + fwdX * 0.92 + sideX * 0.52;
            const fishZ = pierEndZ + fwdZ * 0.92 + sideZ * 0.52;
            spawnIslandNPC(fisherContainer, 'pierFisherman', fishX, pierDeckY, fishZ, pierYaw + 0.18, 1.0, 'fisher');

            // 3. Naval Harbor Officer — sentinel beside pier shore landing
            const navyX = pierBaseX - fwdX * 1.15 + sideX * 1.85;
            const navyZ = pierBaseZ - fwdZ * 1.15 + sideZ * 1.85;
            const navyY = Math.max(0.25, this.getTerrainHeightAt(navyX, navyZ)) - 0.03;
            spawnIslandNPC(navyContainer, 'navalOfficer', navyX, navyY, navyZ, pierYaw + 0.28, 1.02, 'officer');

            // 4. Cove Trader — beside campfire & treasure chest
            const traderX = campX - sideX * 2.1 - fwdX * 0.4;
            const traderZ = campZ - sideZ * 2.1 - fwdZ * 0.4;
            const traderY = Math.max(0.25, this.getTerrainHeightAt(traderX, traderZ)) - 0.03;
            const traderYaw = Math.atan2(chestX - traderX, chestZ - traderZ);
            spawnIslandNPC(traderContainer, 'coveTrader', traderX, traderY, traderZ, traderYaw, 1.0, 'trader');

            // 5. Beach Deckhand — tending barrels beside pier entrance
            const deck1X = pierBaseX - fwdX * 1.6 + sideX * 0.2;
            const deck1Z = pierBaseZ - fwdZ * 1.6 + sideZ * 0.2;
            const deck1Y = Math.max(0.25, this.getTerrainHeightAt(deck1X, deck1Z)) - 0.03;
            const deck1Yaw = Math.atan2(pierBaseX - deck1X, pierBaseZ - deck1Z);
            spawnIslandNPC(deckhHandContainer, 'deckhand_1', deck1X, deck1Y, deck1Z, deck1Yaw, 0.98, 'relaxed');

            // 6. Walking Coastal Fisherman — strolling smoothly along the flat sandy cove beach arc
            const patrolA = new BABYLON.Vector2(pierBaseX - fwdX * 1.6 + sideX * 1.6, pierBaseZ - fwdZ * 1.6 + sideZ * 1.6);
            const patrolB = new BABYLON.Vector2(pierBaseX - fwdX * 1.6 + sideX * 7.5, pierBaseZ - fwdZ * 1.6 + sideZ * 7.5);
            const patrolStartY = Math.max(0.25, this.getTerrainHeightAt(patrolA.x, patrolA.y)) - 0.03;
            const patrolYaw = Math.atan2(patrolB.x - patrolA.x, patrolB.y - patrolA.y);
            spawnIslandNPC(fisherContainer, 'beachPatrol', patrolA.x, patrolStartY, patrolA.y, patrolYaw, 1.0, 'patrol', patrolA, patrolB);
        } catch (err) {
            console.warn('Failed loading some island world props:', err);
        }
    }

    private _setBoneEuler(bone: BABYLON.TransformNode | undefined, rx: number, ry: number, rz: number): void {
        if (!bone) return;
        if (!bone.rotationQuaternion) {
            bone.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
        } else {
            BABYLON.Quaternion.FromEulerAnglesToRef(rx, ry, rz, bone.rotationQuaternion);
        }
    }

    public update(dt: number): void {
        this._time += dt;

        // Gentle breeze swaying palms, jungle trees & coastal ferns
        for (let i = 0; i < this._swayItems.length; i++) {
            const item = this._swayItems[i];
            const gust = Math.sin(this._time * item.speed + item.phase);
            const cross = Math.cos(this._time * (item.speed * 0.7) + item.phase * 1.3);
            item.node.rotation.x = item.baseRotX + gust * item.amp;
            item.node.rotation.z = item.baseRotZ + cross * (item.amp * 0.75);
        }

        if (this._campfireLight) {
            this._campfireLight.intensity = 9.0 + Math.sin(this._time * 13.0) * 1.8 + Math.cos(this._time * 23.0) * 1.1;
        }

        // Update animated islanders (idle breathing, head scans & sandy cove patrol)
        for (let i = 0; i < this._npcs.length; i++) {
            const npc = this._npcs[i];
            if (npc.style === 'patrol' && npc.patrolStart && npc.patrolEnd) {
                const dx = npc.patrolEnd.x - npc.patrolStart.x;
                const dz = npc.patrolEnd.y - npc.patrolStart.y;
                const segLen = Math.max(0.5, Math.hypot(dx, dz));
                const speed = npc.patrolSpeed ?? 0.85;
                const travelTime = segLen / speed;
                const cycle = (this._time % (travelTime * 2)) / travelTime;
                const forward = cycle <= 1.0;
                const rawT = forward ? cycle : 2.0 - cycle;
                // Smooth ease near endpoints while keeping constant middle gait
                const t = rawT * rawT * (3.0 - 2.0 * rawT);
                const px = npc.patrolStart.x + dx * t;
                const pz = npc.patrolStart.y + dz * t;
                const py = Math.max(0.25, this.getTerrainHeightAt(px, pz)) - 0.03;
                npc.node.position.set(px, py, pz);
                const dirSign = forward ? 1 : -1;
                npc.node.rotation.y = Math.atan2(dx * dirSign, dz * dirSign);
                continue;
            }

            const breath = Math.sin(this._time * 1.6 + npc.phase);
            const scan = Math.sin(this._time * 0.52 + npc.phase * 1.7);
            const sway = Math.cos(this._time * 0.72 + npc.phase);
            npc.node.rotation.y = npc.baseRotY + sway * 0.04;
            npc.node.position.y = npc.baseY + breath * 0.008;

            this._setBoneEuler(npc.bones.spine, npc.baseSpineX + breath * 0.018, sway * 0.02, 0);
            this._setBoneEuler(npc.bones.head, breath * 0.025, npc.baseHeadY + scan * 0.24, 0);
        }

        // Gentle sheltered-water motion for pier-tied rowboat
        for (let i = 0; i < this._mooredBoats.length; i++) {
            const b = this._mooredBoats[i];
            const waveY = this._buoyancy.enabled
                ? BABYLON.Scalar.Clamp(this._buoyancy.getWaterHeight(b.node.position) * 0.30, -0.10, 0.22)
                : 0;
            const lap = Math.sin(this._time * 1.25 + b.phaseOffset) * 0.04;
            b.node.position.y = b.baseY + waveY + lap;
            b.node.rotation.z = Math.sin(this._time * 1.05 + b.phaseOffset * 1.2) * 0.035;
            b.node.rotation.x = Math.cos(this._time * 0.85 + b.phaseOffset * 0.8) * 0.025;
            b.node.rotation.y = b.baseRotY + Math.sin(this._time * 0.42 + b.phaseOffset) * 0.04;
        }

        // Sync Buoyancy wave offset lightly if needed for shoreline awareness (referenced cleanly)
        if (this._buoyancy.enabled && this._islands.length > 0 && this._terrainMat) {
            this._terrainMat.alpha = 1.0;
        }
    }
}
