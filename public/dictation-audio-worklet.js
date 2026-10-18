/** Streaming, weighted resampling; does not assume the AudioContext runs at 16 kHz. */
export class PCM16Resampler {
    constructor(inputRate, outputRate = 16000) {
        if (!Number.isFinite(inputRate) || inputRate < outputRate || outputRate <= 0) throw Error('Unsupported microphone sample rate.');
        this.ratio = inputRate / outputRate;
        this.sum = 0;
        this.weight = 0;
    }

    push(samples) {
        const output = [];
        for (let index = 0; index < samples.length; index++) {
            const sample = Number.isFinite(samples[index]) ? Math.max(-1, Math.min(1, samples[index])) : 0;
            let remaining = 1;
            while (remaining > 1e-9) {
                const take = Math.min(remaining, this.ratio - this.weight);
                this.sum += sample * take;
                this.weight += take;
                remaining -= take;
                if (this.weight >= this.ratio - 1e-9) {
                    output.push(this.quantize(this.sum / this.ratio));
                    this.sum = 0;
                    this.weight = 0;
                }
            }
        }
        return new Int16Array(output);
    }

    quantize(sample) {
        return Math.round(sample * (sample < 0 ? 32768 : 32767));
    }

    flush() {
        if (this.weight <= 1e-9) return new Int16Array();
        const output = new Int16Array([this.quantize(this.sum / this.weight)]);
        this.sum = 0;
        this.weight = 0;
        return output;
    }
}

// This guard also lets Node import the real resampler for golden audio tests.
if (typeof AudioWorkletProcessor !== 'undefined') {
    class DictationAudioProcessor extends AudioWorkletProcessor {
        constructor() {
            super();
            this.resampler = new PCM16Resampler(sampleRate);
            this.frame = new Int16Array(8000);
            this.used = 0;
            this.stopped = false;
            this.levelEnergy = 0;
            this.levelSamples = 0;
            this.port.onmessage = event => {
                if (event.data?.type !== 'flush' || this.stopped) return;
                this.stopped = true;
                this.accept(this.resampler.flush());
                this.sendFrame();
                this.port.postMessage({ type: 'flushed' });
            };
        }

        accept(samples) {
            for (let index = 0; index < samples.length; index++) {
                this.frame[this.used++] = samples[index];
                if (this.used === this.frame.length) this.sendFrame();
            }
        }

        sendFrame() {
            if (!this.used) return;
            const bytes = new ArrayBuffer(this.used * 2);
            const view = new DataView(bytes);
            for (let index = 0; index < this.used; index++) view.setInt16(index * 2, this.frame[index], true);
            this.port.postMessage({ type: 'audio', buffer: bytes }, [bytes]);
            this.used = 0;
        }

        process(inputs) {
            if (this.stopped) return true;
            const channels = inputs[0];
            if (!channels?.length || !channels[0].length) return true;
            const mono = new Float32Array(channels[0].length);
            for (const channel of channels) for (let index = 0; index < mono.length; index++) mono[index] += channel[index] / channels.length;
            for (const sample of mono) this.levelEnergy += Number.isFinite(sample) ? sample * sample : 0;
            this.levelSamples += mono.length;
            // Local visual feedback at 10 Hz, independent of transcription and
            // the network. Never send level messages to the speech service.
            if (this.levelSamples >= sampleRate / 10) {
                this.port.postMessage({ type: 'level', value: Math.min(1, Math.sqrt(this.levelEnergy / this.levelSamples) * 5) });
                this.levelEnergy = 0;
                this.levelSamples = 0;
            }
            this.accept(this.resampler.push(mono));
            return true;
        }
    }
    registerProcessor('dictation-audio', DictationAudioProcessor);
}
