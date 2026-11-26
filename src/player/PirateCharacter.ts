export type CharacterPose = 'idle' | 'walk' | 'jump' | 'swim' | 'dive' | 'helm' | 'repair' | 'sail';

export interface CharacterAnimInput {
    pose: CharacterPose;
    moveSpeedRatio: number; // 0..1+
    isSlashing: boolean;
    slashProgress: number; // 0..1
}

/**
 * Procedural articulated 3D Pirate Captain character for Third-Person & Free-Camera views.
 */
export class PirateCharacter {
    public readonly root: BABYLON.TransformNode;

    private _scene: BABYLON.Scene;
    private _meshes: BABYLON.Mesh[] = [];

    // Hierarchical joints
    private _bodyPivot: BABYLON.TransformNode;
    private _headPivot: BABYLON.TransformNode;
    private _leftArmPivot: BABYLON.TransformNode;
    private _rightArmPivot: BABYLON.TransformNode;
    private _leftLegPivot: BABYLON.TransformNode;
    private _rightLegPivot: BABYLON.TransformNode;
    private _swordRig: BABYLON.TransformNode;

    private _animTime = 0;
    private _visible = false;

    constructor(scene: BABYLON.Scene, parent: BABYLON.TransformNode) {
        this._scene = scene;
        this.root = new BABYLON.TransformNode('pirateCharacterRoot', scene);
        this.root.parent = parent;

        // Materials
        const coatMat = this._makeMat('pirateCoatMat', new BABYLON.Color3(0.45, 0.09, 0.11), 0.78, 0.05);
        const trimGoldMat = this._makeMat('pirateGoldTrimMat', new BABYLON.Color3(0.88, 0.70, 0.22), 0.32, 0.85);
        const shirtMat = this._makeMat('pirateShirtMat', new BABYLON.Color3(0.88, 0.85, 0.78), 0.85, 0.0);
        const pantsMat = this._makeMat('piratePantsMat', new BABYLON.Color3(0.14, 0.14, 0.18), 0.88, 0.02);
        const leatherMat = this._makeMat('pirateLeatherMat', new BABYLON.Color3(0.18, 0.10, 0.06), 0.68, 0.08);
        const skinMat = this._makeMat('pirateSkinMat', new BABYLON.Color3(0.76, 0.56, 0.43), 0.72, 0.0);
        const hairMat = this._makeMat('pirateHairMat', new BABYLON.Color3(0.10, 0.07, 0.05), 0.85, 0.02);
        const hatMat = this._makeMat('pirateHatMat', new BABYLON.Color3(0.11, 0.10, 0.12), 0.75, 0.05);
        const featherMat = this._makeMat('pirateFeatherMat', new BABYLON.Color3(0.82, 0.16, 0.18), 0.65, 0.0);
        const steelMat = this._makeMat('pirateSwordSteelMat', new BABYLON.Color3(0.90, 0.93, 0.97), 0.20, 0.95);

        // Waist / Body Pivot (y = 0.88m from boot soles)
        this._bodyPivot = new BABYLON.TransformNode('charBodyPivot', scene);
        this._bodyPivot.parent = this.root;
        this._bodyPivot.position.set(0, 0.88, 0);

        // Torso (Captain's Coat)
        const torso = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charTorso', { width: 0.44, height: 0.54, depth: 0.24 }, scene),
            coatMat,
            this._bodyPivot
        );
        torso.position.set(0, 0.27, 0);

