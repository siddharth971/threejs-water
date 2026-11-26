import { WavesGenerator } from "../waves/WavesGenerator";

const foamPicture = "https://assets.babylonjs.com/environments/waterFoam_circular_mask.png";

export class OceanMaterial {

    private _wavesGenerator: WavesGenerator;
    private _depthRenderer: BABYLON.DepthRenderer;
    private _scene: BABYLON.Scene;
    private _camera: BABYLON.Camera;
    private _foamTexture: BABYLON.Texture;
    private _startTime: number;
    private _horizonColor: BABYLON.Vector3;
    private _isUnderwater = false;

    constructor(depthRenderer: BABYLON.DepthRenderer, scene: BABYLON.Scene) {
        this._wavesGenerator = null as any;
        this._depthRenderer = depthRenderer;
        this._scene = scene;
        this._camera = scene.activeCameras?.[0] ?? scene.activeCamera!;
        this._foamTexture = new BABYLON.Texture(foamPicture, this._scene);
        this._startTime = performance.now() / 1000;
        this._horizonColor = new BABYLON.Vector3(0.55, 0.68, 0.80);
    }

    public setWavesGenerator(wavesGenerator: WavesGenerator): void {
        this._wavesGenerator = wavesGenerator;
    }

    public setHorizonColor(color: BABYLON.Vector3): void {
        this._horizonColor.copyFrom(color);
    }

    public setUnderwater(isUnderwater: boolean): void {
        this._isUnderwater = isUnderwater;
    }

    public readMaterialParameter(mat: BABYLON.PBRCustomMaterial, name: string): any {
        const tmp = new BABYLON.Color3();
        for (const param in mat._newUniformInstances) {
            const [ptype, pname] = param.split("-");
            let val = mat._newUniformInstances[param];
            if (pname === name) {
                if (ptype === "vec3") {
                    val = val as BABYLON.Vector3;
                    tmp.copyFromFloats(val.x, val.y, val.z);
                    tmp.toGammaSpaceToRef(tmp);
                    val = tmp.toHexString();
                }
                return val;
            }
        }
        return null;
    }

    public updateMaterialParameter(mat: BABYLON.PBRCustomMaterial, name: string, value: any): void {
        const tmp = new BABYLON.Vector3();
        for (const param in mat._newUniformInstances) {
            const [ptype, pname] = param.split("-");
            if (pname === name) {
                if (ptype === "vec3") {
                    value = BABYLON.Color3.FromHexString(value);
                    value = value.toLinearSpaceToRef(value);
                    tmp.copyFromFloats(value.r, value.g, value.b);
                    value = tmp;
                }
                mat._newUniformInstances[param] = value;
                return;
            }
        }
    }

