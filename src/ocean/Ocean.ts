import { RTTDebug } from '../utils/RTTDebug';
import { Buoyancy } from './Buoyancy';
import { WavesSettings } from '../waves/WavesSettings';
import { WavesGenerator } from '../waves/WavesGenerator';
import { SkyBox } from './SkyBox';
import { OceanMaterial } from './OceanMaterial';
import { OceanGeometry } from './OceanGeometry';
import { OceanGUI } from './OceanGUI';
import { ShipDeckPlayer } from '../player/ShipDeckPlayer';

const showBuoy = false;
const showFisherBoat = false;
const showBabylonBuoy = true;
const showPirateShip = true;

export class Ocean {
    private _engine: BABYLON.Engine;
    private _scene: BABYLON.Scene;
    private _camera: BABYLON.FreeCamera;
    private _rttDebug: RTTDebug;
    private _light: BABYLON.DirectionalLight;
    private _depthRenderer: BABYLON.DepthRenderer;
    private _buoyancy: Buoyancy;
    private _wavesSettings: WavesSettings;
    private _fxaa: BABYLON.Nullable<BABYLON.FxaaPostProcess>;
    private _size: number;
    private _gui: OceanGUI | null;
    private _skybox: SkyBox;
    private _oceanMaterial: OceanMaterial;
    private _oceanGeometry: OceanGeometry;
    private _wavesGenerator: BABYLON.Nullable<WavesGenerator>;
    private _useZQSD: boolean;
    private _useProceduralSky: boolean;
    private _lightDirection: BABYLON.Vector3;
    private _shadowGenerator: BABYLON.ShadowGenerator;
    private _lightBuoy: BABYLON.PointLight;
    private _shadowGeneratorBuoy: BABYLON.ShadowGenerator;
    private _glowLayer: BABYLON.GlowLayer;
    private _forceUpdateGlowIntensity: boolean;
    private _canvas: HTMLCanvasElement = null as any;
    private _player: ShipDeckPlayer | null = null;
    private _sailHeight = 1;
    private _sailElevation = 2.5;
    private _windWaveSpeed = 2.6;
    private _windWaveIntensity = 0.12;

    public get player(): ShipDeckPlayer | null {
        return this._player;
    }

    constructor() {
        this._engine = null as any;
        this._scene = null as any;
        this._camera = null as any;
        this._rttDebug = null as any;
        this._light = null as any;
        this._depthRenderer = null as any;
        this._buoyancy = null as any;
        this._fxaa = null;
        this._gui = null as any;
        this._skybox = null as any;
        this._oceanMaterial = null as any;
        this._oceanGeometry = null as any;
        this._wavesGenerator = null;
        this._useZQSD = true;
        this._useProceduralSky = true;
        this._lightDirection = new BABYLON.Vector3(0, -1, -0.25);
        this._shadowGenerator = null as any;
        this._lightBuoy = null as any;
        this._shadowGeneratorBuoy = null as any;
        this._glowLayer = null as any;
        this._forceUpdateGlowIntensity = true;

        this._size = 256;
        this._wavesSettings = new WavesSettings();
    }

