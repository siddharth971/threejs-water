/**
 * Procedural Web Audio API sound effects for the pirate ship simulation.
 * Zero external asset dependencies - instantly synthesized with zero latency.
 */
export class ShipAudio {
    private _ctx: AudioContext | null = null;
    private _ambientGain: GainNode | null = null;
    private _initialized = false;

    private _initContext(): boolean {
        if (!this._ctx) {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContextClass) return false;
            this._ctx = new AudioContextClass();
        }
        if (this._ctx.state === 'suspended') {
            this._ctx.resume();
        }
        return true;
    }

    public init(): void {
        if (this._initialized) return;
        if (this._initContext()) {
            this._initialized = true;
            this.startAmbientSea();
        }
    }

    /**
     * Ambient sea breeze and ship creak sound
     */
    public startAmbientSea(): void {
        if (!this._ctx || this._ambientGain) return;

        try {
            // Pink-ish noise buffer for wind/waves
            const bufferSize = this._ctx.sampleRate * 2;
            const noiseBuffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.96900 * b2 + white * 0.1538520;
                b3 = 0.86650 * b3 + white * 0.3104856;
                b4 = 0.55000 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.0168980;
                output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
                b6 = white * 0.115926;
            }

            const whiteNoise = this._ctx.createBufferSource();
            whiteNoise.buffer = noiseBuffer;
            whiteNoise.loop = true;

            const filter = this._ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 450;

            const gain = this._ctx.createGain();
            gain.gain.value = 0.08;

            whiteNoise.connect(filter);
            filter.connect(gain);
            gain.connect(this._ctx.destination);
            whiteNoise.start();

            this._ambientGain = gain;
        } catch {
            // Audio context might be restricted before user gesture
        }
    }

    /**
     * Subtle footstep on wooden ship deck
     */
    public playFootstep(): void {
        if (!this._initContext() || !this._ctx) return;
        const t = this._ctx.currentTime;

        const osc = this._ctx.createOscillator();
        const gain = this._ctx.createGain();
        const filter = this._ctx.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(80 + Math.random() * 30, t);
        osc.frequency.exponentialRampToValueAtTime(35, t + 0.07);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(250, t);

        gain.gain.setValueAtTime(0.09, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this._ctx.destination);

        osc.start(t);
        osc.stop(t + 0.08);
    }

    /**
     * Thunderous cannon blast with muzzle crack, low explosive boom, and reverb
     */
    public playCannonBlast(): void {
        if (!this._initContext() || !this._ctx) return;
        const t = this._ctx.currentTime;

        // 1. Transient sharp crack
        const osc = this._ctx.createOscillator();
        const oscGain = this._ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
        oscGain.gain.setValueAtTime(0.4, t);
        oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        osc.connect(oscGain);
        oscGain.connect(this._ctx.destination);
        osc.start(t);
        osc.stop(t + 0.2);

        // 2. Heavy explosive boom (noise burst + steep lowpass)
        const bufferSize = Math.floor(this._ctx.sampleRate * 1.5);
        const noiseBuffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const noise = this._ctx.createBufferSource();
        noise.buffer = noiseBuffer;

        const filter = this._ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(600, t);
        filter.frequency.exponentialRampToValueAtTime(70, t + 1.2);

        const gain = this._ctx.createGain();
        gain.gain.setValueAtTime(0.9, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 1.4);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this._ctx.destination);

        noise.start(t);
        noise.stop(t + 1.5);
    }

    /**
     * Metallic sword draw (shiiing!)
     */
    public playCutlassDraw(): void {
        if (!this._initContext() || !this._ctx) return;
        const t = this._ctx.currentTime;

        const osc1 = this._ctx.createOscillator();
        const osc2 = this._ctx.createOscillator();
        const gain = this._ctx.createGain();

        osc1.type = 'sine';
        osc2.type = 'triangle';

        osc1.frequency.setValueAtTime(1400, t);
        osc1.frequency.linearRampToValueAtTime(2800, t + 0.18);
        osc1.frequency.exponentialRampToValueAtTime(1200, t + 0.45);

        osc2.frequency.setValueAtTime(2800, t);
        osc2.frequency.linearRampToValueAtTime(4200, t + 0.22);
        osc2.frequency.exponentialRampToValueAtTime(1600, t + 0.45);

        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.25, t + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this._ctx.destination);

        osc1.start(t);
        osc2.start(t);
        osc1.stop(t + 0.46);
        osc2.stop(t + 0.46);
    }

    /**
     * Cutlass swing whoosh
     */
    public playCutlassSwing(): void {
        if (!this._initContext() || !this._ctx) return;
        const t = this._ctx.currentTime;

        const bufferSize = Math.floor(this._ctx.sampleRate * 0.25);
        const noiseBuffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const noise = this._ctx.createBufferSource();
        noise.buffer = noiseBuffer;

        const filter = this._ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(400, t);
        filter.frequency.exponentialRampToValueAtTime(1600, t + 0.1);
        filter.frequency.exponentialRampToValueAtTime(300, t + 0.22);
        filter.Q.value = 3.5;

        const gain = this._ctx.createGain();
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.23);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this._ctx.destination);

        noise.start(t);
        noise.stop(t + 0.25);
    }

    /**
     * Wooden hammer repair hit
     */
    public playHammer(): void {
        if (!this._initContext() || !this._ctx) return;
        const t = this._ctx.currentTime;

        // Wood impact
        const woodOsc = this._ctx.createOscillator();
        const woodGain = this._ctx.createGain();
        woodOsc.type = 'sine';
        woodOsc.frequency.setValueAtTime(260, t);
        woodOsc.frequency.exponentialRampToValueAtTime(60, t + 0.08);
        woodGain.gain.setValueAtTime(0.35, t);
        woodGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        woodOsc.connect(woodGain);
        woodGain.connect(this._ctx.destination);
        woodOsc.start(t);
        woodOsc.stop(t + 0.1);

        // Nail ping
        const metalOsc = this._ctx.createOscillator();
        const metalGain = this._ctx.createGain();
        metalOsc.type = 'triangle';
        metalOsc.frequency.setValueAtTime(1850 + Math.random() * 200, t);
        metalOsc.frequency.exponentialRampToValueAtTime(900, t + 0.12);
        metalGain.gain.setValueAtTime(0.2, t);
        metalGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        metalOsc.connect(metalGain);
        metalGain.connect(this._ctx.destination);
        metalOsc.start(t);
        metalOsc.stop(t + 0.13);
    }

    /**
     * Treasure chest open: heavy wood creak followed by shimmering gold chime
     */
    public playChestOpen(): void {
        if (!this._initContext() || !this._ctx) return;
        const t = this._ctx.currentTime;

        // Wood creak
        const creakOsc = this._ctx.createOscillator();
        const creakGain = this._ctx.createGain();
        creakOsc.type = 'sawtooth';
        creakOsc.frequency.setValueAtTime(140, t);
        creakOsc.frequency.linearRampToValueAtTime(190, t + 0.2);
        creakGain.gain.setValueAtTime(0.18, t);
        creakGain.gain.exponentialRampToValueAtTime(0.01, t + 0.28);
        creakOsc.connect(creakGain);
        creakGain.connect(this._ctx.destination);
        creakOsc.start(t);
        creakOsc.stop(t + 0.3);

        // Golden chimes (E5, G#5, B5, E6 arpeggio)
        const notes = [659.25, 830.61, 987.77, 1318.51];
        notes.forEach((freq, idx) => {
            const noteTime = t + 0.15 + idx * 0.08;
            const osc = this._ctx!.createOscillator();
            const gain = this._ctx!.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, noteTime);

            gain.gain.setValueAtTime(0.001, noteTime);
            gain.gain.linearRampToValueAtTime(0.16, noteTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.6);

            osc.connect(gain);
            gain.connect(this._ctx!.destination);

            osc.start(noteTime);
            osc.stop(noteTime + 0.62);
        });
    }

    /**
     * Sail flutter and wind catch
     */
    public playSailFlutter(): void {
        if (!this._initContext() || !this._ctx) return;
        const t = this._ctx.currentTime;

        const bufferSize = Math.floor(this._ctx.sampleRate * 0.8);
        const noiseBuffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const noise = this._ctx.createBufferSource();
        noise.buffer = noiseBuffer;

        const filter = this._ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, t);
        filter.frequency.linearRampToValueAtTime(750, t + 0.3);
        filter.frequency.exponentialRampToValueAtTime(150, t + 0.75);

        const gain = this._ctx.createGain();
        gain.gain.setValueAtTime(0.01, t);
        gain.gain.linearRampToValueAtTime(0.28, t + 0.25);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.78);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this._ctx.destination);

        noise.start(t);
        noise.stop(t + 0.8);
    }

    /**
     * Helm wheel ratchet click / wood creak
     */
    public playHelmCreak(): void {
        if (!this._initContext() || !this._ctx) return;
        const t = this._ctx.currentTime;

        const osc = this._ctx.createOscillator();
        const gain = this._ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(110 + Math.random() * 40, t);
        osc.frequency.exponentialRampToValueAtTime(50, t + 0.05);

        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

        osc.connect(gain);
        gain.connect(this._ctx.destination);

        osc.start(t);
        osc.stop(t + 0.06);
    }
}
