/**
 * 3D Interactive Props, FX, and Weapons for the Pirate Ship.
 */
export class ShipProps {
    private _scene: BABYLON.Scene;
    private _shipRoot: BABYLON.TransformNode;

    // Interactive 3D Objects
    public chestLidNode: BABYLON.TransformNode | null = null;
    public chestBaseMesh: BABYLON.Mesh | null = null;
    public chestLidMesh: BABYLON.Mesh | null = null;
    public chestGlowLight: BABYLON.PointLight | null = null;
    public chestParticles: BABYLON.ParticleSystem | null = null;
    public isChestOpen = false;

    // Weapon Rack & Cutlass
    public weaponRackRoot: BABYLON.TransformNode | null = null;
    public cutlassViewMesh: BABYLON.TransformNode | null = null;
    public isCutlassEquipped = false;
    public isSwinging = false;

    // Repair Point
    public repairRootNode: BABYLON.TransformNode | null = null;
    public repairMesh: BABYLON.Mesh | null = null;
    public repairNail1: BABYLON.Mesh | null = null;
    public repairNail2: BABYLON.Mesh | null = null;
    public repairProgress = 0.65;
    public isRepaired = false;

    // Ship Lookout Edge Marker
    public shipEdgeRoot: BABYLON.TransformNode | null = null;
    public shipEdgePlateMesh: BABYLON.Mesh | null = null;

    // Cannon References
    public portCannonMesh: BABYLON.TransformNode | null = null;
    public starboardCannonMesh: BABYLON.TransformNode | null = null;
    private _cannonSmokeSystem: BABYLON.ParticleSystem | null = null;
    private _cannonFireSystem: BABYLON.ParticleSystem | null = null;

    // Sails Reference & Wind Wave Simulation
    public sailsMesh: BABYLON.Mesh | null = null;
    public baseSailScaling: BABYLON.Vector3 | null = null;
    public baseSailPosition: BABYLON.Vector3 | null = null;
    public tiesMesh: BABYLON.Mesh | null = null;
    public baseTiesScaling: BABYLON.Vector3 | null = null;
    public baseTiesPosition: BABYLON.Vector3 | null = null;
    public isSailsTrimmed = false;
    public sailTrim = 0.85;

    // Wind wave air animation properties
    public windWaveEnabled = true;
    public windWaveSpeed = 2.6;
    public windWaveIntensity = 0.12;
    private _windTime = 0;
    private _baseSailPositions: Float32Array | null = null;
    private _animatedSailPositions: Float32Array | null = null;

    // Helm Reference
    public helmWheelMesh: BABYLON.TransformNode | null = null;
    public baseWheelQuaternion: BABYLON.Quaternion | null = null;
    public helmAngle = 0;

    constructor(scene: BABYLON.Scene, shipRoot: BABYLON.TransformNode) {
        this._scene = scene;
        this._shipRoot = shipRoot;

        this._findExistingShipMeshes();
        this._buildTreasureChest();
        this._buildWeaponRack();
        this._buildRepairPoint();
        this._buildShipEdgeMarker();
        this._setupCannonFX();

        // Animate wind waving on sail canvas
        this._scene.onBeforeRenderObservable.add(() => {
            this._updateSailWindWave();
        });
    }

    private _findExistingShipMeshes(): void {
        const steeringWheel = this._scene.getMeshByName("Steering Wheel") || this._scene.getTransformNodeByName("Steering Wheel");
        if (steeringWheel) {
            this.helmWheelMesh = steeringWheel;
            // Position wheel prominently on the quarterdeck overlooking the main deck and sea
            // In ship coordinates: x=0, y=2.75, z=3.30
            const emptyScale = steeringWheel.parent && (steeringWheel.parent as any).scaling ? (steeringWheel.parent as any).scaling.x : 3.72825;
            steeringWheel.position.set(0, 2.75 / emptyScale, 3.30 / emptyScale);
            // Scale wheel up to authentic naval helm size (diameter ~0.85m)
            steeringWheel.scaling.setAll(steeringWheel.scaling.x * 2.6);
            if (steeringWheel.rotationQuaternion) {
                this.baseWheelQuaternion = steeringWheel.rotationQuaternion.clone();
            }

            // Build handsome weathered mahogany helm binnacle / pedestal stand under wheel
            const binnacleMat = new BABYLON.PBRMaterial("binnacleMat", this._scene);
            binnacleMat.albedoColor = new BABYLON.Color3(0.35, 0.20, 0.12);
            binnacleMat.roughness = 0.6;
            binnacleMat.metallic = 0.1;
            const binnacle = BABYLON.MeshBuilder.CreateBox("helmBinnacle", { width: 0.35, height: 0.75, depth: 0.35 }, this._scene);
            binnacle.parent = this._shipRoot;
            binnacle.position.set(0, 2.45 + 0.375, 3.30);
            binnacle.material = binnacleMat;

            // Brass compass dome on top of binnacle
            const brassDomeMat = new BABYLON.PBRMaterial("brassDomeMat", this._scene);
            brassDomeMat.albedoColor = new BABYLON.Color3(0.92, 0.78, 0.28);
            brassDomeMat.metallic = 0.95;
            brassDomeMat.roughness = 0.25;
            const dome = BABYLON.MeshBuilder.CreateSphere("compassDome", { diameter: 0.18 }, this._scene);
            dome.parent = this._shipRoot;
            dome.position.set(0, 2.45 + 0.84, 3.30);
            dome.material = brassDomeMat;
        }

        const sails = this._scene.getMeshByName("Sails");
        if (sails) {
            this.sailsMesh = sails as BABYLON.Mesh;
            this.baseSailScaling = sails.scaling.clone();
            this.baseSailPosition = sails.position.clone();

            // Setup dynamic updatable vertex buffer for wind waving air simulation
            const positions = this.sailsMesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
            if (positions) {
                this._baseSailPositions = new Float32Array(positions);
                this._animatedSailPositions = new Float32Array(positions);
                this.sailsMesh.setVerticesData(BABYLON.VertexBuffer.PositionKind, this._animatedSailPositions, true);
            }
        }

        const ties = this._scene.getMeshByName("Ties");
        if (ties) {
            this.tiesMesh = ties as BABYLON.Mesh;
            this.baseTiesScaling = ties.scaling.clone();
            this.baseTiesPosition = ties.position.clone();
        }

        const cannons = this._scene.getMeshByName("Cannons") || this._scene.getTransformNodeByName("Cannons");
        if (cannons) {
            this.portCannonMesh = cannons;
            this.starboardCannonMesh = cannons;
        }

        // Apply tall sail height and high sail elevation so sea view is completely open
        this.setSailHeight(1.30);
        this.setSailElevation(2.40);
    }