    public async createScene(
        engine: BABYLON.Engine,
        canvas: HTMLCanvasElement
    ): Promise<BABYLON.Scene> {
        if (typeof BABYLON !== "undefined" && BABYLON.SceneLoader) {
            BABYLON.SceneLoader.ShowLoadingScreen = false;
        }
        engine.hideLoadingUI();
        (window as any).convf = function(l: number): number {
            const a = new Uint8Array([l & 0xff, (l & 0xff00) >> 8, (l & 0xff0000) >> 16, (l & 0xff000000) >> 24]);
            return new Float32Array(a.buffer)[0];
        };
        (window as any).numbg = function(): void {
            console.log("NumBindGroupsCreatedTotal=", (BABYLON as any).WebGPUCacheBindGroups?.NumBindGroupsCreatedTotal, " - NumBindGroupsCreatedLastFrame=", (BABYLON as any).WebGPUCacheBindGroups?.NumBindGroupsCreatedLastFrame);
        };

        const scene = new BABYLON.Scene(engine);

        // Particle system
        const particleSystem = new BABYLON.ParticleSystem("particles", 2000, scene);
        particleSystem.particleTexture = new BABYLON.Texture("textures/flare.png", scene);
        particleSystem.addColorGradient(0, new BABYLON.Color4(1, 0, 0, 1), new BABYLON.Color4(1, 0, 1, 1));
        particleSystem.addColorGradient(1, new BABYLON.Color4(0, 1, 0, 1), new BABYLON.Color4(1, 1, 0, 1));
        particleSystem.emitter = new BABYLON.Vector3(0, 3, 0);
        particleSystem.minEmitBox = new BABYLON.Vector3(-3, 0, -3);
        particleSystem.maxEmitBox = new BABYLON.Vector3(3, 0, 3);
        particleSystem.start();

        scene.useRightHandedSystem = true;

        this._engine = engine;
        this._scene = scene;
        this._canvas = canvas;

        this._camera = new BABYLON.FreeCamera("mainCamera", new BABYLON.Vector3(-17.3, 5, -9), scene);
        this._camera.rotation.set(0.21402315044176745, 1.5974857677541419, 0);
        this._camera.minZ = 0.05;
        this._camera.maxZ = 500000;

        if (!this._checkSupport()) {
            return scene;
        }

        this._setCameraKeys();

        this._rttDebug = new RTTDebug(scene, engine, 32);
        this._rttDebug.show(false);

        scene.environmentIntensity = 1.35;

        scene.activeCameras = [this._camera, this._rttDebug.camera];

        this._camera.attachControl(canvas, true);

        const cameraUpdate = this._camera.update.bind(this._camera);
        this._camera.update = function() {
            cameraUpdate();
            if (!this.parent && this.position.y < 1.5) {
                this.position.y = 1.5;
            }
        };

        this._depthRenderer = this._scene.enableDepthRenderer(this._camera, false);
        this._depthRenderer.getDepthMap().renderList = [];

        this._light = new BABYLON.DirectionalLight("light", this._lightDirection, scene);
        this._light.intensity = 5;
        this._light.diffuse = new BABYLON.Color3(1, 1, 1);
        this._light.shadowMinZ = 0;
        this._light.shadowMaxZ = 40;
        this._light.shadowOrthoScale = 0.5;

        this._shadowGenerator = new BABYLON.ShadowGenerator(4096, this._light);
        this._shadowGenerator.usePercentageCloserFiltering = true;
        this._shadowGenerator.bias = 0.005;

        this._skybox = new SkyBox(this._useProceduralSky, scene);
        this._buoyancy = new Buoyancy(this._size, 3, 0.2);
        this._oceanMaterial = new OceanMaterial(this._depthRenderer, this._scene);
        this._oceanGeometry = new OceanGeometry(this._oceanMaterial, this._camera, this._scene);

        this._fxaa = new BABYLON.FxaaPostProcess("fxaa", 1, this._camera);

        await this._loadMeshes();

        this._createGlowLayer();

        await this._updateSize(256);
        this._oceanGeometry.initializeMeshes();

        this._gui = null;
        this._loadSavedOceanSettings();

        this._scene.onKeyboardObservable.add((kbInfo: any) => {
            switch (kbInfo.type) {
                case BABYLON.KeyboardEventTypes.KEYDOWN:
                    if (kbInfo.event.key === "Shift") {
                        this._camera.speed = 10;
                    }
                    break;
                case BABYLON.KeyboardEventTypes.KEYUP:
                    if (kbInfo.event.key === "Shift") {
                        this._camera.speed = 2;
                    }
                    break;
            }
        });

        scene.onBeforeRenderObservable.add(() => {
            if (this._skybox.update(this._light) || this._forceUpdateGlowIntensity) {
                if (this._glowLayer) {
                    const minIntensity = 0.6;
                    const maxIntensity = 3;
                    const sunPos = this._light.position.clone().normalize();
                    const sunProj = sunPos.clone().normalize();

                    sunProj.y = 0;

                    const dot = BABYLON.Vector3.Dot(sunPos, sunProj);
                    const intensity = BABYLON.Scalar.Lerp(minIntensity, maxIntensity, BABYLON.Scalar.Clamp(dot, 0, 1));

                    this._glowLayer.intensity = sunPos.y < 0 ? maxIntensity : intensity;
                    this._forceUpdateGlowIntensity = false;
                }
                this._light.position = this._light.position.clone().normalize().scaleInPlace(30);
            }
            this._oceanMaterial.setHorizonColor(this._skybox.getHorizonColor());
            this._oceanGeometry.update();
            this._wavesGenerator!.update();
            this._buoyancy.setWaterHeightMap(this._wavesGenerator!.waterHeightMap, this._wavesGenerator!.waterHeightMapScale);
            this._buoyancy.update();
            if (this._player) {
                this._player.update();
            }
        });

        return new Promise((resolve) => {
            scene.executeWhenReady(() => resolve(scene));
        });
    }

