export type CharacterPose = 'idle' | 'walk' | 'jump' | 'swim' | 'dive' | 'helm' | 'repair' | 'sail';

export interface CharacterAnimInput {
    pose: CharacterPose;
    moveSpeedRatio: number; // 0..1+
    isSlashing: boolean;
    slashProgress: number; // 0..1
}

/**
 * Real rigged & animated 3D Pirate Captain character (loaded from `models/pirate_captain.glb`
 * with matching `models/pirate_sword.glb` weapon) for Third-Person & Free-Camera views.
 *
 * Character forward in player space is `-Z` (glTF forward `+Z` is rotated `Math.PI` under `_modelPivot`).
 */
export class PirateCharacter {
    public readonly root: BABYLON.TransformNode;

    private _scene: BABYLON.Scene;
    private _modelPivot: BABYLON.TransformNode;
    private _meshes: BABYLON.AbstractMesh[] = [];
    private _shadowGenerator: BABYLON.ShadowGenerator | null = null;

    // Skeleton bone transform nodes (from GLB)
    private _bones: Record<string, BABYLON.TransformNode | undefined> = {};
    private _swordMount: BABYLON.TransformNode | null = null;
    private _swordMeshes: BABYLON.AbstractMesh[] = [];

    // Imported skeletal animation groups
    private _idleAnim: BABYLON.AnimationGroup | null = null;
    private _walkAnim: BABYLON.AnimationGroup | null = null;
    private _runAnim: BABYLON.AnimationGroup | null = null;
    private _modelLoaded = false;

    // Animation & blend state
    private _animTime = 0;
    private _visible = false;
    private _cutlassEquipped = false;
    private _idleW = 1;
    private _walkW = 0;
    private _runW = 0;

    private _overlayWeights: Record<'jump' | 'swim' | 'dive' | 'helm' | 'sail' | 'repair', number> = {
        jump: 0,
        swim: 0,
        dive: 0,
        helm: 0,
        sail: 0,
        repair: 0,
    };

    // Scratch math objects (zero per-frame heap allocations)
    private readonly _tmpDeltaQuat = new BABYLON.Quaternion();
    private readonly _tmpOrigQuat = new BABYLON.Quaternion();

    constructor(scene: BABYLON.Scene, parent: BABYLON.TransformNode) {
        this._scene = scene;
        this.root = new BABYLON.TransformNode('pirateCharacterRoot', scene);
        this.root.parent = parent;

        this._modelPivot = new BABYLON.TransformNode('pirateModelPivot', scene);
        this._modelPivot.parent = this.root;
        this._modelPivot.scaling.setAll(0.96);

        this.setVisible(false);
        void this._loadModelsAsync();
    }

    private async _loadModelsAsync(): Promise<void> {
        try {
            const result = await BABYLON.SceneLoader.ImportMeshAsync('', 'models/', 'pirate_captain.glb', this._scene);
            const assetRoot = result.meshes[0];
            assetRoot.parent = this._modelPivot;
            assetRoot.rotationQuaternion = null;
            // glTF character faces +Z; player coordinate space faces -Z
            assetRoot.rotation.set(0, Math.PI, 0);
            assetRoot.position.set(0, 0, 0);

            const configuredMats = new Set<BABYLON.Material>();
            for (const mesh of result.meshes) {
                mesh.isPickable = false;
                mesh.receiveShadows = true;
                mesh.isVisible = this._visible;
                this._meshes.push(mesh);

                if (mesh.material && !configuredMats.has(mesh.material)) {
                    configuredMats.add(mesh.material);
                    const pbr = mesh.material as BABYLON.PBRMaterial;
                    pbr.backFaceCulling = false;
                    if ('twoSidedLighting' in pbr) pbr.twoSidedLighting = true;
                    if ('environmentIntensity' in pbr) pbr.environmentIntensity = 1.15;
                    if (typeof pbr.roughness === 'number') pbr.roughness = 0.72;
                }

                if (this._shadowGenerator && mesh.getTotalVertices() > 0) {
                    this._shadowGenerator.addShadowCaster(mesh);
                }
            }

            // Map skeleton & attachment TransformNodes for animation overlays
            const wantedNodes = [
                'Hips',
                'Spine',
                'Spine1',
                'Spine2',
                'Neck',
                'Head',
                'LeftShoulder',
                'LeftArm',
                'LeftForeArm',
                'RightShoulder',
                'RightArm',
                'RightForeArm',
                'RightHand',
                'attach-righthand',
                'LeftUpLeg',
                'LeftLeg',
                'RightUpLeg',
                'RightLeg',
            ];
            for (const node of result.transformNodes) {
                if (wantedNodes.includes(node.name)) {
                    this._bones[node.name] = node;
                }
            }

            // Configure Idle, Walk, Run animation groups with weighted blending
            for (const ag of result.animationGroups) {
                ag.stop();
                ag.loopAnimation = true;
                const lname = ag.name.toLowerCase();
                if (lname.includes('idle') && !this._idleAnim) {
                    this._idleAnim = ag;
                } else if (lname.includes('walk') && !this._walkAnim) {
                    this._walkAnim = ag;
                } else if (lname.includes('run') && !this._runAnim) {
                    this._runAnim = ag;
                }
            }

            for (const ag of [this._idleAnim, this._walkAnim, this._runAnim]) {
                if (ag) {
                    ag.start(true);
                    ag.setWeightForAllAnimatables(ag === this._idleAnim ? 1 : 0);
                    if (!this._visible) {
                        ag.pause();
                    }
                }
            }

            this._modelLoaded = true;
            this._modelPivot.setEnabled(this._visible);

            // Attach 3D cutlass/sword model to right hand socket
            await this._loadSwordAsync();
        } catch (err) {
            console.warn('Failed to load real 3D pirate_captain.glb model:', err);
        }
    }