    /**
     * Builds an authentic ornate wooden pirate treasure chest with brass bands and gold coins
     */
    private _buildTreasureChest(): void {
        const chestRoot = new BABYLON.TransformNode("treasureChestRoot", this._scene);
        chestRoot.parent = this._shipRoot;
        // Positioned on the quarterdeck near the aft bulkhead
        chestRoot.position.set(-0.95, 2.48, 4.8);
        chestRoot.rotation = new BABYLON.Vector3(0, 0.4, 0);

        const woodMat = new BABYLON.PBRMaterial("chestWoodMat", this._scene);
        woodMat.albedoColor = new BABYLON.Color3(0.35, 0.20, 0.10);
        woodMat.roughness = 0.65;
        woodMat.metallic = 0.05;

        const brassMat = new BABYLON.PBRMaterial("chestBrassMat", this._scene);
        brassMat.albedoColor = new BABYLON.Color3(0.85, 0.68, 0.22);
        brassMat.roughness = 0.35;
        brassMat.metallic = 0.90;

        const goldMat = new BABYLON.PBRMaterial("chestGoldMat", this._scene);
        goldMat.albedoColor = new BABYLON.Color3(1.0, 0.82, 0.15);
        goldMat.roughness = 0.25;
        goldMat.metallic = 0.95;

        // Base Box
        const chestBase = BABYLON.MeshBuilder.CreateBox("chestBase", { width: 0.7, height: 0.35, depth: 0.45 }, this._scene);
        chestBase.position.y = 0.175;
        chestBase.material = woodMat;
        chestBase.parent = chestRoot;
        this.chestBaseMesh = chestBase;

        // Brass Straps on Base
        const strap1 = BABYLON.MeshBuilder.CreateBox("strap1", { width: 0.71, height: 0.36, depth: 0.06 }, this._scene);
        strap1.position.set(0, 0.175, -0.12);
        strap1.material = brassMat;
        strap1.parent = chestRoot;

        const strap2 = BABYLON.MeshBuilder.CreateBox("strap2", { width: 0.71, height: 0.36, depth: 0.06 }, this._scene);
        strap2.position.set(0, 0.175, 0.12);
        strap2.material = brassMat;
        strap2.parent = chestRoot;

        // Padlock plate
        const lock = BABYLON.MeshBuilder.CreateCylinder("lock", { diameter: 0.07, height: 0.03 }, this._scene);
        lock.rotation.x = Math.PI / 2;
        lock.position.set(0, 0.30, 0.23);
        lock.material = brassMat;
        lock.parent = chestRoot;

        // Hinged Lid Pivot
        const lidPivot = new BABYLON.TransformNode("chestLidPivot", this._scene);
        lidPivot.parent = chestRoot;
        lidPivot.position.set(0, 0.35, -0.22);
        this.chestLidNode = lidPivot;

        // Arched Lid
        const lidMesh = BABYLON.MeshBuilder.CreateCylinder("lidMesh", {
            diameter: 0.45,
            height: 0.7,
            arc: 0.5,
            tessellation: 16
        }, this._scene);
        lidMesh.rotation.z = Math.PI / 2;
        lidMesh.rotation.y = Math.PI;
        lidMesh.position.set(0, 0, 0.22);
        lidMesh.material = woodMat;
        lidMesh.parent = lidPivot;
        this.chestLidMesh = lidMesh;

        // Gold Pile inside chest (revealed on open)
        const goldPile = BABYLON.MeshBuilder.CreateSphere("goldPile", { diameterX: 0.55, diameterY: 0.18, diameterZ: 0.35, segments: 8 }, this._scene);
        goldPile.position.set(0, 0.26, 0);
        goldPile.material = goldMat;
        goldPile.parent = chestRoot;

        // Sparkling golden light inside
        this.chestGlowLight = new BABYLON.PointLight("chestGlow", new BABYLON.Vector3(0, 0.4, 0), this._scene);
        this.chestGlowLight.diffuse = new BABYLON.Color3(1.0, 0.85, 0.3);
        this.chestGlowLight.intensity = 0; // Off until opened
        this.chestGlowLight.range = 3.5;
        this.chestGlowLight.parent = chestRoot;

        // Gold Sparkle Particles
        this.chestParticles = new BABYLON.ParticleSystem("chestParticles", 150, this._scene);
        this.chestParticles.particleTexture = new BABYLON.Texture("textures/flare.png", this._scene);
        this.chestParticles.emitter = chestRoot.position.add(new BABYLON.Vector3(0, 0.4, 0));
        this.chestParticles.minEmitBox = new BABYLON.Vector3(-0.25, 0, -0.15);
        this.chestParticles.maxEmitBox = new BABYLON.Vector3(0.25, 0.1, 0.15);
        this.chestParticles.color1 = new BABYLON.Color4(1.0, 0.9, 0.2, 1.0);
        this.chestParticles.color2 = new BABYLON.Color4(1.0, 0.6, 0.0, 0.8);
        this.chestParticles.colorDead = new BABYLON.Color4(0.8, 0.4, 0.0, 0.0);
        this.chestParticles.minSize = 0.04;
        this.chestParticles.maxSize = 0.12;
        this.chestParticles.minLifeTime = 0.6;
        this.chestParticles.maxLifeTime = 1.4;
        this.chestParticles.emitRate = 0;
        this.chestParticles.gravity = new BABYLON.Vector3(0, 0.5, 0);
        this.chestParticles.direction1 = new BABYLON.Vector3(-0.2, 0.8, -0.2);
        this.chestParticles.direction2 = new BABYLON.Vector3(0.2, 1.2, 0.2);
        this.chestParticles.minEmitPower = 0.3;
        this.chestParticles.maxEmitPower = 0.9;
        this.chestParticles.start();
    }

