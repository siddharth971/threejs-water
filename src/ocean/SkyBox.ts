import "../utils/Vector3Float32";

export class SkyBox {

    private _procedural: boolean;
    private _scene: BABYLON.Scene;
    private _skybox: BABYLON.Mesh;
    private _skyMaterial: BABYLON.SkyMaterial;
    private _probe: BABYLON.ReflectionProbe;
    private _oldSunPosition: BABYLON.Vector3;
    private _skyboxObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>>;
    private _dirty: boolean;
    private _dirtyCount: number;
    private _needPolynomialsRegen: boolean;

    public get probe(): BABYLON.Nullable<BABYLON.ReflectionProbe> {
        return this._probe;
    }

    public get skyMaterial() {
        return this._skyMaterial;
    }

    public setAsDirty(): void {
        this._dirty = true;
        this._dirtyCount = 2;
        this._probe.cubeTexture.refreshRate = 1;
        this._needPolynomialsRegen = true;
    }

    constructor(useProcedural: boolean, scene: BABYLON.Scene) {
        this._procedural = useProcedural;
        this._scene = scene;
        this._oldSunPosition = new BABYLON.Vector3();
        this._skyMaterial = null as any;
        this._probe = null as any;
        this._dirty = false;
        this._dirtyCount = 0;
        this._needPolynomialsRegen = false;

        this._skybox = BABYLON.MeshBuilder.CreateBox("skyBox", {size: 1000.0, sideOrientation: BABYLON.Mesh.BACKSIDE}, this._scene);

        scene.meshes.splice(scene.meshes.indexOf(this._skybox), 1);
        scene.meshes.splice(0, 0, this._skybox);

        this._skyboxObserver = scene.onBeforeRenderObservable.add(() => {
            this._skybox.position = scene.activeCameras?.[0].position ?? scene.activeCamera!.position;
        });

        if (useProcedural) {
            this._initProceduralSkybox();
        } else {
            this._initSkybox();
        }

        this.setAsDirty();
    }

    public update(light: BABYLON.ShadowLight): boolean {
        if (!this._procedural) {
            return false;
        }

        let ret = false;

        const texture = this._probe.cubeTexture.getInternalTexture()!;

        if (!this._oldSunPosition.equals(this._skyMaterial.sunPosition) || this._dirty) {
            this._oldSunPosition.copyFrom(this._skyMaterial.sunPosition);
            light.position = this._skyMaterial.sunPosition.clone();
            light.direction = this._skyMaterial.sunPosition.negate().normalize();
            light.diffuse = (this._skyMaterial as any).getSunColor().toLinearSpace();
            if (this._dirtyCount-- === 0) {
                this._dirty = false;
                this._probe.cubeTexture.refreshRate = 0;
            }
            ret = true;
        }
        if (!this._dirty && this._needPolynomialsRegen && texture._sphericalPolynomialComputed) {
            this._probe.cubeTexture.forceSphericalPolynomialsRecompute();
            this._needPolynomialsRegen = false;
        }

        return ret;
    }

    public dispose(): void {
        this._scene.onBeforeRenderObservable.remove(this._skyboxObserver);
        this._scene.customRenderTargets = [];

        if (this._procedural) {
            this._probe.dispose();
        } else {
            this._scene.environmentTexture?.dispose();
            (this._skybox.material as BABYLON.StandardMaterial).reflectionTexture?.dispose();
        }

        this._skybox.material!.dispose();
        this._skybox.dispose();
        this._scene.environmentTexture = null;
    }

    public getHorizonColor(): BABYLON.Vector3 {
        if (this._skyMaterial) {
            const inc = this._skyMaterial.inclination;
            if (inc > 0.08) {
                return new BABYLON.Vector3(0.52, 0.70, 0.88);
            } else if (inc >= -0.04) {
                return new BABYLON.Vector3(0.56, 0.68, 0.80);
            } else {
                return new BABYLON.Vector3(0.35, 0.45, 0.55);
            }
        }
        return new BABYLON.Vector3(0.55, 0.68, 0.80);
    }

    private _initProceduralSkybox(): void {
        this._skyMaterial = new BABYLON.SkyMaterial("sky", this._scene);
        this._skybox.material = this._skyMaterial;
        this._skybox.material.disableDepthWrite = true;

        this._skyMaterial.inclination = 0.02;
        this._skyMaterial.azimuth = 0.388;
        this._skyMaterial.luminance = 1.0;
        this._skyMaterial.turbidity = 10.0;
        this._skyMaterial.rayleigh = 2.0;
        this._skyMaterial.mieCoefficient = 0.005;
        this._skyMaterial.mieDirectionalG = 0.8;
    
        this._probe = new BABYLON.ReflectionProbe("skyProbe", 128, this._scene, true, true, true);
        this._probe.renderList!.push(this._skybox);

        this._probe.attachToMesh(this._skybox);
        this._probe.cubeTexture.activeCamera = this._scene.activeCameras?.[0] ?? this._scene.activeCamera!;
        this._probe.cubeTexture.refreshRate = 0;

        this._probe.cubeTexture.onAfterUnbindObservable.add(() => {
            const texture = this._probe.cubeTexture.getInternalTexture()!;
            if (texture._sphericalPolynomialComputed) {
                this._probe.cubeTexture.forceSphericalPolynomialsRecompute();
                this._needPolynomialsRegen = false;
            } else {
                this._needPolynomialsRegen = true;
            }
        });

        this._scene.environmentTexture = this._probe.cubeTexture;
        this._scene.customRenderTargets.push(this._probe.cubeTexture);
    }

    private _initSkybox(): void {
        const reflectionTexture = new BABYLON.HDRCubeTexture("https://popov72.github.io/BabylonDev/resources/webgpu/oceanDemo/0c03bd6e3c9d04da0cf428bbf487bf68.hdr", this._scene, 256, false, true, false, true);

        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this._scene);
        skyboxMaterial.disableDepthWrite = true;
        skyboxMaterial.reflectionTexture = reflectionTexture.clone();
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);

        this._skybox.material = skyboxMaterial;

        this._scene.environmentTexture = reflectionTexture;
    }
}
