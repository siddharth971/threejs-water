import { FFT } from "./FFT";
import { WavesCascade } from "./WavesCascade";
import { WavesSettings } from "./WavesSettings";
import { RTTDebug } from "../utils/RTTDebug";

export class WavesGenerator {
    public lengthScale: number[];

    private _engine: BABYLON.WebGPUEngine;
    private _startTime: number;
    private _rttDebug: RTTDebug;
    private _fft: FFT;
    private _noise: BABYLON.Texture;
    private _cascades: WavesCascade[];
    private _displacementMap: BABYLON.Nullable<Uint16Array>;
    private _wavesSettings: WavesSettings;

    public getCascade(num: number) {
        return this._cascades[num];
    }

    public get waterHeightMap() {
        return this._displacementMap;
    }

    public get waterHeightMapScale() {
        return this.lengthScale[0];
    }

    constructor(size: number, wavesSettings: WavesSettings, scene: BABYLON.Scene, rttDebug: RTTDebug, noise: BABYLON.Nullable<ArrayBuffer>) {
        this._engine = scene.getEngine() as BABYLON.WebGPUEngine;
        this._rttDebug = rttDebug;
        this._startTime = new Date().getTime() / 1000;
        this._displacementMap = null;
        this._wavesSettings = wavesSettings;

        this._fft = new FFT(scene.getEngine() as BABYLON.WebGPUEngine, scene, this._rttDebug, 1, size);
        this._noise = this._generateNoiseTexture(size, noise);

        this._rttDebug.setTexture(0, "noise", this._noise);

        this.lengthScale = [250, 17, 5];

        this._cascades = [
            new WavesCascade(size, this._noise, this._fft, this._rttDebug, 2, this._engine),
            new WavesCascade(size, this._noise, this._fft, this._rttDebug, 12, this._engine),
            new WavesCascade(size, this._noise, this._fft, this._rttDebug, 22, this._engine),
        ];
    }

    public async initAsync() {
        await this._fft.initAsync();

        for (let i = 0; i < this._cascades.length; ++i) {
            const cascade = this._cascades[i];
            await cascade.initAsync();
        }

        this.initializeCascades();
    }

    public initializeCascades(): void {
        let boundary1 = 0.0001;
        for (let i = 0; i < this.lengthScale.length; ++i) {
            let boundary2 = i < this.lengthScale.length - 1 ?  2 * Math.PI / this.lengthScale[i + 1] * 6 : 9999;
            this._cascades[i].calculateInitials(this._wavesSettings, this.lengthScale[i], boundary1, boundary2);
            boundary1 = boundary2;
        }
    }

    public update(): void {
        const time = (new Date().getTime() / 1000) - this._startTime;
        for (let i = 0; i < this._cascades.length; ++i) {
            this._cascades[i].calculateWavesAtTime(time);
        }
        this._getDisplacementMap();
    }

    public dispose(): void {
        for (let i = 0; i < this._cascades.length; ++i) {
            this._cascades[i].dispose();
        }
        this._noise.dispose();
        this._fft.dispose();
    }

    private _getDisplacementMap(): void {
        this._cascades[0].displacement.readPixels(undefined, undefined, undefined, undefined, true)?.then((buffer: ArrayBufferView) => {
            this._displacementMap = new Uint16Array(buffer.buffer);
        });
    }

    private _normalRandom(): number {
        return Math.cos(2 * Math.PI * Math.random()) * Math.sqrt(-2 * Math.log(Math.random()));
    }

    private _generateNoiseTexture(size: number, noiseBuffer: BABYLON.Nullable<ArrayBuffer>): BABYLON.Texture {
        const numChannels = noiseBuffer ? 4 : 2;
        const data = new Float32Array(size * size * numChannels);

        if (noiseBuffer && size === 256) {
            const buf = new Uint8Array(noiseBuffer);
            const tmpUint8 = new Uint8Array(4);
            const tmpFloat = new Float32Array(tmpUint8.buffer, 0, 1);

            let offset = 0x094b;
            let dataOffset = 0;
            for (let j = 0; j < 256; ++j) {
                offset += 8;
                offset += 256 * 4;
                offset += 256 * 4;
                for (let i = 0; i < 256; ++i) {
                    tmpUint8[0] = buf[offset++];
                    tmpUint8[1] = buf[offset++];
                    tmpUint8[2] = buf[offset++];
                    tmpUint8[3] = buf[offset++];
                    data[dataOffset + 1 + i * 4] = tmpFloat[0];
                }
                for (let i = 0; i < 256; ++i) {
                    tmpUint8[0] = buf[offset++];
                    tmpUint8[1] = buf[offset++];
                    tmpUint8[2] = buf[offset++];
                    tmpUint8[3] = buf[offset++];
                    data[dataOffset + 0 + i * 4] = tmpFloat[0];
                }
                for (let i = 0; i < 256; ++i) {
                    data[dataOffset + 3 + i * 4] = 1;
                }
                dataOffset += 256 * 4;
            }
        } else {
            // Robust Gaussian noise generator for any FFT resolution (32, 64, 128, etc.)
            for (let i = 0; i < size; ++i) {
                for (let j = 0; j < size; ++j) {
                    if (numChannels === 4) {
                        data[j * size * 4 + i * 4 + 0] = this._normalRandom();
                        data[j * size * 4 + i * 4 + 1] = this._normalRandom();
                        data[j * size * 4 + i * 4 + 2] = this._normalRandom();
                        data[j * size * 4 + i * 4 + 3] = 1.0;
                    } else {
                        data[j * size * 2 + i * 2 + 0] = this._normalRandom();
                        data[j * size * 2 + i * 2 + 1] = this._normalRandom();
                    }
                }
            }
        }

        const noise = new BABYLON.RawTexture(data, size, size, numChannels === 2 ? BABYLON.Constants.TEXTUREFORMAT_RG : BABYLON.Constants.TEXTUREFORMAT_RGBA, this._engine, false, false, BABYLON.Constants.TEXTURE_NEAREST_SAMPLINGMODE, BABYLON.Constants.TEXTURETYPE_FLOAT);
        noise.name = "noise";

        return noise;
    }
}
