import { Buoyancy } from '../ocean/Buoyancy';
import { ShipProps } from '../player/ShipProps';
import { PirateIslandWorld } from './PirateIslandWorld';

interface MarineSwimmer {
    kind: 'shark' | 'dolphin' | 'turtle' | 'manta' | 'fish';
    node: BABYLON.TransformNode;
    orbitCenterX: number;
    orbitCenterZ: number;
    radiusX: number;
    radiusZ: number;
    angle: number;
    angularSpeed: number;
    baseDepth: number; // relative to wave surface (negative = underwater)
    verticalBobPhase: number;
    verticalBobAmp: number;
    jumpPhase: number;
    jumpCooldown: number;
    isAirborne: boolean;
    prevX: number;
    prevY: number;
    prevZ: number;
}

interface FlyingSeagull {
    node: BABYLON.TransformNode;
    anim: BABYLON.AnimationGroup | null;
    isGliding: boolean;
    centerX: number;
    centerZ: number;
    radiusX: number;
    radiusZ: number;
    angle: number;
    angularSpeed: number;
    baseHeight: number;
    bobPhase: number;
    prevX: number;
    prevY: number;
    prevZ: number;
}

/**
 * Spawns and animates realistic marine wildlife (reef sharks, leaping dolphins,
 * sea turtles, manta rays, tropical fish schools, and soaring seagulls) integrated
 * with ocean wave heights, island terrain avoidance, and water surface splashes.
 */
export class OceanCreatures {
    private _scene: BABYLON.Scene;
    private _buoyancy: Buoyancy;
    private _islands: PirateIslandWorld;
    private _shadowGenerator: BABYLON.ShadowGenerator;
    private _shipProps: ShipProps | null = null;

    private _root: BABYLON.TransformNode;
    private _swimmers: MarineSwimmer[] = [];
    private _gulls: FlyingSeagull[] = [];
    private _time = 0;

    constructor(
        scene: BABYLON.Scene,
        buoyancy: Buoyancy,
        islands: PirateIslandWorld,
        shadowGenerator: BABYLON.ShadowGenerator,
        shipProps?: ShipProps | null
    ) {
        this._scene = scene;
        this._buoyancy = buoyancy;
        this._islands = islands;
        this._shadowGenerator = shadowGenerator;
        if (shipProps) this._shipProps = shipProps;

        this._root = new BABYLON.TransformNode('oceanCreaturesRoot', scene);
        void this._spawnAllAsync();
    }

    public setShipProps(props: ShipProps): void {
        this._shipProps = props;
    }

    private _prepContainerMaterials(container: BABYLON.AssetContainer, envIntensity = 0.95): void {
        for (const mat of container.materials) {
            const pbr = mat as BABYLON.PBRMaterial;
            if (pbr) {
                pbr.backFaceCulling = false;
                if ('twoSidedLighting' in pbr) pbr.twoSidedLighting = true;
                if ('environmentIntensity' in pbr) pbr.environmentIntensity = envIntensity;
            }
        }
    }

    private _instantiateRigged(
        container: BABYLON.AssetContainer,
        name: string,
        scale: number,
        preferredAnimKeywords: string[],
        animSpeedRatio: number,
        castShadow: boolean
    ): { node: BABYLON.TransformNode; anim: BABYLON.AnimationGroup | null } {
        // Preserve source bone/animation names with a unique instance prefix so 'Fly'/'Swim' matches reliably
        const inst = container.instantiateModelsToScene(
            (sourceName) => `${name}_${sourceName}`,
            false,
            { doNotInstantiate: true }
        );
        const wrapper = new BABYLON.TransformNode(name, this._scene);
        wrapper.parent = this._root;
        wrapper.scaling.setAll(scale);

        for (const rn of inst.rootNodes) {
            rn.parent = wrapper;
        }
        for (const mesh of wrapper.getChildMeshes(false)) {
            mesh.isPickable = false;
            mesh.receiveShadows = true;
            if (castShadow && mesh.getTotalVertices() > 0) {
                this._shadowGenerator.addShadowCaster(mesh);
            }
        }

        // Play matching skeletal swim/fly animation cleanly
        let chosen: BABYLON.AnimationGroup | null = null;
        for (const ag of inst.animationGroups) {
            ag.stop();
            const lname = ag.name.toLowerCase();
            if (preferredAnimKeywords.some((k) => lname.includes(k)) && !chosen) {
                chosen = ag;
            }
        }
        if (!chosen && inst.animationGroups.length > 0) {
            chosen = inst.animationGroups[0];
        }
        if (chosen) {
            chosen.loopAnimation = true;
            chosen.start(true, animSpeedRatio);
            const len = chosen.to - chosen.from;
            if (len > 0) {
                chosen.goToFrame(chosen.from + Math.random() * len);
            }
        }

        return { node: wrapper, anim: chosen };
    }