    /**
     * Builds a weapon rack with cutlasses and flintlock pistols mounted on the deck
     */
    private _buildWeaponRack(): void {
        const rackRoot = new BABYLON.TransformNode("weaponRackRoot", this._scene);
        rackRoot.parent = this._shipRoot;
        rackRoot.position.set(0.95, 2.45, 2.2);
        rackRoot.rotation = new BABYLON.Vector3(0, -Math.PI / 2, 0);
        this.weaponRackRoot = rackRoot;

        const rackWoodMat = new BABYLON.PBRMaterial("rackWoodMat", this._scene);
        rackWoodMat.albedoColor = new BABYLON.Color3(0.30, 0.18, 0.10);
        rackWoodMat.roughness = 0.8;

        const steelMat = new BABYLON.PBRMaterial("steelMat", this._scene);
        steelMat.albedoColor = new BABYLON.Color3(0.85, 0.88, 0.92);
        steelMat.metallic = 0.95;
        steelMat.roughness = 0.2;

        const brassMat = new BABYLON.PBRMaterial("rackBrassMat", this._scene);
        brassMat.albedoColor = new BABYLON.Color3(0.9, 0.72, 0.25);
        brassMat.metallic = 0.9;
        brassMat.roughness = 0.3;

        // Rack Backboard
        const board = BABYLON.MeshBuilder.CreateBox("rackBoard", { width: 1.1, height: 0.8, depth: 0.08 }, this._scene);
        board.position.y = 0.5;
        board.material = rackWoodMat;
        board.parent = rackRoot;

        // Cutlass 1 (slanted on rack)
        const blade1 = BABYLON.MeshBuilder.CreateBox("blade1", { width: 0.05, height: 0.65, depth: 0.015 }, this._scene);
        blade1.position.set(-0.15, 0.5, 0.06);
        blade1.rotation.z = 0.25;
        blade1.material = steelMat;
        blade1.parent = rackRoot;

        const guard1 = BABYLON.MeshBuilder.CreateTorus("guard1", { diameter: 0.12, thickness: 0.02 }, this._scene);
        guard1.position.set(-0.22, 0.2, 0.06);
        guard1.material = brassMat;
        guard1.parent = rackRoot;

        // Cutlass 2 (crossed)
        const blade2 = BABYLON.MeshBuilder.CreateBox("blade2", { width: 0.05, height: 0.65, depth: 0.015 }, this._scene);
        blade2.position.set(0.15, 0.5, 0.07);
        blade2.rotation.z = -0.25;
        blade2.material = steelMat;
        blade2.parent = rackRoot;

        const guard2 = BABYLON.MeshBuilder.CreateTorus("guard2", { diameter: 0.12, thickness: 0.02 }, this._scene);
        guard2.position.set(0.22, 0.2, 0.07);
        guard2.material = brassMat;
        guard2.parent = rackRoot;

        // Flintlock Pistol
        const barrel = BABYLON.MeshBuilder.CreateCylinder("flintBarrel", { diameter: 0.03, height: 0.32 }, this._scene);
        barrel.rotation.z = Math.PI / 2;
        barrel.position.set(0, 0.72, 0.06);
        barrel.material = steelMat;
        barrel.parent = rackRoot;

        const handle = BABYLON.MeshBuilder.CreateBox("flintHandle", { width: 0.14, height: 0.05, depth: 0.04 }, this._scene);
        handle.rotation.z = 0.7;
        handle.position.set(-0.14, 0.68, 0.06);
        handle.material = rackWoodMat;
        handle.parent = rackRoot;
    }