    private async _loadSwordAsync(): Promise<void> {
        const rightHandSocket = this._bones['attach-righthand'] ?? this._bones['RightHand'];
        if (!rightHandSocket) return;

        try {
            const swordResult = await BABYLON.SceneLoader.ImportMeshAsync('', 'models/', 'pirate_sword.glb', this._scene);
            this._swordMount = new BABYLON.TransformNode('pirateSwordMount', this._scene);
            this._swordMount.parent = rightHandSocket;
            // Align +Y blade forward along RightHand +Z palm axis
            this._swordMount.rotation.set(Math.PI * 0.48, 0, Math.PI * 0.06);
            this._swordMount.scaling.setAll(1.05);

            const swordRoot = swordResult.meshes[0];
            swordRoot.parent = this._swordMount;
            swordRoot.position.set(0, -0.09, 0);

            for (const mesh of swordResult.meshes) {
                mesh.isPickable = false;
                mesh.receiveShadows = true;
                this._swordMeshes.push(mesh);

                if (mesh.material) {
                    const pbr = mesh.material as BABYLON.PBRMaterial;
                    pbr.backFaceCulling = false;
                    if ('environmentIntensity' in pbr) pbr.environmentIntensity = 1.15;
                }
                if (this._shadowGenerator && mesh.getTotalVertices() > 0) {
                    this._shadowGenerator.addShadowCaster(mesh);
                }
            }

            this._syncSwordVisibility();
        } catch (err) {
            console.warn('Failed to load pirate_sword.glb:', err);
        }
    }

    private _syncSwordVisibility(): void {
        const showSword = this._visible && this._cutlassEquipped;
        if (this._swordMount) {
            this._swordMount.setEnabled(showSword);
        }
        for (const mesh of this._swordMeshes) {
            mesh.isVisible = showSword;
        }
    }

    public registerShadowCasters(shadowGenerator: BABYLON.ShadowGenerator): void {
        this._shadowGenerator = shadowGenerator;
        for (const mesh of this._meshes) {
            if (mesh.getTotalVertices() > 0) {
                shadowGenerator.addShadowCaster(mesh);
            }
        }
        for (const mesh of this._swordMeshes) {
            if (mesh.getTotalVertices() > 0) {
                shadowGenerator.addShadowCaster(mesh);
            }
        }
    }

    public setVisible(visible: boolean): void {
        if (this._visible === visible) return;
        this._visible = visible;
        this.root.setEnabled(visible);
        this._modelPivot.setEnabled(visible);

        for (const mesh of this._meshes) {
            mesh.isVisible = visible;
        }

        if (this._modelLoaded) {
            for (const ag of [this._idleAnim, this._walkAnim, this._runAnim]) {
                if (!ag) continue;
                if (visible) {
                    if (!ag.isStarted) {
                        ag.start(true);
                    } else if (!ag.isPlaying) {
                        ag.play(true);
                    }
                } else {
                    ag.pause();
                }
            }
        }

        this._syncSwordVisibility();
    }

    public setCutlassEquipped(equipped: boolean): void {
        if (this._cutlassEquipped === equipped) return;
        this._cutlassEquipped = equipped;
        this._syncSwordVisibility();
    }