    private _setCameraKeys(): void {
        const kbInputs = this._camera.inputs.attached.keyboard as BABYLON.FreeCameraKeyboardMoveInput;
        if (this._useZQSD) {
            kbInputs.keysDown = [40, 83];
            kbInputs.keysLeft = [37, 81];
            kbInputs.keysRight = [39, 68];
            kbInputs.keysUp = [38, 90];
        } else {
            kbInputs.keysDown = [40, 83];
            kbInputs.keysLeft = [37, 65];
            kbInputs.keysRight = [39, 68];
            kbInputs.keysUp = [38, 87];
        }
        kbInputs.keysDownward = [34, 32];
        kbInputs.keysUpward = [33, 69];
    }

    private _checkSupport(): boolean {
        if (this._engine.getCaps().supportComputeShaders) {
            return true;
        }

        const panel = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");
        const textNOk = "**Use WebGPU to watch this demo which requires compute shaders support. To enable WebGPU please use Chrome or Edge with WebGPU enabled. Also select the WebGPU engine from the top right drop down menu.**";

        const info = new BABYLON.GUI.TextBlock();
        info.text = textNOk;
        info.width = "100%";
        info.paddingLeft = "5px";
        info.paddingRight = "5px";
        info.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        info.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        info.color = "red";
        info.fontSize = "24px";
        info.fontStyle = "bold";
        info.textWrapping = true;
        panel.addControl(info);

        return false;
    }