    /**
     * Builds an in-hand first-person cutlass attached to the player camera
     */
    public createFirstPersonCutlass(camera: BABYLON.Camera): BABYLON.TransformNode {
        const cutlassRig = new BABYLON.TransformNode("fpCutlassRig", this._scene);
        cutlassRig.parent = camera;
        // Positioned in lower right corner of screen
        cutlassRig.position.set(0.38, -0.32, 0.75);
        cutlassRig.rotation.set(0.25, -0.35, 0.15);

        const steelMat = new BABYLON.PBRMaterial("fpBladeSteel", this._scene);
        steelMat.albedoColor = new BABYLON.Color3(0.92, 0.94, 0.98);
        steelMat.metallic = 0.98;
        steelMat.roughness = 0.18;

        const brassMat = new BABYLON.PBRMaterial("fpHiltBrass", this._scene);
        brassMat.albedoColor = new BABYLON.Color3(0.92, 0.75, 0.28);
        brassMat.metallic = 0.92;
        brassMat.roughness = 0.28;

        const leatherMat = new BABYLON.PBRMaterial("fpGripLeather", this._scene);
        leatherMat.albedoColor = new BABYLON.Color3(0.20, 0.12, 0.08);
        leatherMat.roughness = 0.85;

        // Curved steel blade
        const blade = BABYLON.MeshBuilder.CreateBox("fpBlade", { width: 0.045, height: 0.75, depth: 0.012 }, this._scene);
        blade.position.set(0, 0.42, 0);
        blade.material = steelMat;
        blade.parent = cutlassRig;

        // Blade tip angle
        const tip = BABYLON.MeshBuilder.CreateCylinder("fpBladeTip", { diameterTop: 0, diameterBottom: 0.045, height: 0.12, tessellation: 4 }, this._scene);
        tip.position.set(0, 0.84, 0);
        tip.material = steelMat;
        tip.parent = cutlassRig;

        // Brass basket guard
        const guard = BABYLON.MeshBuilder.CreateSphere("fpGuard", { diameterX: 0.16, diameterY: 0.09, diameterZ: 0.14, segments: 8 }, this._scene);
        guard.position.set(0, 0.06, 0);
        guard.material = brassMat;
        guard.parent = cutlassRig;

        // Leather grip
        const grip = BABYLON.MeshBuilder.CreateCylinder("fpGrip", { diameter: 0.032, height: 0.16 }, this._scene);
        grip.position.set(0, -0.04, 0);
        grip.material = leatherMat;
        grip.parent = cutlassRig;

        // Brass pommel
        const pommel = BABYLON.MeshBuilder.CreateSphere("fpPommel", { diameter: 0.06 }, this._scene);
        pommel.position.set(0, -0.13, 0);
        pommel.material = brassMat;
        pommel.parent = cutlassRig;

        cutlassRig.setEnabled(false); // Hidden until player equips it
        this.cutlassViewMesh = cutlassRig;
        return cutlassRig;
    }

    /**
     * Builds a damaged hull plank repair point on the main deck
     */
    private _buildRepairPoint(): void {
        const repairRoot = new BABYLON.TransformNode("repairPointRoot", this._scene);
        repairRoot.parent = this._shipRoot;
        repairRoot.position.set(-1.25, 1.56, -1.2);
        this.repairRootNode = repairRoot;

        const brokenWoodMat = new BABYLON.PBRMaterial("brokenWoodMat", this._scene);
        brokenWoodMat.albedoColor = new BABYLON.Color3(0.28, 0.16, 0.09);
        brokenWoodMat.roughness = 0.95;

        // Splintered loose plank
        const plank = BABYLON.MeshBuilder.CreateBox("brokenPlank", { width: 0.45, height: 0.08, depth: 1.1 }, this._scene);
        plank.rotation.set(0.08, 0.05, -0.06);
        plank.material = brokenWoodMat;
        plank.parent = repairRoot;
        this.repairMesh = plank;

        // Protruding bent nails
        const nailMat = new BABYLON.PBRMaterial("nailMat", this._scene);
        nailMat.albedoColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        nailMat.metallic = 0.9;

        const nail1 = BABYLON.MeshBuilder.CreateCylinder("nail1", { diameter: 0.02, height: 0.08 }, this._scene);
        nail1.position.set(-0.12, 0.06, -0.35);
        nail1.rotation.z = 0.3;
        nail1.material = nailMat;
        nail1.parent = repairRoot;
        this.repairNail1 = nail1;

        const nail2 = BABYLON.MeshBuilder.CreateCylinder("nail2", { diameter: 0.02, height: 0.09 }, this._scene);
        nail2.position.set(0.14, 0.07, 0.38);
        nail2.rotation.z = -0.25;
        nail2.material = nailMat;
        nail2.parent = repairRoot;
        this.repairNail2 = nail2;
    }