        // White Shirt Front V-Insert
        const shirtFront = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charShirtFront', { width: 0.14, height: 0.34, depth: 0.25 }, scene),
            shirtMat,
            this._bodyPivot
        );
        shirtFront.position.set(0, 0.35, -0.005);

        // Belt & Gold Buckle
        const belt = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charBelt', { width: 0.46, height: 0.08, depth: 0.26 }, scene),
            leatherMat,
            this._bodyPivot
        );
        belt.position.set(0, 0.05, 0);

        const buckle = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charBuckle', { width: 0.10, height: 0.09, depth: 0.27 }, scene),
            trimGoldMat,
            this._bodyPivot
        );
        buckle.position.set(0, 0.05, -0.01);

        // Coat Tails
        const coatTail = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charCoatTail', { width: 0.44, height: 0.22, depth: 0.23 }, scene),
            coatMat,
            this._bodyPivot
        );
        coatTail.position.set(0, -0.10, 0.01);

        // Epaulettes (Gold shoulder trim)
        const epL = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charEpL', { width: 0.12, height: 0.04, depth: 0.20 }, scene),
            trimGoldMat,
            this._bodyPivot
        );
        epL.position.set(-0.26, 0.53, 0);

        const epR = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charEpR', { width: 0.12, height: 0.04, depth: 0.20 }, scene),
            trimGoldMat,
            this._bodyPivot
        );
        epR.position.set(0.26, 0.53, 0);

        // Head Pivot (top of torso)
        this._headPivot = new BABYLON.TransformNode('charHeadPivot', scene);
        this._headPivot.parent = this._bodyPivot;
        this._headPivot.position.set(0, 0.56, 0);

        const neck = this._addMesh(
            BABYLON.MeshBuilder.CreateCylinder('charNeck', { diameter: 0.13, height: 0.10, tessellation: 10 }, scene),
            skinMat,
            this._headPivot
        );
        neck.position.set(0, 0.04, 0);

        const head = this._addMesh(
            BABYLON.MeshBuilder.CreateSphere('charHead', { diameterX: 0.24, diameterY: 0.27, diameterZ: 0.25, segments: 12 }, scene),
            skinMat,
            this._headPivot
        );
        head.position.set(0, 0.19, 0);

        // Beard & Eyepatch (facing -Z forward in Babylon RHS)
        const beard = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charBeard', { width: 0.19, height: 0.13, depth: 0.14 }, scene),
            hairMat,
            this._headPivot
        );
        beard.position.set(0, 0.11, -0.07);

        const patch = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charEyepatch', { width: 0.06, height: 0.045, depth: 0.02 }, scene),
            hairMat,
            this._headPivot
        );
        patch.position.set(0.055, 0.21, -0.122);

        // Classic Tricorn Pirate Hat
        const hatCrown = this._addMesh(
            BABYLON.MeshBuilder.CreateCylinder('charHatCrown', { diameterTop: 0.22, diameterBottom: 0.27, height: 0.14, tessellation: 12 }, scene),
            hatMat,
            this._headPivot
        );
        hatCrown.position.set(0, 0.33, 0);

        const hatBrim = this._addMesh(
            BABYLON.MeshBuilder.CreateCylinder('charHatBrim', { diameter: 0.52, height: 0.025, tessellation: 3 }, scene),
            hatMat,
            this._headPivot
        );
        hatBrim.position.set(0, 0.29, 0);
        hatBrim.rotation.y = -Math.PI / 2; // Point front tricorn corner forward (-Z)

        const hatTrim = this._addMesh(
            BABYLON.MeshBuilder.CreateTorus('charHatTrim', { diameter: 0.28, thickness: 0.018, tessellation: 16 }, scene),
            trimGoldMat,
            this._headPivot
        );
        hatTrim.position.set(0, 0.29, 0);

        const feather = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charFeather', { width: 0.03, height: 0.18, depth: 0.07 }, scene),
            featherMat,
            this._headPivot
        );
        feather.position.set(-0.14, 0.37, 0.04);
        feather.rotation.set(-0.25, 0, 0.35);

        // Left Arm
        this._leftArmPivot = new BABYLON.TransformNode('charLeftArmPivot', scene);
        this._leftArmPivot.parent = this._bodyPivot;
        this._leftArmPivot.position.set(-0.29, 0.49, 0);

        const leftSleeve = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charLeftSleeve', { width: 0.13, height: 0.44, depth: 0.13 }, scene),
            coatMat,
            this._leftArmPivot
        );
        leftSleeve.position.set(0, -0.20, 0);

        const leftCuff = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charLeftCuff', { width: 0.14, height: 0.07, depth: 0.14 }, scene),
            trimGoldMat,
            this._leftArmPivot
        );
        leftCuff.position.set(0, -0.39, 0);

        const leftHand = this._addMesh(
            BABYLON.MeshBuilder.CreateSphere('charLeftHand', { diameter: 0.10, segments: 8 }, scene),
            skinMat,
            this._leftArmPivot
        );
        leftHand.position.set(0, -0.46, 0);

        // Right Arm + Cutlass
        this._rightArmPivot = new BABYLON.TransformNode('charRightArmPivot', scene);
        this._rightArmPivot.parent = this._bodyPivot;
        this._rightArmPivot.position.set(0.29, 0.49, 0);

        const rightSleeve = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charRightSleeve', { width: 0.13, height: 0.44, depth: 0.13 }, scene),
            coatMat,
            this._rightArmPivot
        );
        rightSleeve.position.set(0, -0.20, 0);

        const rightCuff = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charRightCuff', { width: 0.14, height: 0.07, depth: 0.14 }, scene),
            trimGoldMat,
            this._rightArmPivot
        );
        rightCuff.position.set(0, -0.39, 0);

        const rightHand = this._addMesh(
            BABYLON.MeshBuilder.CreateSphere('charRightHand', { diameter: 0.10, segments: 8 }, scene),
            skinMat,
            this._rightArmPivot
        );
        rightHand.position.set(0, -0.46, 0);

        // Cutlass mounted in right hand pointing forward (-Z)
        this._swordRig = new BABYLON.TransformNode('charSwordRig', scene);
        this._swordRig.parent = this._rightArmPivot;
        this._swordRig.position.set(0, -0.47, -0.04);
        this._swordRig.rotation.set(-Math.PI * 0.42, 0, 0);

        const swordGrip = this._addMesh(
            BABYLON.MeshBuilder.CreateCylinder('charSwordGrip', { diameter: 0.03, height: 0.14 }, scene),
            leatherMat,
            this._swordRig
        );
        swordGrip.position.set(0, 0, 0);

        const swordGuard = this._addMesh(
            BABYLON.MeshBuilder.CreateSphere('charSwordGuard', { diameterX: 0.11, diameterY: 0.06, diameterZ: 0.11, segments: 8 }, scene),
            trimGoldMat,
            this._swordRig
        );
        swordGuard.position.set(0, 0.07, 0);

        const swordBlade = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charSwordBlade', { width: 0.04, height: 0.68, depth: 0.012 }, scene),
            steelMat,
            this._swordRig
        );
        swordBlade.position.set(0, 0.42, 0);
        this._swordRig.setEnabled(false);

        // Legs (hip pivots at y = 0.88)
        this._leftLegPivot = new BABYLON.TransformNode('charLeftLegPivot', scene);
        this._leftLegPivot.parent = this.root;
        this._leftLegPivot.position.set(-0.11, 0.88, 0);

        const leftThigh = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charLeftThigh', { width: 0.16, height: 0.48, depth: 0.17 }, scene),
            pantsMat,
            this._leftLegPivot
        );
        leftThigh.position.set(0, -0.24, 0);

        const leftBoot = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charLeftBoot', { width: 0.17, height: 0.44, depth: 0.22 }, scene),
            leatherMat,
            this._leftLegPivot
        );
        leftBoot.position.set(0, -0.66, -0.02);

        this._rightLegPivot = new BABYLON.TransformNode('charRightLegPivot', scene);
        this._rightLegPivot.parent = this.root;
        this._rightLegPivot.position.set(0.11, 0.88, 0);

        const rightThigh = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charRightThigh', { width: 0.16, height: 0.48, depth: 0.17 }, scene),
            pantsMat,
            this._rightLegPivot
        );
        rightThigh.position.set(0, -0.24, 0);

        const rightBoot = this._addMesh(
            BABYLON.MeshBuilder.CreateBox('charRightBoot', { width: 0.17, height: 0.44, depth: 0.22 }, scene),
            leatherMat,
            this._rightLegPivot
        );
        rightBoot.position.set(0, -0.66, -0.02);

        this.setVisible(false);
    }

    private _makeMat(name: string, color: BABYLON.Color3, roughness: number, metallic: number): BABYLON.PBRMaterial {
        const mat = new BABYLON.PBRMaterial(name, this._scene);
        mat.albedoColor = color;
        mat.roughness = roughness;
        mat.metallic = metallic;
        return mat;
    }

    private _addMesh(mesh: BABYLON.Mesh, mat: BABYLON.Material, parent: BABYLON.TransformNode): BABYLON.Mesh {
        mesh.material = mat;
        mesh.parent = parent;
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        this._meshes.push(mesh);
        return mesh;
    }

    public registerShadowCasters(shadowGenerator: BABYLON.ShadowGenerator): void {
        for (const mesh of this._meshes) {
            shadowGenerator.addShadowCaster(mesh);
        }
    }

    public setVisible(visible: boolean): void {
        if (this._visible === visible) return;
        this._visible = visible;
        this.root.setEnabled(visible);
    }

    public setCutlassEquipped(equipped: boolean): void {
        this._swordRig.setEnabled(equipped);
    }

    public update(dt: number, input: CharacterAnimInput): void {
        if (!this._visible) return;

        this._animTime += dt;
        const blend = 1.0 - Math.exp(-12.0 * dt);

        // Target joint rotations
        let bodyPitch = 0;
        let bodyY = 0.88;
        let headPitch = 0;
        let leftArmX = 0;
        let leftArmZ = -0.08;
        let rightArmX = 0;
        let rightArmZ = 0.08;
        let leftLegX = 0;
        let rightLegX = 0;

        switch (input.pose) {
            case 'walk': {
                const freq = 9.5;
                const phase = this._animTime * freq;
                const amp = Math.min(1.1, 0.45 + input.moveSpeedRatio * 0.55);
                const swing = Math.sin(phase) * 0.62 * amp;
                leftLegX = swing;
                rightLegX = -swing;
                leftArmX = -swing * 0.78;
                rightArmX = swing * 0.78;
                bodyY = 0.88 + Math.abs(Math.cos(phase)) * 0.035 * amp;
                bodyPitch = -0.05 * amp;
                break;
            }
            case 'jump': {
                bodyPitch = -0.08;
                leftLegX = 0.45;
                rightLegX = -0.30;
                leftArmX = 0.75;
                leftArmZ = -0.35;
                rightArmX = 0.65;
                rightArmZ = 0.35;
                break;
            }
            case 'swim':
            case 'dive': {
                const isDive = input.pose === 'dive';
                const speedFactor = Math.max(0.45, input.moveSpeedRatio);
                const phase = this._animTime * (isDive ? 6.5 : 5.2);
                // Lean forward (-Z) in water while legs trail behind (+Z) and arms stroke forward
                bodyPitch = isDive ? -1.35 : -0.95;
                headPitch = isDive ? 0.55 : 0.78;
                bodyY = 0.92;

                const kick = Math.sin(phase * 1.4) * 0.45 * speedFactor;
                leftLegX = bodyPitch + kick;
                rightLegX = bodyPitch - kick;

                const strokeL = Math.sin(phase) * 0.85 * speedFactor;
                const strokeR = Math.sin(phase + Math.PI) * 0.85 * speedFactor;
                leftArmX = 1.65 + strokeL;
                rightArmX = 1.65 + strokeR;
                leftArmZ = -0.32;
                rightArmZ = 0.32;
                break;
            }
            case 'helm': {
                bodyPitch = -0.06;
                leftArmX = 0.95;
                rightArmX = 0.95;
                leftArmZ = 0.16;
                rightArmZ = -0.16;
                break;
            }
            case 'sail': {
                const haul = Math.sin(this._animTime * 4.0) * 0.18;
                leftArmX = 1.65 + haul;
                rightArmX = 1.55 - haul;
                leftArmZ = -0.15;
                rightArmZ = 0.15;
                break;
            }
            case 'repair': {
                bodyPitch = -0.38;
                headPitch = 0.20;
                leftArmX = 0.45;
                rightArmX = 0.85 + Math.sin(this._animTime * 8.0) * 0.25;
                leftLegX = 0.22;
                rightLegX = -0.22;
                break;
            }
            case 'idle':
            default: {
                const breath = Math.sin(this._animTime * 2.1);
                bodyY = 0.88 + breath * 0.01;
                leftArmX = breath * 0.04;
                rightArmX = -breath * 0.04;
                break;
            }
        }

        // Overlay sword slash flourish on right arm (+X = forward/up in RHS)
        if (input.isSlashing) {
            const p = input.slashProgress;
            if (p < 0.35) {
                const k = p / 0.35;
                rightArmX = BABYLON.Scalar.Lerp(rightArmX, 2.25, k);
                rightArmZ = BABYLON.Scalar.Lerp(rightArmZ, 0.45, k);
            } else {
                const k = (p - 0.35) / 0.65;
                rightArmX = BABYLON.Scalar.Lerp(2.25, -0.20, k);
                rightArmZ = BABYLON.Scalar.Lerp(0.45, -0.35, k);
            }
        }

        // Smoothly blend joints
        this._bodyPivot.position.y = BABYLON.Scalar.Lerp(this._bodyPivot.position.y, bodyY, blend);
        this._bodyPivot.rotation.x = BABYLON.Scalar.Lerp(this._bodyPivot.rotation.x, bodyPitch, blend);
        this._headPivot.rotation.x = BABYLON.Scalar.Lerp(this._headPivot.rotation.x, headPitch, blend);

        this._leftArmPivot.rotation.x = BABYLON.Scalar.Lerp(this._leftArmPivot.rotation.x, leftArmX, blend);
        this._leftArmPivot.rotation.z = BABYLON.Scalar.Lerp(this._leftArmPivot.rotation.z, leftArmZ, blend);
        this._rightArmPivot.rotation.x = BABYLON.Scalar.Lerp(this._rightArmPivot.rotation.x, rightArmX, blend);
        this._rightArmPivot.rotation.z = BABYLON.Scalar.Lerp(this._rightArmPivot.rotation.z, rightArmZ, blend);

        this._leftLegPivot.rotation.x = BABYLON.Scalar.Lerp(this._leftLegPivot.rotation.x, leftLegX, blend);
        this._rightLegPivot.rotation.x = BABYLON.Scalar.Lerp(this._rightLegPivot.rotation.x, rightLegX, blend);
    }
}