    private async _loadMeshes() {
        if (showBuoy) {
            await BABYLON.SceneLoader.AppendAsync("", "https://popov72.github.io/BabylonDev/resources/webgpu/oceanDemo/e388a5748796486181fbb8cb94bd0a66.glb", this._scene, undefined, ".glb");

            const buoyMesh = this._scene.getMeshByName("pTorus5_lambert1_0")!;
            buoyMesh.scaling.setAll(0.1);
            buoyMesh.position.y = -0.3;
            buoyMesh.position.z = -15;
            buoyMesh.receiveShadows = true;

            this._depthRenderer.getDepthMap().renderList!.push(buoyMesh);
            this._buoyancy.addMesh(buoyMesh, { v1: new BABYLON.Vector3(0, 5, -6), v2: new BABYLON.Vector3(0, 5, 6), v3: new BABYLON.Vector3(5, 5, -6) }, -0.3, 1);
            this._shadowGenerator.addShadowCaster(buoyMesh);
        }

        if (showFisherBoat) {
            await BABYLON.SceneLoader.AppendAsync("", "https://popov72.github.io/BabylonDev/resources/webgpu/oceanDemo/1f306a6325b8c6d21b8125e742b24167.glb", this._scene, undefined, ".glb");

            const fisherBoat = this._scene.getTransformNodeByName("Cube.022")!;
            fisherBoat.scaling.setAll(3);
            fisherBoat.position.x = -5;
            fisherBoat.position.y = 1.5;
            fisherBoat.position.z = -10;

            this._depthRenderer.getDepthMap().renderList!.push(...fisherBoat.getChildMeshes(false));
            this._buoyancy.addMesh(fisherBoat, { v1: new BABYLON.Vector3(0, 2, 0), v2: new BABYLON.Vector3(0, -1.2, 0), v3: new BABYLON.Vector3(0.4, 2, 0) }, 1.5, 0);
            fisherBoat.getChildMeshes(false).forEach((m) => {
                m.receiveShadows = true;
                this._shadowGenerator.addShadowCaster(m);
            });
        }

        if (showBabylonBuoy) {
            await BABYLON.SceneLoader.AppendAsync("", "https://assets.babylonjs.com/meshes/babylonBuoy.glb", this._scene, undefined, ".glb");

            const babylonBuoyMeshes = [this._scene.getMeshByName("buoyMesh_low") as BABYLON.Mesh];
            const babylonBuoyRoot = babylonBuoyMeshes[0].parent as BABYLON.TransformNode;
            const scale = 14;

            babylonBuoyRoot.position.set(-6, 0, -8);
            babylonBuoyRoot.scaling.setAll(scale);

            babylonBuoyMeshes.forEach((mesh) => {
                mesh.material!.backFaceCulling = false;
                this._shadowGenerator.addShadowCaster(mesh);
                mesh.receiveShadows = true;
                this._depthRenderer.getDepthMap().renderList!.push(mesh);
            });

            babylonBuoyRoot.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, Math.PI / 3, 0);
            this._buoyancy.addMesh(babylonBuoyRoot, { v1: new BABYLON.Vector3(0.7 / scale, 1 / scale, -1.5 / scale), v2: new BABYLON.Vector3(0.7 / scale, 1 / scale, 1.5 / scale), v3: new BABYLON.Vector3(-1.5 / scale, 1 / scale, -1.5 / scale) }, 0.0, 2);

            const slight = BABYLON.MeshBuilder.CreateSphere("slight", { segments: 6, diameter: 0.5 / scale }, this._scene);
            slight.position.set(-0.6 / scale, 6.58 / scale, 0.3 / scale);
            slight.visibility = 0;
            slight.parent = babylonBuoyRoot;

            this._lightBuoy = new BABYLON.PointLight("point", new BABYLON.Vector3(0, 0, 0), this._scene);
            this._lightBuoy.intensity = 30;
            this._lightBuoy.diffuse = new BABYLON.Color3(0.96, 0.70, 0.15).toLinearSpace();
            this._lightBuoy.shadowMinZ = 0.01;
            this._lightBuoy.shadowMaxZ = 15;
            this._lightBuoy.parent = slight;

            this._shadowGeneratorBuoy = new BABYLON.ShadowGenerator(2048, this._lightBuoy);
            this._shadowGeneratorBuoy.usePoissonSampling = true;
            this._shadowGeneratorBuoy.addShadowCaster(babylonBuoyMeshes[0]);
            this._shadowGeneratorBuoy.bias = 0.01;
        }

        if (showPirateShip) {
            const shipResult = await BABYLON.SceneLoader.ImportMeshAsync("", "models/", "pirate_ship.glb", this._scene);
            const shipRoot = shipResult.meshes[0];

            shipRoot.name = "pirateShipRoot";
            const scale = 1.0;
            shipRoot.scaling.setAll(scale);
            shipRoot.position.set(2.5, 0, -14);
            shipRoot.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, Math.PI / 4, 0);

            // Realistic ship textures from Downloads
            const woodPlanksTex = new BABYLON.Texture("textures/ship/wooden_planks.jpg", this._scene);
            woodPlanksTex.uScale = 4;
            woodPlanksTex.vScale = 4;

            const woodGrainTex = new BABYLON.Texture("textures/ship/wood_texture.jpg", this._scene);
            woodGrainTex.uScale = 2;
            woodGrainTex.vScale = 4;

            const darkWoodTex = new BABYLON.Texture("textures/ship/1-free-wood-plank-texture.jpg", this._scene);