    /**
     * Builds a lookout marker on the ship's bow rail overlooking the ocean
     */
    private _buildShipEdgeMarker(): void {
        const edgeRoot = new BABYLON.TransformNode("shipEdgeRoot", this._scene);
        edgeRoot.parent = this._shipRoot;
        // Front bow rail lookout
        edgeRoot.position.set(0, 2.05, -3.85);
        this.shipEdgeRoot = edgeRoot;

        const brassMat = new BABYLON.PBRMaterial("edgeBrassMat", this._scene);
        brassMat.albedoColor = new BABYLON.Color3(0.88, 0.72, 0.28);
        brassMat.metallic = 0.92;
        brassMat.roughness = 0.3;

        // Polished brass compass rose on the bow railing
        const plate = BABYLON.MeshBuilder.CreateCylinder("compassPlate", { diameter: 0.35, height: 0.02 }, this._scene);
        plate.position.y = 0.01;
        plate.material = brassMat;
        plate.parent = edgeRoot;
        this.shipEdgePlateMesh = plate;

        const pointer = BABYLON.MeshBuilder.CreateCylinder("compassPointer", { diameterTop: 0, diameterBottom: 0.05, height: 0.28, tessellation: 3 }, this._scene);
        pointer.rotation.x = Math.PI / 2;
        pointer.position.set(0, 0.025, 0);
        pointer.material = brassMat;
        pointer.parent = edgeRoot;
    }

    /**
     * Prepares cannon smoke, fire flash, and water splash particle systems
     */
    private _setupCannonFX(): void {
        // Cannon fire burst system
        this._cannonFireSystem = new BABYLON.ParticleSystem("cannonFire", 100, this._scene);
        this._cannonFireSystem.particleTexture = new BABYLON.Texture("textures/flare.png", this._scene);
        this._cannonFireSystem.emitter = BABYLON.Vector3.Zero();
        this._cannonFireSystem.color1 = new BABYLON.Color4(1.0, 0.9, 0.3, 1.0);
        this._cannonFireSystem.color2 = new BABYLON.Color4(1.0, 0.3, 0.05, 0.9);
        this._cannonFireSystem.colorDead = new BABYLON.Color4(0.2, 0.05, 0.0, 0.0);
        this._cannonFireSystem.minSize = 0.4;
        this._cannonFireSystem.maxSize = 1.2;
        this._cannonFireSystem.minLifeTime = 0.15;
        this._cannonFireSystem.maxLifeTime = 0.35;
        this._cannonFireSystem.manualEmitCount = 0;
        this._cannonFireSystem.minEmitPower = 5;
        this._cannonFireSystem.maxEmitPower = 12;

        // Cannon smoke plume system
        this._cannonSmokeSystem = new BABYLON.ParticleSystem("cannonSmoke", 200, this._scene);
        this._cannonSmokeSystem.particleTexture = new BABYLON.Texture("textures/flare.png", this._scene);
        this._cannonSmokeSystem.emitter = BABYLON.Vector3.Zero();
        this._cannonSmokeSystem.color1 = new BABYLON.Color4(0.85, 0.85, 0.85, 0.8);
        this._cannonSmokeSystem.color2 = new BABYLON.Color4(0.5, 0.5, 0.55, 0.5);
        this._cannonSmokeSystem.colorDead = new BABYLON.Color4(0.3, 0.3, 0.3, 0.0);
        this._cannonSmokeSystem.minSize = 0.8;
        this._cannonSmokeSystem.maxSize = 2.8;
        this._cannonSmokeSystem.minLifeTime = 1.0;
        this._cannonSmokeSystem.maxLifeTime = 2.5;
        this._cannonSmokeSystem.gravity = new BABYLON.Vector3(0, 0.4, 0);
        this._cannonSmokeSystem.manualEmitCount = 0;
        this._cannonSmokeSystem.minEmitPower = 2;
        this._cannonSmokeSystem.maxEmitPower = 6;
    }