    private _applyBoneDelta(node: BABYLON.TransformNode | undefined, rx: number, ry: number, rz: number): void {
        if (!node || (Math.abs(rx) < 1e-4 && Math.abs(ry) < 1e-4 && Math.abs(rz) < 1e-4)) return;
        if (!node.rotationQuaternion) {
            node.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(
                node.rotation.x,
                node.rotation.y,
                node.rotation.z
            );
        }
        this._tmpOrigQuat.copyFrom(node.rotationQuaternion);
        BABYLON.Quaternion.FromEulerAnglesToRef(rx, ry, rz, this._tmpDeltaQuat);
        this._tmpDeltaQuat.multiplyToRef(this._tmpOrigQuat, node.rotationQuaternion);
    }

    public update(dt: number, input: CharacterAnimInput): void {
        if (!this._visible || !this._modelLoaded) return;

        this._animTime += dt;
        const blend = 1.0 - Math.exp(-12.0 * dt);

        // 1. Crossfade built-in skeletal AnimationGroups (Idle / Walk / Run)
        let targetIdle = 1;
        let targetWalk = 0;
        let targetRun = 0;

        if (input.pose === 'walk') {
            if (input.moveSpeedRatio > 1.05) {
                targetRun = 1;
                targetIdle = 0;
            } else if (input.moveSpeedRatio > 0.08) {
                targetWalk = BABYLON.Scalar.Clamp(input.moveSpeedRatio, 0.25, 1);
                targetIdle = 1 - targetWalk;
            }
        }

        this._idleW = BABYLON.Scalar.Lerp(this._idleW, targetIdle, blend);
        this._walkW = BABYLON.Scalar.Lerp(this._walkW, targetWalk, blend);
        this._runW = BABYLON.Scalar.Lerp(this._runW, targetRun, blend);

        const weightSum = this._idleW + this._walkW + this._runW || 1;
        if (this._idleAnim) {
            this._idleAnim.setWeightForAllAnimatables(this._idleW / weightSum);
            this._idleAnim.speedRatio = input.pose === 'helm' || input.pose === 'repair' ? 0.65 : 1.0;
        }
        if (this._walkAnim) {
            this._walkAnim.setWeightForAllAnimatables(this._walkW / weightSum);
            this._walkAnim.speedRatio = BABYLON.Scalar.Clamp(0.75 + input.moveSpeedRatio * 0.45, 0.55, 1.45);
        }
        if (this._runAnim) {
            this._runAnim.setWeightForAllAnimatables(this._runW / weightSum);
            this._runAnim.speedRatio = BABYLON.Scalar.Clamp(0.85 + input.moveSpeedRatio * 0.30, 0.75, 1.35);
        }

        // 2. Smooth gameplay pose overlay weights
        const poses: Array<keyof typeof this._overlayWeights> = ['jump', 'swim', 'dive', 'helm', 'sail', 'repair'];
        for (const p of poses) {
            const target = input.pose === p ? 1 : 0;
            this._overlayWeights[p] = BABYLON.Scalar.Lerp(this._overlayWeights[p], target, blend);
        }

        const jumpW = this._overlayWeights.jump;
        const swimW = this._overlayWeights.swim;
        const diveW = this._overlayWeights.dive;
        const helmW = this._overlayWeights.helm;
        const sailW = this._overlayWeights.sail;
        const repairW = this._overlayWeights.repair;

        // 3. Body tilt & vertical offset inside _modelPivot (player space -Z forward)
        const targetPitchX =
            -0.08 * jumpW + -0.68 * swimW + -1.26 * diveW + -0.26 * repairW;
        const targetOffsetY = 0.22 * swimW + 0.88 * diveW;

        this._modelPivot.rotation.x = BABYLON.Scalar.Lerp(this._modelPivot.rotation.x, targetPitchX, blend);
        this._modelPivot.position.y = BABYLON.Scalar.Lerp(this._modelPivot.position.y, targetOffsetY, blend);

        // 4. Bone overlays (applied after scene animation tick in glTF parent frames)
        // Jump tuck
        if (jumpW > 0.01) {
            this._applyBoneDelta(this._bones['LeftUpLeg'], -0.55 * jumpW, 0, 0);
            this._applyBoneDelta(this._bones['LeftLeg'], 0.85 * jumpW, 0, 0);
            this._applyBoneDelta(this._bones['RightUpLeg'], -0.20 * jumpW, 0, 0);
            this._applyBoneDelta(this._bones['RightLeg'], 0.45 * jumpW, 0, 0);
            this._applyBoneDelta(this._bones['LeftArm'], -0.65 * jumpW, 0, 0.45 * jumpW);
            this._applyBoneDelta(this._bones['RightArm'], -0.65 * jumpW, 0, -0.45 * jumpW);
        }

        // Helm steering hands on wheel
        if (helmW > 0.01) {
            const steerSway = Math.sin(this._animTime * 1.4) * 0.10 * helmW;
            this._applyBoneDelta(this._bones['Spine1'], 0.08 * helmW, 0, 0);
            this._applyBoneDelta(this._bones['LeftArm'], -0.92 * helmW + steerSway, -0.15 * helmW, 0.12 * helmW);
            this._applyBoneDelta(this._bones['RightArm'], -0.92 * helmW - steerSway, 0.15 * helmW, -0.12 * helmW);
            this._applyBoneDelta(this._bones['LeftForeArm'], 0, -0.35 * helmW, 0);
            this._applyBoneDelta(this._bones['RightForeArm'], 0, 0.35 * helmW, 0);
        }

        // Sail halyard rope hauling
        if (sailW > 0.01) {
            const haul = Math.sin(this._animTime * 4.2) * 0.32 * sailW;
            this._applyBoneDelta(this._bones['Head'], -0.28 * sailW, 0, 0);
            this._applyBoneDelta(this._bones['LeftArm'], -1.85 * sailW + haul, 0, 0.12 * sailW);
            this._applyBoneDelta(this._bones['RightArm'], -1.85 * sailW - haul, 0, -0.12 * sailW);
        }

        // Deck repair hammering
        if (repairW > 0.01) {
            const hammer = Math.sin(this._animTime * 8.0) * 0.45 * repairW;
            this._applyBoneDelta(this._bones['Spine1'], 0.22 * repairW, 0, 0);
            this._applyBoneDelta(this._bones['Spine2'], 0.18 * repairW, 0, 0);
            this._applyBoneDelta(this._bones['LeftArm'], -0.55 * repairW, 0, 0);
            this._applyBoneDelta(this._bones['RightArm'], -1.10 * repairW - hammer, 0, 0);
        }

        // Surface swimming & underwater diving strokes
        const waterW = swimW + diveW;
        if (waterW > 0.01) {
            const speedFactor = Math.max(0.45, input.moveSpeedRatio);
            const phase = this._animTime * (diveW > swimW ? 6.2 : 5.0);
            const kick = Math.sin(phase * 1.4) * 0.42 * speedFactor * waterW;
            const strokeL = Math.sin(phase) * 0.85 * speedFactor * waterW;
            const strokeR = Math.sin(phase + Math.PI) * 0.85 * speedFactor * waterW;

            this._applyBoneDelta(this._bones['Head'], -0.52 * swimW - 0.42 * diveW, 0, 0);
            this._applyBoneDelta(this._bones['LeftUpLeg'], kick, 0, 0);
            this._applyBoneDelta(this._bones['RightUpLeg'], -kick, 0, 0);
            this._applyBoneDelta(this._bones['LeftLeg'], 0.25 * waterW, 0, 0);
            this._applyBoneDelta(this._bones['RightLeg'], 0.25 * waterW, 0, 0);
            this._applyBoneDelta(this._bones['LeftArm'], -1.35 * waterW + strokeL, 0, 0.35 * waterW);
            this._applyBoneDelta(this._bones['RightArm'], -1.35 * waterW + strokeR, 0, -0.35 * waterW);
        }

        // Cutlass slash overlay
        if (input.isSlashing) {
            const p = input.slashProgress;
            let armPitch = 0;
            let armRoll = 0;
            let spineYaw = 0;

            if (p < 0.32) {
                const k = p / 0.32;
                armPitch = -2.05 * k;
                armRoll = -0.50 * k;
                spineYaw = -0.30 * k;
            } else if (p < 0.72) {
                const k = (p - 0.32) / 0.40;
                armPitch = BABYLON.Scalar.Lerp(-2.05, 0.25, k);
                armRoll = BABYLON.Scalar.Lerp(-0.50, 0.50, k);
                spineYaw = BABYLON.Scalar.Lerp(-0.30, 0.38, k);
            } else {
                const k = (p - 0.72) / 0.28;
                armPitch = BABYLON.Scalar.Lerp(0.25, 0, k);
                armRoll = BABYLON.Scalar.Lerp(0.50, 0, k);
                spineYaw = BABYLON.Scalar.Lerp(0.38, 0, k);
            }

            this._applyBoneDelta(this._bones['Spine2'], 0, spineYaw, 0);
            this._applyBoneDelta(this._bones['RightArm'], armPitch, 0, armRoll);
        }
    }
}