            // Configure each material with authentic pirate ship PBR colors and textures
            shipResult.meshes.forEach((mesh) => {
                const mat = mesh.material as BABYLON.PBRMaterial;
                if (mat) {
                    mat.backFaceCulling = false;
                    mat.twoSidedLighting = true;
                    mat.environmentIntensity = 1.2;

                    const matName = mat.name.toLowerCase();
                    const meshName = mesh.name.toLowerCase();

                    if (matName.includes("boat planks") || meshName.includes("body")) {
                        // Weathered oak hull
                        mat.albedoColor = new BABYLON.Color3(0.50, 0.32, 0.18);
                        mat.albedoTexture = woodPlanksTex;
                        mat.roughness = 0.75;
                        mat.metallic = 0.02;
                    } else if (matName.includes("mast") || meshName.includes("mast")) {
                        // Cedar/pine mast wood
                        mat.albedoColor = new BABYLON.Color3(0.58, 0.38, 0.22);
                        mat.albedoTexture = woodGrainTex;
                        mat.roughness = 0.70;
                        mat.metallic = 0.0;
                    } else if (matName.includes("sail") || meshName.includes("sail")) {
                        // Vintage cream canvas sails
                        mat.albedoColor = new BABYLON.Color3(0.92, 0.88, 0.80);
                        mat.roughness = 0.60;
                        mat.metallic = 0.0;
                    } else if (matName.includes("rope") || meshName.includes("rope") || meshName.includes("tie")) {
                        // Natural hemp rope
                        mat.albedoColor = new BABYLON.Color3(0.70, 0.60, 0.45);
                        mat.roughness = 0.90;
                        mat.metallic = 0.0;
                    } else if (matName.includes("cannon") || meshName.includes("cannon")) {
                        // Cast iron cannons
                        mat.albedoColor = new BABYLON.Color3(0.12, 0.12, 0.15);
                        mat.roughness = 0.35;
                        mat.metallic = 0.88;
                    } else if (matName.includes("metal") || meshName.includes("metal")) {
                        // Wrought iron fittings
                        mat.albedoColor = new BABYLON.Color3(0.18, 0.18, 0.20);
                        mat.roughness = 0.40;
                        mat.metallic = 0.85;
                    } else if (matName.includes("railing") || matName.includes("wheel") || meshName.includes("railing") || meshName.includes("wheel")) {
                        // Polished mahogany railings
                        mat.albedoColor = new BABYLON.Color3(0.42, 0.24, 0.14);
                        mat.albedoTexture = woodGrainTex;
                        mat.roughness = 0.55;
                        mat.metallic = 0.04;
                    } else if (matName.includes("trim") || meshName.includes("trim")) {
                        // Dark walnut trim accent
                        mat.albedoColor = new BABYLON.Color3(0.32, 0.18, 0.10);
                        mat.albedoTexture = darkWoodTex;
                        mat.roughness = 0.65;
                        mat.metallic = 0.05;
                    } else if (matName.includes("stair") || meshName.includes("stair")) {
                        mat.albedoColor = new BABYLON.Color3(0.45, 0.28, 0.16);
                        mat.albedoTexture = woodGrainTex;
                        mat.roughness = 0.75;
                    } else if (matName.includes("crows nest") || meshName.includes("crows nest")) {
                        mat.albedoColor = new BABYLON.Color3(0.38, 0.24, 0.14);
                        mat.albedoTexture = woodGrainTex;
                        mat.roughness = 0.78;
                    } else if (matName.includes("window") || meshName.includes("window")) {
                        mat.albedoColor = new BABYLON.Color3(0.08, 0.12, 0.18);
                        mat.roughness = 0.10;
                        mat.metallic = 0.60;
                    } else if (meshName.includes("flag") || matName.includes("material")) {
                        // Pirate black flag
                        mat.albedoColor = new BABYLON.Color3(0.10, 0.10, 0.12);
                        mat.roughness = 0.70;
                    } else {
                        // General ship wood fallback
                        mat.albedoColor = new BABYLON.Color3(0.48, 0.30, 0.18);
                        mat.albedoTexture = woodGrainTex;
                        mat.roughness = 0.75;
                    }
                }

                this._shadowGenerator.addShadowCaster(mesh);
                mesh.receiveShadows = true;
                this._depthRenderer.getDepthMap().renderList!.push(mesh);
            });

            this._buoyancy.addMesh(
                shipRoot,
                {
                    v1: new BABYLON.Vector3(0, 0, 0),
                    v2: new BABYLON.Vector3(0, 0, 5 / scale),
                    v3: new BABYLON.Vector3(2.5 / scale, 0, 0),
                },
                -0.45,
                2
            );