    /**
     * Executes cannon firing FX: recoil, flash light, fire & smoke burst, projectile arc, and ocean splash
     */
    public fireCannon(isStarboard: boolean, customDirection?: BABYLON.Vector3): void {
        // Cannon world position on deck
        const localPos = isStarboard ? new BABYLON.Vector3(1.6, 1.6, 0.5) : new BABYLON.Vector3(-1.6, 1.6, 0.5);
        const worldPos = BABYLON.Vector3.TransformCoordinates(localPos, this._shipRoot.getWorldMatrix());

        let fireDir: BABYLON.Vector3;
        if (customDirection) {
            fireDir = customDirection.clone().normalize();
        } else {
            const shipRight = this._shipRoot.right;
            fireDir = (isStarboard ? shipRight.scale(1) : shipRight.scale(-1)).add(new BABYLON.Vector3(0, 0.10, 0)).normalize();
        }

        // 1. Muzzle Flash Light
        const flashLight = new BABYLON.PointLight("cannonFlash", worldPos.clone(), this._scene);
        flashLight.diffuse = new BABYLON.Color3(1.0, 0.75, 0.25);
        flashLight.intensity = 35;
        flashLight.range = 25;

        let flashTimer = 0;
        const flashObserver = this._scene.onBeforeRenderObservable.add(() => {
            flashTimer += 0.016;
            flashLight.intensity *= 0.65;
            if (flashTimer > 0.18) {
                flashLight.dispose();
                this._scene.onBeforeRenderObservable.remove(flashObserver);
            }
        });

        // 2. Fire and Smoke Particles
        if (this._cannonFireSystem && this._cannonSmokeSystem) {
            this._cannonFireSystem.emitter = worldPos;
            this._cannonFireSystem.direction1 = fireDir.scale(0.8).add(new BABYLON.Vector3(-0.3, 0.2, -0.3));
            this._cannonFireSystem.direction2 = fireDir.scale(1.2).add(new BABYLON.Vector3(0.3, 0.4, 0.3));
            this._cannonFireSystem.manualEmitCount = 50;
            this._cannonFireSystem.start();

            this._cannonSmokeSystem.emitter = worldPos;
            this._cannonSmokeSystem.direction1 = fireDir.scale(0.5).add(new BABYLON.Vector3(-0.5, 0.5, -0.5));
            this._cannonSmokeSystem.direction2 = fireDir.scale(1.0).add(new BABYLON.Vector3(0.5, 0.8, 0.5));
            this._cannonSmokeSystem.manualEmitCount = 100;
            this._cannonSmokeSystem.start();
        }

        // 3. Cannonball Projectile flying into the ocean
        const ballMat = new BABYLON.PBRMaterial("cannonballMat", this._scene);
        ballMat.albedoColor = new BABYLON.Color3(0.08, 0.08, 0.1);
        ballMat.metallic = 0.95;
        ballMat.roughness = 0.25;

        const ball = BABYLON.MeshBuilder.CreateSphere("cannonball", { diameter: 0.24 }, this._scene);
        ball.position = worldPos.clone();
        ball.material = ballMat;

        let velocity = fireDir.scale(36);
        let alive = true;

        const ballObserver = this._scene.onBeforeRenderObservable.add(() => {
            if (!alive) return;
            const dt = 0.016;
            velocity.y -= 9.8 * dt;
            ball.position.addInPlace(velocity.scale(dt));

            // Impact with ocean surface (y <= 0)
            if (ball.position.y <= 0.1) {
                alive = false;
                this._scene.onBeforeRenderObservable.remove(ballObserver);
                this._createWaterSplash(ball.position.clone());
                ball.dispose();
            }
        });
    }

    /**
     * Creates a towering white water splash / spray on the ocean surface where the cannonball lands
     */
    private _createWaterSplash(pos: BABYLON.Vector3): void {
        const splash = new BABYLON.ParticleSystem("cannonSplash", 120, this._scene);
        splash.particleTexture = new BABYLON.Texture("textures/flare.png", this._scene);
        splash.emitter = pos;
        splash.color1 = new BABYLON.Color4(1.0, 1.0, 1.0, 0.9);
        splash.color2 = new BABYLON.Color4(0.8, 0.92, 1.0, 0.7);
        splash.colorDead = new BABYLON.Color4(0.7, 0.85, 0.95, 0.0);
        splash.minSize = 0.4;
        splash.maxSize = 1.4;
        splash.minLifeTime = 0.8;
        splash.maxLifeTime = 1.6;
        splash.gravity = new BABYLON.Vector3(0, -9.8, 0);
        splash.direction1 = new BABYLON.Vector3(-1.2, 5, -1.2);
        splash.direction2 = new BABYLON.Vector3(1.2, 8, 1.2);
        splash.minEmitPower = 2;
        splash.maxEmitPower = 5;
        splash.manualEmitCount = 90;
        splash.disposeOnStop = true;
        splash.start();
    }

    /**
     * Animates opening/closing the treasure chest
     */
    public toggleTreasureChest(): boolean {
        if (!this.chestLidNode || !this.chestGlowLight || !this.chestParticles) return false;

        this.isChestOpen = !this.isChestOpen;
        const targetRotX = this.isChestOpen ? -1.65 : 0;
        const startRotX = this.chestLidNode.rotation.x;
        const targetIntensity = this.isChestOpen ? 4.5 : 0;
        const startIntensity = this.chestGlowLight.intensity;

        if (this.isChestOpen) {
            this.chestParticles.emitRate = 45;
        } else {
            this.chestParticles.emitRate = 0;
        }

        let progress = 0;
        const animObserver = this._scene.onBeforeRenderObservable.add(() => {
            progress += 0.045;
            const t = Math.min(1, progress);
            // Smooth ease out cubic
            const ease = 1 - Math.pow(1 - t, 3);

            this.chestLidNode!.rotation.x = BABYLON.Scalar.Lerp(startRotX, targetRotX, ease);
            this.chestGlowLight!.intensity = BABYLON.Scalar.Lerp(startIntensity, targetIntensity, ease);

            if (t >= 1) {
                this._scene.onBeforeRenderObservable.remove(animObserver);
            }
        });

        return this.isChestOpen;
    }