    private async _spawnAllAsync(): Promise<void> {
        try {
            const [
                sharkContainer,
                dolphinContainer,
                turtleContainer,
                mantaContainer,
                fish1Container,
                fish2Container,
                gullContainer,
            ] = await Promise.all([
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'reef_shark.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'poly_dolphin.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'sea_turtle.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'manta_ray.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'fish1.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'fish2.glb', this._scene),
                BABYLON.SceneLoader.LoadAssetContainerAsync('models/world/', 'seagull.glb', this._scene),
            ]);

            this._prepContainerMaterials(sharkContainer);
            this._prepContainerMaterials(dolphinContainer);
            this._prepContainerMaterials(turtleContainer);
            this._prepContainerMaterials(mantaContainer);
            this._prepContainerMaterials(fish1Container);
            this._prepContainerMaterials(fish2Container);
            this._prepContainerMaterials(gullContainer, 1.35);

            // 1. 4 Circling Reef Sharks (dorsal fins periodically cutting wave surface)
            const sharkOrbits: Array<[number, number, number, number, number, number]> = [
                [-14, -26, 18, 15, 0.0, 0.25],
                [14, -22, 22, 18, 2.2, -0.21],
                [-20, -40, 14, 12, 4.1, 0.22],
                [24, -34, 18, 20, 1.3, -0.23],
            ];
            sharkOrbits.forEach(([cx, cz, rx, rz, a, spd], i) => {
                const { node } = this._instantiateRigged(sharkContainer, `reefShark_${i}`, 2.05, ['swim'], 1.15, true);
                const x = cx + Math.cos(a) * rx;
                const z = cz + Math.sin(a) * rz;
                node.position.set(x, -0.35, z);
                this._swimmers.push({
                    kind: 'shark',
                    node,
                    orbitCenterX: cx,
                    orbitCenterZ: cz,
                    radiusX: rx,
                    radiusZ: rz,
                    angle: a,
                    angularSpeed: spd,
                    baseDepth: -0.34 - (i % 2) * 0.22,
                    verticalBobPhase: i * 1.4,
                    verticalBobAmp: 0.24,
                    jumpPhase: 0,
                    jumpCooldown: 999,
                    isAirborne: false,
                    prevX: x,
                    prevY: -0.35,
                    prevZ: z,
                });
            });

            // 2. 4 Playful Leaping Dolphins in deep water pods along ship-to-cove route
            const dolphinOrbits: Array<[number, number, number, number, number, number]> = [
                [-20, -38, 24, 18, 0.6, 0.29],
                [-20, -38, 22, 16, 0.85, 0.29],
                [16, -26, 20, 22, 3.3, -0.27],
                [16, -26, 22, 24, 3.55, -0.27],
            ];
            dolphinOrbits.forEach(([cx, cz, rx, rz, a, spd], i) => {
                const { node } = this._instantiateRigged(dolphinContainer, `dolphin_${i}`, 1.15, ['swim'], 1.25, true);
                const x = cx + Math.cos(a) * rx;
                const z = cz + Math.sin(a) * rz;
                node.position.set(x, -0.75, z);
                this._swimmers.push({
                    kind: 'dolphin',
                    node,
                    orbitCenterX: cx,
                    orbitCenterZ: cz,
                    radiusX: rx,
                    radiusZ: rz,
                    angle: a,
                    angularSpeed: spd,
                    baseDepth: -0.70,
                    verticalBobPhase: i * 0.9,
                    verticalBobAmp: 0.35,
                    jumpPhase: 0,
                    jumpCooldown: 1.5 + i * 1.4,
                    isAirborne: false,
                    prevX: x,
                    prevY: -0.75,
                    prevZ: z,
                });
            });

            // 3. 3 Sea Turtles swimming smoothly along Pirate Cove shallows
            const turtleSpots: Array<[number, number, number, number, number, number]> = [
                [-34, -40, 10, 8, 0.3, 0.16],
                [-28, -50, 9, 8, 2.5, -0.15],
                [34, -42, 10, 8, 1.1, 0.17],
            ];
            turtleSpots.forEach(([cx, cz, rx, rz, a, spd], i) => {
                const { node } = this._instantiateRigged(turtleContainer, `seaTurtle_${i}`, 0.85, ['swim'], 0.95, false);
                const x = cx + Math.cos(a) * rx;
                const z = cz + Math.sin(a) * rz;
                node.position.set(x, -1.4, z);
                this._swimmers.push({
                    kind: 'turtle',
                    node,
                    orbitCenterX: cx,
                    orbitCenterZ: cz,
                    radiusX: rx,
                    radiusZ: rz,
                    angle: a,
                    angularSpeed: spd,
                    baseDepth: -1.35 - i * 0.3,
                    verticalBobPhase: i * 1.9,
                    verticalBobAmp: 0.25,
                    jumpPhase: 0,
                    jumpCooldown: 999,
                    isAirborne: false,
                    prevX: x,
                    prevY: -1.4,
                    prevZ: z,
                });
            });

            // 4. 2 Graceful Manta Rays gliding below swells
            const mantaSpots: Array<[number, number, number, number, number, number]> = [
                [-12, -30, 18, 16, 1.8, 0.15],
                [-36, -62, 16, 18, 4.7, -0.14],
            ];
            mantaSpots.forEach(([cx, cz, rx, rz, a, spd], i) => {
                const { node } = this._instantiateRigged(mantaContainer, `mantaRay_${i}`, 0.24, ['swim'], 0.85, false);
                const x = cx + Math.cos(a) * rx;
                const z = cz + Math.sin(a) * rz;
                node.position.set(x, -2.6, z);
                this._swimmers.push({
                    kind: 'manta',
                    node,
                    orbitCenterX: cx,
                    orbitCenterZ: cz,
                    radiusX: rx,
                    radiusZ: rz,
                    angle: a,
                    angularSpeed: spd,
                    baseDepth: -2.6,
                    verticalBobPhase: i * 2.4,
                    verticalBobAmp: 0.35,
                    jumpPhase: 0,
                    jumpCooldown: 999,
                    isAirborne: false,
                    prevX: x,
                    prevY: -2.6,
                    prevZ: z,
                });
            });

            // 5. 14 Tropical Reef Fish in 2 underwater schools (visible near ship & beach cove!)
            for (let i = 0; i < 14; i++) {
                const isCoveSchool = i >= 7;
                const container = i % 2 === 0 ? fish1Container : fish2Container;
                const cx = isCoveSchool ? -34 : 0;
                const cz = isCoveSchool ? -46 : -14;
                const rx = 5.5 + (i % 4) * 1.4;
                const rz = 4.5 + ((i + 1) % 3) * 1.6;
                const a = (i / 7) * Math.PI * 2;
                const spd = (isCoveSchool ? 0.55 : -0.62) + ((i % 3) - 1) * 0.08;

                const { node } = this._instantiateRigged(container, `reefFish_${i}`, 0.055 + (i % 3) * 0.012, ['swim'], 1.1 + (i % 4) * 0.15, false);
                const x = cx + Math.cos(a) * rx;
                const z = cz + Math.sin(a) * rz;
                const d = -1.2 - (i % 4) * 0.45;
                node.position.set(x, d, z);

                this._swimmers.push({
                    kind: 'fish',
                    node,
                    orbitCenterX: cx,
                    orbitCenterZ: cz,
                    radiusX: rx,
                    radiusZ: rz,
                    angle: a,
                    angularSpeed: spd,
                    baseDepth: d,
                    verticalBobPhase: i * 0.7,
                    verticalBobAmp: 0.18,
                    jumpPhase: 0,
                    jumpCooldown: 999,
                    isAirborne: false,
                    prevX: x,
                    prevY: d,
                    prevZ: z,
                });
            }

            // 6. 6 Flying Seagulls circling overhead with active wingbeats & thermal glides
            const gullOrbits: Array<[number, number, number, number, number, number, number]> = [
                [-68, -78, 28, 24, 0.2, 0.28, 12.5],
                [-68, -78, 20, 22, 2.3, 0.32, 14.5],
                [-68, -78, 32, 28, 4.4, -0.24, 16.0],
                [2.5, -14, 16, 15, 1.0, 0.36, 10.5],
                [2.5, -14, 20, 18, 3.8, -0.30, 13.0],
                [56, -58, 18, 16, 0.8, 0.34, 11.5],
            ];
            gullOrbits.forEach(([cx, cz, rx, rz, a, spd, h], i) => {
                const { node, anim } = this._instantiateRigged(gullContainer, `seagull_${i}`, 2.45, ['fly'], 0.56 + (i % 3) * 0.05, true);
                const x = cx + Math.cos(a) * rx;
                const z = cz + Math.sin(a) * rz;
                node.position.set(x, h, z);
                this._gulls.push({
                    node,
                    anim,
                    isGliding: false,
                    centerX: cx,
                    centerZ: cz,
                    radiusX: rx,
                    radiusZ: rz,
                    angle: a,
                    angularSpeed: spd,
                    baseHeight: h,
                    bobPhase: i * 1.1,
                    prevX: x,
                    prevY: h,
                    prevZ: z,
                });
            });
        } catch (err) {
            console.warn('Failed loading some ocean creature GLBs:', err);
        }
    }

