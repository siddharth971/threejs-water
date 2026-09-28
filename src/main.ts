import './styles.css';
import { Ocean } from './ocean/Ocean';

/**
 * Based on the great Unity project https://github.com/gasgiant/FFT-Ocean by Ivan Pensionerov (https://github.com/gasgiant)
 * Babylon.js WebGPU implementation.
 */

async function createEngine(): Promise<BABYLON.Engine> {
    const webGPUSupported = await (BABYLON.WebGPUEngine as any).IsSupportedAsync;
    if (webGPUSupported) {
        const engine = new BABYLON.WebGPUEngine(document.getElementById("renderCanvas") as HTMLCanvasElement);
        await engine.initAsync();
        return engine as any;
    }
    return new BABYLON.Engine(document.getElementById("renderCanvas") as HTMLCanvasElement, true);
}

export class Playground {
    public static CreateScene(engine: BABYLON.Engine, canvas: HTMLCanvasElement): Promise<BABYLON.Scene> {
        const oceanDemo = new Ocean();
        return oceanDemo.createScene(engine, canvas);
    }
}

// Application bootstrap
async function main() {
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    if (!canvas) {
        console.error("Canvas element #renderCanvas not found!");
        return;
    }

    const engine = await createEngine();
    const scene = await Playground.CreateScene(engine, canvas);

    engine.runRenderLoop(() => {
        scene.render();
    });

    window.addEventListener("resize", () => {
        engine.resize();
    });
}

if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => {
        main().catch((err) => console.error("Error launching Babylon Ocean:", err));
    });
} else {
    main().catch((err) => console.error("Error launching Babylon Ocean:", err));
}

export default Playground;