    /**
     * Advances repair on the broken hull plank with hammer strike FX
     */
    public hammerRepairPlank(): { progress: number; isFinished: boolean } {
        if (!this.repairMesh) return { progress: 1.0, isFinished: true };

        // Woodchips and sparks particle puff
        const puff = new BABYLON.ParticleSystem("repairSparks", 60, this._scene);
        puff.particleTexture = new BABYLON.Texture("textures/flare.png", this._scene);
        puff.emitter = this.repairMesh.getAbsolutePosition();
        puff.color1 = new BABYLON.Color4(1.0, 0.8, 0.3, 1.0);
        puff.color2 = new BABYLON.Color4(0.6, 0.35, 0.15, 0.8);
        puff.colorDead = new BABYLON.Color4(0.3, 0.2, 0.1, 0.0);
        puff.minSize = 0.03;
        puff.maxSize = 0.09;
        puff.minLifeTime = 0.3;
        puff.maxLifeTime = 0.7;
        puff.gravity = new BABYLON.Vector3(0, -6, 0);
        puff.manualEmitCount = 50;
        puff.disposeOnStop = true;
        puff.start();

        this.repairProgress = Math.min(1.0, this.repairProgress + 0.15);

        // Progressively align plank and sink nails
        const t = (this.repairProgress - 0.6) / 0.4;
        this.repairMesh.rotation.set(0.08 * (1 - t), 0.05 * (1 - t), -0.06 * (1 - t));

        if (this.repairNail1) {
            this.repairNail1.position.y = 0.06 - t * 0.04;
            this.repairNail1.rotation.z = 0.3 * (1 - t);
        }
        if (this.repairNail2) {
            this.repairNail2.position.y = 0.07 - t * 0.04;
            this.repairNail2.rotation.z = -0.25 * (1 - t);
        }

        if (this.repairProgress >= 1.0) {
            this.isRepaired = true;
            this.repairMesh.rotation.set(0, 0, 0);
            const fixedMat = new BABYLON.PBRMaterial("fixedPlankMat", this._scene);
            fixedMat.albedoColor = new BABYLON.Color3(0.48, 0.32, 0.18);
            fixedMat.roughness = 0.65;
            this.repairMesh.material = fixedMat;
            return { progress: 1.0, isFinished: true };
        }

        return { progress: this.repairProgress, isFinished: false };
    }

    public repairHullPlank(): void {
        this.hammerRepairPlank();
    }

    /**
     * Equips cutlass in first person view
     */
    public equipCutlass(): void {
        if (!this.cutlassViewMesh) return;
        this.isCutlassEquipped = true;
        this.cutlassViewMesh.setEnabled(true);
    }

    /**
     * Performs a dynamic first-person cutlass slash attack flourish
     */
    public swingCutlass(): void {
        if (!this.cutlassViewMesh || this.isSwinging || !this.isCutlassEquipped) return;
        this.isSwinging = true;

        const startPos = new BABYLON.Vector3(0.38, -0.32, 0.75);
        const startRot = new BABYLON.Vector3(0.25, -0.35, 0.15);

        let t = 0;
        const slashObserver = this._scene.onBeforeRenderObservable.add(() => {
            t += 0.06;
            if (t <= 0.4) {
                // Wind up
                const p = t / 0.4;
                this.cutlassViewMesh!.position.set(0.42 + p * 0.1, -0.28 + p * 0.12, 0.70 - p * 0.08);
                this.cutlassViewMesh!.rotation.set(0.4 + p * 0.3, -0.5 - p * 0.3, 0.3);
            } else if (t <= 0.75) {
                // Downward forward slash
                const p = (t - 0.4) / 0.35;
                this.cutlassViewMesh!.position.set(0.52 - p * 0.35, -0.16 - p * 0.35, 0.62 + p * 0.25);
                this.cutlassViewMesh!.rotation.set(0.7 - p * 1.1, -0.8 + p * 0.9, 0.3 - p * 0.8);
            } else if (t <= 1.0) {
                // Recover to idle
                const p = (t - 0.75) / 0.25;
                BABYLON.Vector3.LerpToRef(this.cutlassViewMesh!.position, startPos, p, this.cutlassViewMesh!.position);
                BABYLON.Vector3.LerpToRef(this.cutlassViewMesh!.rotation, startRot, p, this.cutlassViewMesh!.rotation);
            } else {
                this.cutlassViewMesh!.position.copyFrom(startPos);
                this.cutlassViewMesh!.rotation.copyFrom(startRot);
                this.isSwinging = false;
                this._scene.onBeforeRenderObservable.remove(slashObserver);
            }
        });
    }

    /**
     * Dynamically adjusts sail height scale
     */
    public setSailHeight(multiplier: number): void {
        if (!this.sailsMesh || !this.baseSailScaling) return;
        this.sailsMesh.scaling.z = this.baseSailScaling.z * multiplier;
        this.sailsMesh.scaling.y = this.baseSailScaling.y * (1 + (multiplier - 1) * 0.4);
        if (this.tiesMesh && this.baseTiesScaling) {
            this.tiesMesh.scaling.z = this.baseTiesScaling.z * multiplier;
        }
    }

    /**
     * Dynamically adjusts vertical sail elevation up the mast
     */
    public setSailElevation(offset: number): void {
        if (!this.sailsMesh || !this.baseSailPosition) return;
        this.sailsMesh.position.y = this.baseSailPosition.y + offset;
        if (this.tiesMesh && this.baseTiesPosition) {
            this.tiesMesh.position.y = this.baseTiesPosition.y + offset;
        }
    }

