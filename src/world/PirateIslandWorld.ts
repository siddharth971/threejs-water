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
    private _npcs: Array<{ node: BABYLON.TransformNode; baseRotY: number; baseY: number; phase: number }> = [];
    private _boatBuoyNodes: Array<{ node: BABYLON.TransformNode; phaseOffset: number; baseY: number }>= [];

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
                oakContainer,
                mapleContainer,
                pineContainer,
                palmSaplingContainer,
                tropicalBushContainer,
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
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'oak_tree.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'maple_tree.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'pine_tree.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'palm_sapling.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'tropical_bush.glb', this._scene),
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
            // New assets
            this._tuneContainerMaterials(oakContainer);
            this._tuneContainerMaterials(mapleContainer);
            this._tuneContainerMaterials(pineContainer);
            this._tuneContainerMaterials(palmSaplingContainer);
            this._tuneContainerMaterials(tropicalBushContainer);
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
                tiltZ = 0
            ): BABYLON.TransformNode => {
                const inst = container.instantiateModelsToScene(() => name, false);
                const node = new BABYLON.TransformNode(name, this._scene);
                node.parent = this._root;
                for (const rn of inst.rootNodes) {
                    rn.parent = node;
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
                return distSeg < 2.6 || distCamp < 3.6;
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
            placePalmsRing(MAIN_ISLAND, 24, 1.35, 9.6, 1.08, 1.62);
            placePalmsRing(ATOLL_ISLAND, 7, 1.25, 6.2, 0.95, 1.38);

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
                } else if (h > 0.90 && h <= 2.25) {
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
                } else if (h > 0.8 && h <= 1.7) {
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
            const pierBaseX = this._covePathA.x;
            const pierBaseZ = this._covePathA.y;
            const pierYaw = Math.atan2(Math.cos(bayDirAngle), Math.sin(bayDirAngle));

            spawnProp(pierContainer, 'covePier_0', pierBaseX, -0.30, pierBaseZ, pierYaw, 1.0, true, true);
            const pierEndX = pierBaseX + Math.cos(bayDirAngle) * 3.8;
            const pierEndZ = pierBaseZ + Math.sin(bayDirAngle) * 3.8;
            spawnProp(pierContainer, 'covePier_1', pierEndX, -0.30, pierEndZ, pierYaw, 1.0, true, true);

            // Warm Dock Lantern on pier tip
            spawnProp(lanternContainer, 'coveLantern', pierEndX + 1.1, 0.25, pierEndZ - 0.8, pierYaw, 0.85, true, false);
            const dockLight = new BABYLON.PointLight('coveDockLight', new BABYLON.Vector3(pierEndX + 1.1, 2.5, pierEndZ - 0.8), this._scene);
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
            // 5. DIVERSE JUNGLE TREES  (oak, maple, pine on hillsides; palm saplings on berm)
            // ───────────────────────────────────────────────────────────────────────────
            const jungledTreeContainers: Array<[BABYLON.AssetContainer, string, number, number, number, number]> = [
                // [container, namePrefix, minH, maxH, scaleMin, scaleMax]
                [oakContainer,   'oak',   3.0, 10.0, 1.3, 1.9],
                [mapleContainer, 'maple', 3.5, 10.5, 1.2, 1.8],
                [pineContainer,  'pine',  4.0, 11.0, 1.1, 1.6],
            ];

            let treeIdx = 0;
            for (const [tCont, tName, minH, maxH, sMin, sMax] of jungledTreeContainers) {
                let placed = 0;
                for (let step = 0; step < 220 && placed < 14; step++) {
                    const ang = step * 2.3999632 + tName.charCodeAt(0) * 0.3;
                    const rFrac = 0.12 + ((step * 23) % 21) * (0.60 / 20);
                    const r = MAIN_ISLAND.radius * rFrac;
                    const wx = MAIN_ISLAND.centerX + Math.cos(ang) * r;
                    const wz = MAIN_ISLAND.centerZ + Math.sin(ang) * r;
                    if (isNearCoveTrail(wx, wz)) continue;
                    const h = this.getTerrainHeightAt(wx, wz);
                    if (h >= minH && h <= maxH) {
                        const s = sMin + ((placed * 37) % 11) * 0.08 * (sMax - sMin);
                        const leanX = Math.cos(ang) * 0.06;
                        const leanZ = Math.sin(ang) * 0.06;
                        spawnProp(tCont, `${tName}_${treeIdx++}`, wx, h - 0.7, wz, ang + 0.9, s, true, false, 0.012, leanX, leanZ);
                        placed++;
                    }
                }
            }

            // Palm saplings along beach berm edge
            let saplingIdx = 0;
            for (let i = 0; i < 100 && saplingIdx < 18; i++) {
                const ang = i * 2.3999632 + 2.1;
                const r = MAIN_ISLAND.radius * (0.55 + ((i * 11) % 15) * 0.028);
                const wx = MAIN_ISLAND.centerX + Math.cos(ang) * r;
                const wz = MAIN_ISLAND.centerZ + Math.sin(ang) * r;
                if (isNearCoveTrail(wx, wz)) continue;
                const h = this.getTerrainHeightAt(wx, wz);
                if (h >= 0.9 && h <= 2.4) {
                    const leanX = Math.cos(ang) * 0.18;
                    const leanZ = Math.sin(ang) * 0.18;
                    spawnProp(palmSaplingContainer, `palmSapling_${saplingIdx++}`, wx, h - 0.3, wz, ang + 1.8, 0.9 + (i % 4) * 0.12, true, false, 0.028, leanX, leanZ);
                }
            }

            // Dense tropical bushes mixed across mid-hillsides
            let bushIdx = 0;
            for (let i = 0; i < 240 && bushIdx < 55; i++) {
                const ang = i * 2.3999632 + 0.6;
                const r = 5.0 + ((i * 17) % 24) * 1.62;
                const wx = MAIN_ISLAND.centerX + Math.cos(ang) * r;
                const wz = MAIN_ISLAND.centerZ + Math.sin(ang) * r;
                if (isNearCoveTrail(wx, wz)) continue;
                const h = this.getTerrainHeightAt(wx, wz);
                if (h >= 1.5 && h <= 8.5) {
                    spawnProp(tropicalBushContainer, `tropBush_${bushIdx++}`, wx, h - 0.15, wz, ang, 2.2 + (i % 5) * 0.35, false, false, 0.038);
                }
            }

            // ───────────────────────────────────────────────────────────────────────────
            // 6. ANCHORED BOATS & SHIPS
            // ───────────────────────────────────────────────────────────────────────────

            // Helper: spawn a floating vessel and register simple buoyancy bob
            const spawnBoat = (
                container: BABYLON.AssetContainer,
                name: string,
                x: number,
                z: number,
                rotY: number,
                scale: number,
                draftY: number          // resting Y (at waterline)
            ): BABYLON.TransformNode => {
                const node = spawnProp(container, name, x, draftY, z, rotY, scale, true, true);
                this._boatBuoyNodes.push({ node, phaseOffset: Math.abs(x * 0.31 + z * 0.47), baseY: draftY });
                return node;
            };

            // Rowboat — tied to the pier end
            const rowX = pierEndX + Math.cos(bayDirAngle + Math.PI * 0.5) * 2.4;
            const rowZ = pierEndZ + Math.sin(bayDirAngle + Math.PI * 0.5) * 2.4;
            spawnBoat(rowboatContainer, 'pierRowboat', rowX, rowZ, bayDirAngle + 0.3, 1.1, -0.22);

            // Longboat — anchored ~22m off the cove mouth toward open sea
            const longX = MAIN_ISLAND.centerX + Math.cos(COVE_BAY_ANGLE) * 62;
            const longZ = MAIN_ISLAND.centerZ + Math.sin(COVE_BAY_ANGLE) * 62;
            spawnBoat(longboatContainer, 'anchoredLongboat', longX, longZ, COVE_BAY_ANGLE + 0.6, 1.0, -0.6);

            // Small fishing boat — bobbing ~18m off cove, perpendicular to channel
            const fishBX = MAIN_ISLAND.centerX + Math.cos(COVE_BAY_ANGLE + 0.85) * 55;
            const fishBZ = MAIN_ISLAND.centerZ + Math.sin(COVE_BAY_ANGLE + 0.85) * 55;
            spawnBoat(fishingBoatContainer, 'coveFishingBoat', fishBX, fishBZ, COVE_BAY_ANGLE + 2.1, 1.0, -0.8);

            // Brigantine — large ship anchored far out, atmospheric
            const brigX = MAIN_ISLAND.centerX + Math.cos(COVE_BAY_ANGLE - 0.4) * 110;
            const brigZ = MAIN_ISLAND.centerZ + Math.sin(COVE_BAY_ANGLE - 0.4) * 110;
            spawnBoat(brigantineContainer, 'anchoredBrigantine', brigX, brigZ, COVE_BAY_ANGLE + Math.PI * 0.5, 1.0, -1.4);

            // ───────────────────────────────────────────────────────────────────────────
            // 7. NPC PEOPLE on beach & pier
            // ───────────────────────────────────────────────────────────────────────────

            const spawnNPC = (
                container: BABYLON.AssetContainer,
                name: string,
                x: number,
                y: number,
                z: number,
                rotY: number,
                scale: number
            ): void => {
                const node = spawnProp(container, name, x, y, z, rotY, scale, true, false);
                this._npcs.push({
                    node,
                    baseRotY: rotY,
                    baseY: y,
                    phase: Math.abs(x * 0.53 + z * 0.37),
                });
            };

            // Pirate deckhands on pier (scale 1.0 — they're correct size ~1.7m)
            const deckX0 = pierBaseX + Math.cos(bayDirAngle) * 1.5;
            const deckZ0 = pierBaseZ + Math.sin(bayDirAngle) * 1.5;
            spawnNPC(deckhHandContainer, 'deckhand_0', deckX0, 0.52, deckZ0, bayDirAngle + Math.PI, 1.0);

            const deckX1 = pierEndX - Math.cos(bayDirAngle) * 0.8;
            const deckZ1 = pierEndZ - Math.sin(bayDirAngle) * 0.8;
            spawnNPC(deckhHandContainer, 'deckhand_1', deckX1, 0.52, deckZ1, bayDirAngle + 0.5, 1.0);

            // Cove Trader near campfire (scale 4.5 — model is in dm scale ~0.3m)
            const traderH = Math.max(1.0, this.getTerrainHeightAt(campX - 2.5, campZ + 1.0));
            spawnNPC(traderContainer, 'coveTrader', campX - 2.5, traderH - 0.08, campZ + 1.0, bayDirAngle + 2.4, 4.5);

            // Naval Officer at pier entrance sentinel (scale 4.0)
            const navyH = Math.max(1.0, this.getTerrainHeightAt(pierBaseX + 2.0, pierBaseZ - 1.5));
            spawnNPC(navyContainer, 'navalOfficer', pierBaseX + 2.0, navyH - 0.06, pierBaseZ - 1.5, bayDirAngle - 0.6, 4.0);

            // Fisherman at pier end, facing ocean (scale 4.0, has Walk anim — play idle pose)
            const fishNH = 0.46;  // slightly below pier deck to look seated-ish
            const fishNX = pierEndX + Math.cos(bayDirAngle) * 1.2;
            const fishNZ = pierEndZ + Math.sin(bayDirAngle) * 1.2;
            spawnNPC(fisherContainer, 'pierFisherman', fishNX, fishNH, fishNZ, bayDirAngle + Math.PI * 0.9, 4.0);
        } catch (err) {
            console.warn('Failed loading some island world props:', err);
        }
    }

    public update(dt: number): void {
        this._time += dt;

        // Gentle breeze swaying palms & coastal ferns
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

        // NPC idle sway — gentle breathing/shifting weight
        for (const npc of this._npcs) {
            npc.node.rotation.y = npc.baseRotY + Math.sin(this._time * 0.75 + npc.phase) * 0.045;
            npc.node.position.y = npc.baseY   + Math.sin(this._time * 1.05 + npc.phase * 1.3) * 0.012;
        }

        // Boat gentle bobbing on waves (simple sin approximation)
        for (const b of this._boatBuoyNodes) {
            const baseY = b.node.position.y;
            const phase = b.phaseOffset;
            b.node.position.y = baseY + Math.sin(this._time * 0.62 + phase) * 0.14;
            b.node.rotation.z = Math.sin(this._time * 0.48 + phase * 1.2) * 0.025;
            b.node.rotation.x = Math.cos(this._time * 0.37 + phase * 0.8) * 0.018;
        }

        // Sync Buoyancy wave offset lightly if needed for shoreline awareness (referenced cleanly)
        if (this._buoyancy.enabled && this._islands.length > 0 && this._terrainMat) {
            this._terrainMat.alpha = 1.0;
        }
    }
}