    public update(dt: number): void {
        this._time += dt;

        // 1. Update swimming & leaping ocean creatures
        for (let i = 0; i < this._swimmers.length; i++) {
            const s = this._swimmers[i];
            s.angle += s.angularSpeed * dt;

            let tx = s.orbitCenterX + Math.cos(s.angle) * s.radiusX;
            let tz = s.orbitCenterZ + Math.sin(s.angle) * s.radiusZ;

            // Keep swimming creatures strictly off island dry ground
            let groundH = this._islands.getTerrainHeightAt(tx, tz);
            if (groundH > -1.35) {
                const col = this._islands.getShipCollision(tx, tz, 2.5);
                if (col.collided) {
                    tx += col.pushX * 2.5;
                    tz += col.pushZ * 2.5;
                    groundH = this._islands.getTerrainHeightAt(tx, tz);
                }
            }

            const waterY = this._buoyancy.getWaterHeight(s.node.position);
            let targetY = waterY + s.baseDepth + Math.sin(this._time * 1.6 + s.verticalBobPhase) * s.verticalBobAmp;

            // Playful dolphin breach jump cycle
            if (s.kind === 'dolphin') {
                if (s.jumpPhase > 0) {
                    s.jumpPhase += dt * 0.82;
                    if (s.jumpPhase >= 1.0) {
                        s.jumpPhase = 0;
                        s.jumpCooldown = 2.4 + Math.random() * 2.6;
                    } else {
                        const arc = Math.sin(s.jumpPhase * Math.PI);
                        targetY = waterY - 0.6 + arc * 3.1;
                    }
                } else {
                    s.jumpCooldown -= dt;
                    if (s.jumpCooldown <= 0) {
                        s.jumpPhase = 0.001;
                    }
                }

                const nowAir = targetY > waterY + 0.08;
                if (nowAir !== s.isAirborne) {
                    s.isAirborne = nowAir;
                    if (this._shipProps) {
                        this._shipProps.createWaterSplashAt(
                            new BABYLON.Vector3(s.node.position.x, waterY, s.node.position.z),
                            0.55
                        );
                    }
                }
            }

            // Keep underwater swimmers cleanly above island seabed terrain
            if (groundH < -0.5 && targetY < groundH + 0.75) {
                targetY = groundH + 0.75;
            }

            const vx = (tx - s.prevX) / Math.max(dt, 0.001);
            const vy = (targetY - s.prevY) / Math.max(dt, 0.001);
            const vz = (tz - s.prevZ) / Math.max(dt, 0.001);

            s.node.position.set(tx, targetY, tz);

            const horiz = Math.hypot(vx, vz);
            if (horiz > 0.001) {
                const targetYaw = Math.atan2(vx, vz);
                const targetPitch = BABYLON.Scalar.Clamp(-Math.atan2(vy, horiz), -0.65, 0.65);
                const bankSign = s.angularSpeed > 0 ? 1 : -1;
                s.node.rotation.set(
                    BABYLON.Scalar.Lerp(s.node.rotation.x, targetPitch, 1.0 - Math.exp(-8.0 * dt)),
                    targetYaw,
                    bankSign * (s.kind === 'dolphin' ? 0.16 : 0.08)
                );
            }

            s.prevX = tx;
            s.prevY = targetY;
            s.prevZ = tz;
        }

        // 2. Update soaring seagulls with realistic flap-vs-thermal-glide cycles & wind weave
        for (let i = 0; i < this._gulls.length; i++) {
            const g = this._gulls[i];
            g.angle += g.angularSpeed * dt;

            // Alternate between flapping climbs and spread-wing thermal glides
            const soarWave = Math.sin(this._time * 0.78 + g.bobPhase);
            if (g.anim) {
                if (soarWave > 0.38) {
                    if (!g.isGliding) {
                        const mf = g.anim.animatables[0]?.masterFrame ?? 0;
                        if (mf <= 1.8 || mf >= 16.2) {
                            g.anim.goToFrame(0.3);
                            g.anim.pause();
                            g.isGliding = true;
                        }
                    }
                } else if (g.isGliding) {
                    g.anim.play(true);
                    g.isGliding = false;
                }
            }

            const flapHeave = !g.isGliding && g.anim
                ? Math.sin(((g.anim.animatables[0]?.masterFrame ?? 0) / 18) * Math.PI * 2) * 0.14
                : 0;
            const weave = Math.cos(g.angle * 2.0 + g.bobPhase) * 2.4;
            const tx = g.centerX + Math.cos(g.angle) * (g.radiusX + weave);
            const tz = g.centerZ + Math.sin(g.angle) * (g.radiusZ + weave);
            const ty = g.baseHeight + Math.sin(this._time * 0.9 + g.bobPhase) * 2.2 + flapHeave;

            const vx = (tx - g.prevX) / Math.max(dt, 0.001);
            const vy = (ty - g.prevY) / Math.max(dt, 0.001);
            const vz = (tz - g.prevZ) / Math.max(dt, 0.001);

            g.node.position.set(tx, ty, tz);

            const horiz = Math.hypot(vx, vz);
            if (horiz > 0.001) {
                const targetYaw = Math.atan2(vx, vz);
                const targetPitch = BABYLON.Scalar.Clamp(-Math.atan2(vy, horiz), -0.35, 0.35);
                const bank = (g.angularSpeed > 0 ? 1 : -1) * (g.isGliding ? 0.36 : 0.24);
                g.node.rotation.set(targetPitch, targetYaw, bank);
            }

            g.prevX = tx;
            g.prevY = ty;
            g.prevZ = tz;
        }
    }
}