    /**
     * Toggles sail trim / billow
     */
    public toggleSails(): boolean {
        this.isSailsTrimmed = !this.isSailsTrimmed;
        this.windWaveIntensity = this.isSailsTrimmed ? 0.16 : 0.10;
        if (this.sailsMesh && this.baseSailScaling) {
            const billow = this.isSailsTrimmed ? 1.15 : 1.0;
            const targetScaleY = this.baseSailScaling.y * billow;
            const startScaleY = this.sailsMesh.scaling.y;
            let p = 0;
            const sailObserver = this._scene.onBeforeRenderObservable.add(() => {
                p += 0.05;
                const ease = Math.min(1, p);
                this.sailsMesh!.scaling.y = BABYLON.Scalar.Lerp(startScaleY, targetScaleY, ease);
                if (ease >= 1) {
                    this._scene.onBeforeRenderObservable.remove(sailObserver);
                }
            });
        }
        return this.isSailsTrimmed;
    }

    private _windThrottleTimer = 0;

    /**
     * Updates dynamic wind wave air ripples across the sail canvas (throttled for peak FPS)
     */
    private _updateSailWindWave(): void {
        if (!this.windWaveEnabled || !this.sailsMesh || !this._baseSailPositions || !this._animatedSailPositions) return;

        const engine = this._scene.getEngine();
        const dt = Math.min(0.04, engine.getDeltaTime() / 1000 || 0.016);
        this._windThrottleTimer += dt;
        if (this._windThrottleTimer < 0.024) return; // ~40 FPS cloth ripple
        this._windTime += this._windThrottleTimer * this.windWaveSpeed;
        this._windThrottleTimer = 0;

        const t = this._windTime;
        const amp = this.windWaveIntensity;

        const base = this._baseSailPositions;
        const anim = this._animatedSailPositions;
        const len = base.length;

        for (let i = 0; i < len; i += 3) {
            const x = base[i];
            const y = base[i + 1];
            const z = base[i + 2];

            // Harmonic wind ripples across fabric:
            const wave = Math.sin(x * 2.6 + t * 1.8 + z * 1.4) * Math.cos(z * 1.6 + t * 1.2) * amp
                       + Math.sin(x * 5.2 + t * 3.4) * (amp * 0.35)
                       + Math.sin(t * 0.9) * (amp * 0.45);

            anim[i] = x;
            anim[i + 1] = y + wave;
            anim[i + 2] = z;
        }

        this.sailsMesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, anim, false, false);
    }

    /**
     * Steers the ship helm wheel smoothly with physical rotation
     */
    public rotateHelm(deltaAngle: number): void {
        this.helmAngle += deltaAngle;
        if (this.helmWheelMesh) {
            if (!this.baseWheelQuaternion && this.helmWheelMesh.rotationQuaternion) {
                this.baseWheelQuaternion = this.helmWheelMesh.rotationQuaternion.clone();
            }
            if (this.baseWheelQuaternion && this.helmWheelMesh.rotationQuaternion) {
                const spinQuat = BABYLON.Quaternion.FromEulerAngles(0, this.helmAngle, 0);
                this.baseWheelQuaternion.multiplyToRef(spinQuat, this.helmWheelMesh.rotationQuaternion);
            }
        }
    }

    /**
     * Adjusts sail canvas trim (0.2 = furled to 1.0 = full billow)
     */
    public setSailTrim(trim01: number): void {
        this.sailTrim = BABYLON.Scalar.Clamp(trim01, 0.2, 1.0);
        this.setSailHeight(0.9 + this.sailTrim * 0.4);
        this.windWaveSpeed = 1.5 + this.sailTrim * 2.2;
        this.windWaveIntensity = 0.06 + this.sailTrim * 0.12;
    }

    /**
     * Gathers all meshes associated with an interactive object for 3D highlighting
     */
    public getHighlightMeshesForObject(objectId: string): BABYLON.Mesh[] {
        const meshes: BABYLON.Mesh[] = [];

        const collectMeshes = (node: BABYLON.Nullable<BABYLON.Node>) => {
            if (!node) return;
            if (node instanceof BABYLON.Mesh) {
                meshes.push(node);
            }
            const children = node.getChildren((child) => child instanceof BABYLON.Mesh, false) as BABYLON.Mesh[];
            meshes.push(...children);
        };

        switch (objectId) {
            case 'helm':
                collectMeshes(this.helmWheelMesh);
                break;
            case 'starboard_cannon':
            case 'port_cannon':
                collectMeshes(this.starboardCannonMesh || this.portCannonMesh);
                break;
            case 'sails':
                if (this.sailsMesh) meshes.push(this.sailsMesh);
                if (this.tiesMesh) meshes.push(this.tiesMesh);
                break;
            case 'repair_point':
                if (this.repairMesh) meshes.push(this.repairMesh);
                if (this.repairNail1) meshes.push(this.repairNail1);
                if (this.repairNail2) meshes.push(this.repairNail2);
                break;
            case 'weapon_rack':
                collectMeshes(this.weaponRackRoot);
                break;
            case 'treasure_chest':
                if (this.chestBaseMesh) meshes.push(this.chestBaseMesh);
                if (this.chestLidMesh) meshes.push(this.chestLidMesh);
                break;
            case 'ship_edge':
                if (this.shipEdgePlateMesh) meshes.push(this.shipEdgePlateMesh);
                break;
        }

        return meshes;
    }
}