            // Initialize First-Person Player on the Pirate Ship Deck
            this._player = new ShipDeckPlayer(this._scene, this._engine, this._canvas, shipRoot, this._camera, this._buoyancy);
            this._player.props.setSailHeight(this._sailHeight);
            this._player.props.setSailElevation(this._sailElevation);
            this._player.props.windWaveSpeed = this._windWaveSpeed;
            this._player.props.windWaveIntensity = this._windWaveIntensity;
        }
    }

    private _createGlowLayer(): void {
        this._glowLayer = new BABYLON.GlowLayer("glow", this._scene);

        const glassCovers = this._scene.getMeshByName("glassCovers_low") as BABYLON.Mesh;
        if (glassCovers) {
            this._glowLayer.addIncludedOnlyMesh(glassCovers);
        }

        this._glowLayer.customEmissiveColorSelector = (_mesh, _subMesh, _material, result) => {
            if (this._lightBuoy) {
                result.set(this._lightBuoy.diffuse.r, this._lightBuoy.diffuse.g, this._lightBuoy.diffuse.b, 1);
            }
        };

        this._forceUpdateGlowIntensity = true;
    }

    private async _updateSize(size: number) {
        this._size = size;
        this._buoyancy.size = size;

        const noise = await (await fetch("https://assets.babylonjs.com/environments/noise.exr")).arrayBuffer();

        this._wavesGenerator?.dispose();
        this._wavesGenerator = new WavesGenerator(this._size, this._wavesSettings, this._scene, this._rttDebug, noise);

        await this._wavesGenerator.initAsync();

        this._oceanMaterial.setWavesGenerator(this._wavesGenerator);
        await this._oceanGeometry.initializeMaterials();
    }

    private _readValue(obj: any, name: string): any {
        const parts: string[] = name.split("_");
        for (let i = 0; i < parts.length; ++i) {
            obj = obj[parts[i]];
        }
        return obj;
    }

    private _setValue(obj: any, name: string, value: any): void {
        const parts: string[] = name.split("_");
        for (let i = 0; i < parts.length - 1; ++i) {
            obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
    }

    public _parameterRead(name: string): any {
        switch (name) {
            case "size":
                return this._size;
            case "showDebugRTT":
                return this._rttDebug.isVisible;
            case "envIntensity":
                return this._scene.environmentIntensity;
            case "lightIntensity":
                return this._light.intensity;
            case "proceduralSky":
                return this._useProceduralSky;
            case "enableShadows":
                return this._light.shadowEnabled;
            case "enableFXAA":
                return this._fxaa !== null;
            case "enableGlow":
                return this._glowLayer !== null;
            case "useZQSD":
                return this._useZQSD;
            case "buoy_enabled":
                return this._buoyancy.enabled;
            case "buoy_attenuation":
                return this._buoyancy.attenuation;
            case "buoy_numSteps":
                return this._buoyancy.numSteps;
            case "skybox_lightColor":
                return this._light.diffuse.toHexString();
            case "skybox_directionX":
                return this._lightDirection.x;
            case "skybox_directionY":
                return this._lightDirection.y;
            case "skybox_directionZ":
                return this._lightDirection.z;
            case "ship_sailHeight":
                return this._sailHeight;
            case "ship_sailElevation":
                return this._sailElevation;
            case "ship_windWaveSpeed":
                return this._windWaveSpeed;
            case "ship_windWaveIntensity":
                return this._windWaveIntensity;
        }

        if (name.startsWith("procSky_")) {
            name = name.substring(8);
            return (this._skybox.skyMaterial as any)[name];
        }

        if (name.startsWith("waves_")) {
            name = name.substring(6);
            return this._readValue(this._wavesSettings, name);
        }

        if (name.startsWith("oceangeom_")) {
            name = name.substring(10);
            return this._readValue(this._oceanGeometry, name);
        }

        if (name.startsWith("oceanshader_")) {
            name = name.substring(12);
            return this._oceanMaterial.readMaterialParameter(this._oceanGeometry.getMaterial(0) as BABYLON.PBRCustomMaterial, name);
        }
    }

    private _parameterChanged(name: string, value: any): void {
        switch (name) {
            case "size": {
                const newSize = value | 0;
                if (newSize !== this._size) {
                    this._updateSize(newSize);
                }
                break;
            }
            case "showDebugRTT":
                this._rttDebug.show(!!value);
                break;
            case "envIntensity":
                this._scene.environmentIntensity = parseFloat(value);
                break;
            case "lightIntensity":
                this._light.intensity = parseFloat(value);
                break;
            case "enableShadows":
                this._light.shadowEnabled = !!value;
                if (this._lightBuoy) {
                    this._lightBuoy.shadowEnabled = !!value;
                }
                break;
            case "enableFXAA":
                if (value) {
                    if (!this._fxaa) {
                        this._fxaa = new BABYLON.FxaaPostProcess("fxaa", 1, this._camera);
                        this._fxaa.samples = this._engine.getCaps().maxMSAASamples;
                    }
                } else if (this._fxaa) {
                    this._fxaa.dispose();
                    this._fxaa = null;
                }
                break;
            case "enableGlow":
                if (this._glowLayer) {
                    this._glowLayer.dispose();
                    this._glowLayer = null as any;
                } else {
                    this._createGlowLayer();
                }
                break;
            case "proceduralSky":
                value = !!value;
                if (this._useProceduralSky !== value) {
                    if (this._gui) {
                        this._gui.dispose();
                    }
                    this._skybox.dispose();
                    this._useProceduralSky = value;
                    this._skybox = new SkyBox(this._useProceduralSky, this._scene);
                }
                break;
            case "useZQSD":
                this._useZQSD = !!value;
                this._setCameraKeys();
                break;
            case "buoy_enabled":
                this._buoyancy.enabled = !!value;
                break;
            case "buoy_attenuation":
                this._buoyancy.attenuation = parseFloat(value);
                break;
            case "buoy_numSteps":
                this._buoyancy.numSteps = value | 0;
                break;
            case "skybox_lightColor":
                this._light.diffuse.copyFrom(BABYLON.Color3.FromHexString(value));
                break;
            case "skybox_directionX":
                this._lightDirection.x = parseFloat(value);
                this._light.direction = this._lightDirection.normalizeToNew();
                break;
            case "skybox_directionY":
                this._lightDirection.y = parseFloat(value);
                this._light.direction = this._lightDirection.normalizeToNew();
                break;
            case "skybox_directionZ":
                this._lightDirection.z = parseFloat(value);
                this._light.direction = this._lightDirection.normalizeToNew();
                break;
            case "ship_sailHeight":
                this._sailHeight = parseFloat(value);
                this._player?.props.setSailHeight(this._sailHeight);
                break;
            case "ship_sailElevation":
                this._sailElevation = parseFloat(value);
                this._player?.props.setSailElevation(this._sailElevation);
                break;
            case "ship_windWaveSpeed":
                this._windWaveSpeed = parseFloat(value);
                if (this._player) this._player.props.windWaveSpeed = this._windWaveSpeed;
                break;
            case "ship_windWaveIntensity":
                this._windWaveIntensity = parseFloat(value);
                if (this._player) this._player.props.windWaveIntensity = this._windWaveIntensity;
                break;
        }

        if (name.startsWith("procSky_")) {
            name = name.substring(8);
            this._setValue(this._skybox.skyMaterial, name, value === false ? false : value === true ? true : parseFloat(value));
            this._skybox.setAsDirty();
        }

        if (name.startsWith("waves_")) {
            name = name.substring(6);
            this._setValue(this._wavesSettings, name, value === false ? false : value === true ? true : parseFloat(value));
            this._wavesGenerator!.initializeCascades();
        }

        if (name.startsWith("oceangeom_")) {
            name = name.substring(10);
            this._setValue(this._oceanGeometry, name, value === false ? false : value === true ? true : parseFloat(value));
            if (name !== "oceangeom_noMaterialLod") {
                this._oceanGeometry.initializeMeshes();
            }
        }

        if (name.startsWith("oceanshader_")) {
            name = name.substring(12);
            this._oceanMaterial.updateMaterialParameter(this._oceanGeometry.getMaterial(0) as BABYLON.PBRCustomMaterial, name, value);
            this._oceanMaterial.updateMaterialParameter(this._oceanGeometry.getMaterial(1) as BABYLON.PBRCustomMaterial, name, value);
            this._oceanMaterial.updateMaterialParameter(this._oceanGeometry.getMaterial(2) as BABYLON.PBRCustomMaterial, name, value);
        }
    }

    private _loadSavedOceanSettings(): void {
        try {
            const saved = localStorage.getItem("ocean_custom_defaults");
            if (saved) {
                const data = JSON.parse(saved);
                for (const key in data) {
                    try {
                        this._parameterChanged(key, data[key]);
                    } catch {
                        // ignore unknown key
                    }
                }
            }
        } catch (err) {
            console.warn("Could not parse saved ocean settings:", err);
        }
    }
}