    public async getMaterial(useMid: boolean, useClose: boolean, useNodeMaterial = false): Promise<BABYLON.Material> {
        let mat: BABYLON.NodeMaterial | BABYLON.PBRCustomMaterial;

        if (!useNodeMaterial) {

            mat = new BABYLON.PBRCustomMaterial("oceanMat" + (useMid ? "1" : "0") + (useClose ? "1" : "0"), this._scene);

            mat.metallic = 0;
            mat.roughness = 0.311;
            mat.forceIrradianceInFragment = true;
            mat.backFaceCulling = true;

            const color = new BABYLON.Vector3(0.011126082368383245, 0.05637409755197975, 0.09868919754109445);

            mat.AddUniform("_Color", "vec3", color);
            mat.AddUniform("_MaxGloss", "float", 0.91);
            mat.AddUniform("_RoughnessScale", "float", 0.0044);
            mat.AddUniform("_LOD_scale", "float", 7.13);

            mat.AddUniform("_FoamColor", "vec3", new BABYLON.Vector3(1, 1, 1));
            mat.AddUniform("_FoamScale", "float", 1.2);
            mat.AddUniform("_ContactFoam", "float", 0.6);
            mat.AddUniform("_FoamBiasLOD0", "float", 0.60);
            mat.AddUniform("_FoamBiasLOD1", "float", 1.25);
            mat.AddUniform("_FoamBiasLOD2", "float", 1.95);

            mat.AddUniform("_SSSColor", "vec3", new BABYLON.Vector3(0.1541919, 0.8857628, 0.990566));
            mat.AddUniform("_SSSStrength", "float", 0.15);
            mat.AddUniform("_SSSBase", "float", -0.261);
            mat.AddUniform("_SSSScale", "float", 4.7);

            mat.AddUniform("lightDirection", "vec3", "");
            mat.AddUniform("_WorldSpaceCameraPos", "vec3", "");
            mat.AddUniform("LengthScale0", "float", this._wavesGenerator.lengthScale[0]);
            mat.AddUniform("LengthScale1", "float", this._wavesGenerator.lengthScale[1]);
            mat.AddUniform("LengthScale2", "float", this._wavesGenerator.lengthScale[2]);
            mat.AddUniform("_Displacement_c0", "sampler2D", this._wavesGenerator.getCascade(0).displacement);
            mat.AddUniform("_Derivatives_c0", "sampler2D", this._wavesGenerator.getCascade(0).derivatives);
            mat.AddUniform("_Turbulence_c0", "sampler2D", this._wavesGenerator.getCascade(0).turbulence);
            mat.AddUniform("_Displacement_c1", "sampler2D", this._wavesGenerator.getCascade(1).displacement);
            mat.AddUniform("_Derivatives_c1", "sampler2D", this._wavesGenerator.getCascade(1).derivatives);
            mat.AddUniform("_Turbulence_c1", "sampler2D", this._wavesGenerator.getCascade(1).turbulence);
            mat.AddUniform("_Displacement_c2", "sampler2D", this._wavesGenerator.getCascade(2).displacement);
            mat.AddUniform("_Derivatives_c2", "sampler2D", this._wavesGenerator.getCascade(2).derivatives);
            mat.AddUniform("_Turbulence_c2", "sampler2D", this._wavesGenerator.getCascade(2).turbulence);
            mat.AddUniform("_Time", "float", 0);
            mat.AddUniform("_CameraDepthTexture", "sampler2D", this._depthRenderer.getDepthMap());
            mat.AddUniform("_CameraData", "vec4", new BABYLON.Vector4(this._camera.minZ, this._camera.maxZ, this._camera.maxZ - this._camera.minZ, 0));
            mat.AddUniform("_FoamTexture", "sampler2D", this._foamTexture);
            mat.AddUniform("uHorizonColor", "vec3", this._horizonColor);
            mat.AddUniform("uIsUnderwater", "float", 0.0);

            const cascades = [];
            if (useMid) {
                cascades.push("#define MID");
            }
            if (useClose) {
                cascades.push("#define CLOSE");
            }

            mat.Vertex_Definitions(`
                ${cascades.join("\n")}

                varying vec2 vWorldUV;
                varying vec2 vUVCoords_c0;
                varying vec2 vUVCoords_c1;
                varying vec2 vUVCoords_c2;
                varying vec3 vViewVector;
                varying vec4 vLodScales;
                varying vec4 vClipCoords;
                varying float vMetric;
            `);

            mat.Fragment_Definitions(`
                ${cascades.join("\n")}

                varying vec2 vWorldUV;
                varying vec2 vUVCoords_c0;
                varying vec2 vUVCoords_c1;
                varying vec2 vUVCoords_c2;
                varying vec3 vViewVector;
                varying vec4 vLodScales;
                varying vec4 vClipCoords;
                varying float vMetric;
            `);

            mat.Vertex_After_WorldPosComputed(`
                vWorldUV = worldPos.xz;
            
                vViewVector = _WorldSpaceCameraPos - worldPos.xyz;
                float viewDist = length(vViewVector);
            
                float lod_c0 = min(_LOD_scale * LengthScale0 / viewDist, 1.0);
                float lod_c1 = min(_LOD_scale * LengthScale1 / viewDist, 1.0);
                float lod_c2 = min(_LOD_scale * LengthScale2 / viewDist, 1.0);
                    
                vec3 displacement = vec3(0.);
                float largeWavesBias = 0.;
            
                vUVCoords_c0 = vWorldUV / LengthScale0;
                vUVCoords_c1 = vWorldUV / LengthScale1;
                vUVCoords_c2 = vWorldUV / LengthScale2;
            
                displacement += texture2D(_Displacement_c0, vUVCoords_c0).xyz * lod_c0;
                largeWavesBias = displacement.y;
            
                #if defined(MID) || defined(CLOSE)
                    displacement += texture2D(_Displacement_c1, vUVCoords_c1).xyz * lod_c1;
                #endif
                #if defined(CLOSE)
                    displacement += texture2D(_Displacement_c2, vUVCoords_c2).xyz * lod_c2;
                #endif
    
                worldPos.xyz += displacement;

                vLodScales = vec4(lod_c0, lod_c1, lod_c2, max(displacement.y - largeWavesBias * 0.8 - _SSSBase, 0) / _SSSScale);
            `);

            mat.Vertex_MainEnd(`
                vClipCoords = gl_Position;
                vMetric = gl_Position.z;
            `);

            mat.Fragment_Before_Lights(`
                vec4 derivatives = texture2D(_Derivatives_c0, vUVCoords_c0);
                #if defined(MID) || defined(CLOSE)
                    derivatives += texture2D(_Derivatives_c1, vUVCoords_c1) * vLodScales.y;
                #endif
                #if defined(CLOSE)
                    derivatives += texture2D(_Derivatives_c2, vUVCoords_c2) * vLodScales.z;
                #endif

                vec2 slope = vec2(derivatives.x / (1.0 + derivatives.z), derivatives.y / (1.0 + derivatives.w));
                normalW = normalize(vec3(-slope.x, 1.0, -slope.y));

                #if defined(CLOSE)
                    float jacobian = texture2D(_Turbulence_c0, vUVCoords_c0).x + texture2D(_Turbulence_c1, vUVCoords_c1).x + texture2D(_Turbulence_c2, vUVCoords_c2).x;
                    jacobian = min(1.0, max(0.0, (-jacobian + _FoamBiasLOD2) * _FoamScale));
                #elif defined(MID)
                    float jacobian = texture2D(_Turbulence_c0, vUVCoords_c0).x + texture2D(_Turbulence_c1, vUVCoords_c1).x;
                    jacobian = min(1.0, max(0.0, (-jacobian + _FoamBiasLOD1) * _FoamScale));
                #else
                    float jacobian = texture2D(_Turbulence_c0, vUVCoords_c0).x;
                    jacobian = min(1.0, max(0.0, (-jacobian + _FoamBiasLOD0) * _FoamScale));
                #endif

                vec2 screenUV = vClipCoords.xy / vClipCoords.w;
                screenUV = clamp(screenUV * 0.5 + 0.5, vec2(0.001), vec2(0.999));
                float backgroundDepth = texture2D(_CameraDepthTexture, screenUV).r * _CameraData.y;
                float surfaceDepth = vMetric;
                float rawDepthDiff = max(0.0, backgroundDepth - surfaceDepth);
                float depthDifference = max(0.0, rawDepthDiff - 0.5);
                float hasSeabed = step(backgroundDepth, _CameraData.y * 0.5);
                float foam = texture2D(_FoamTexture, vWorldUV * 0.5 + _Time * 2.0).r;
                float coastalSwirl = texture2D(_FoamTexture, vWorldUV * 0.14 - vec2(_Time * 0.35, _Time * 0.22)).r;
                jacobian += _ContactFoam * saturate(max(0.0, foam - depthDifference) * 5.0) * 0.85 * hasSeabed;

                // Feathered organic shoreline surf wash + thin lacy swash edge right where waves lap the beach
                float shoreMask = (1.0 - smoothstep(0.0, 2.8, rawDepthDiff)) * hasSeabed;
                float surfWave = sin(rawDepthDiff * 6.8 + _Time * 3.6 + coastalSwirl * 4.2 + foam * 2.0);
                float surfBands = shoreMask * smoothstep(0.18, 0.86, surfWave) * (0.40 + 0.60 * foam);
                float swashLip = (1.0 - smoothstep(0.02, 0.42, rawDepthDiff)) * hasSeabed * (0.45 + 0.55 * coastalSwirl);
                jacobian = saturate(jacobian + surfBands * 0.72 + swashLip * 0.85);
    
                surfaceAlbedo = mix(vec3(0.0), _FoamColor, jacobian);

                vec3 viewDir = normalize(vViewVector);
                float isBackside = step(0.5, uIsUnderwater) * step(dot(normalW, viewDir), 0.0);
                if (isBackside > 0.5) {
                    normalW = -normalW;
                }
                vec3 H = normalize(-normalW + lightDirection);
                float ViewDotH = pow5(saturate(dot(viewDir, -H))) * 30.0 * _SSSStrength;
                vec3 color = mix(_Color, saturate(_Color + _SSSColor.rgb * ViewDotH * vLodScales.w), vLodScales.z);

                // Wave-refracted seabed visibility, caustics & Beer-Lambert optical lagoon transition (0..9m)
                vec2 refractedXZ = vWorldUV + normalW.xz * clamp(rawDepthDiff * 0.42, 0.0, 2.0);
                float gPatch = sin(refractedXZ.x * 0.22 + cos(refractedXZ.y * 0.19)) * 0.5 + 0.5;
                float c1 = sin(refractedXZ.x * 1.45 + _Time * 2.3 + cos(refractedXZ.y * 1.25 - _Time * 1.7));
                float c2 = cos(refractedXZ.y * 1.65 - _Time * 2.0 + sin(refractedXZ.x * 1.15 + _Time * 1.5));
                float caustic = pow(clamp(0.5 + 0.25 * (c1 + c2), 0.0, 1.0), 3.6);
                float cSharp = smoothstep(0.36, 0.92, caustic);

                // Sunlit coral-sand shoals + deeper seagrass/reef patches modulated by sun elevation
                float sunVis = saturate(-lightDirection.y * 1.2 + 0.25);
                vec3 coralSandFloor = mix(
                    vec3(0.54, 0.44, 0.26),
                    vec3(0.14, 0.30, 0.20),
                    smoothstep(0.56, 0.90, gPatch) * smoothstep(0.7, 3.4, rawDepthDiff)
                );
                vec3 sunlitFloor = coralSandFloor * (0.68 + 0.62 * cSharp) * sunVis;

                vec3 beerTransmittance = exp(-rawDepthDiff * vec3(0.66, 0.19, 0.15));
                vec3 lagoonVolume = vec3(0.025, 0.44, 0.47) * sunVis;
                vec3 opticalShallowColor = mix(lagoonVolume, sunlitFloor, beerTransmittance);
                float shallowVis = (1.0 - smoothstep(0.8, 9.2, rawDepthDiff)) * hasSeabed * (1.0 - uIsUnderwater);
                color = mix(color, opticalShallowColor, shallowVis * 0.88);
    
                float fresnel = dot(normalW, viewDir);
                fresnel = saturate(1.0 - fresnel);
                fresnel = pow5(fresnel);
            `);

            mat.Fragment_Custom_MetallicRoughness(`
                float distanceGloss = mix(1.0 - metallicRoughness.g, _MaxGloss, 1.0 / (1.0 + length(vViewVector) * _RoughnessScale));
                metallicRoughness.g = 1.0 - mix(distanceGloss, 0.0, jacobian);
            `);

            mat.Fragment_Before_FinalColorComposition(`
                vec3 waterBodyColor = mix(color * (1.0 - fresnel), vec3(0.03, 0.24, 0.36), uIsUnderwater * 0.65);
                finalEmissive = mix(waterBodyColor, vec3(0.0), jacobian);
            `);

            mat.Fragment_Before_FragColor(`
                float distToCam = length(vViewVector);
                float horizonMist = smoothstep(180.0, 2600.0, distToCam);
                vec3 mistTarget = mix(uHorizonColor, vec3(0.02, 0.20, 0.32), uIsUnderwater);
                float uwMist = uIsUnderwater * clamp(distToCam / 35.0, 0.0, 0.92);
                finalColor.rgb = mix(finalColor.rgb, mistTarget, max(horizonMist * 0.88, uwMist));
            `);

            mat.onBindObservable.add(() => {
                const effect = mat.getEffect();
                if (!effect) {
                    return;
                }
                const time = ((performance.now() / 1000) - this._startTime) / 10;

                effect.setVector3("_WorldSpaceCameraPos", this._camera.globalPosition);
                effect.setVector3("uHorizonColor", this._horizonColor);
                effect.setFloat("uIsUnderwater", this._isUnderwater ? 1.0 : 0.0);
                effect.setTexture("_Turbulence_c0", this._wavesGenerator.getCascade(0).turbulence);
                effect.setTexture("_Turbulence_c1", this._wavesGenerator.getCascade(1).turbulence);
                effect.setTexture("_Turbulence_c2", this._wavesGenerator.getCascade(2).turbulence);
                effect.setFloat("_Time", time);
                effect.setVector3("lightDirection", (this._scene.lights[0] as BABYLON.DirectionalLight).direction);
            });

            return new Promise((resolve) => {
                if (this._foamTexture.isReady()) {
                    resolve(mat);
                } else {
                    this._foamTexture.onLoadObservable.addOnce(() => {
                        resolve(mat);
                    });
                }
            });
        } else {
            mat = await BABYLON.NodeMaterial.ParseFromSnippetAsync("R4152I#24", this._scene);

            mat.getInputBlockByPredicate((b: any) => b.name === "LOD_scale")!.value = 7.13;
            mat.getInputBlockByPredicate((b: any) => b.name === "LengthScale0")!.value = this._wavesGenerator.lengthScale[0];
            mat.getInputBlockByPredicate((b: any) => b.name === "Roughness")!.value = 0.311;
            mat.getInputBlockByPredicate((b: any) => b.name === "metallic")!.value = 0;
            (mat.getBlockByName("Displacement_c0") as BABYLON.TextureBlock).texture = this._wavesGenerator.getCascade(0).displacement as BABYLON.Texture;
            (mat.getBlockByName("Derivatives_c0") as BABYLON.TextureBlock).texture = this._wavesGenerator.getCascade(0).derivatives as BABYLON.Texture;

            mat.build();
        }

        return mat;
    }
}
