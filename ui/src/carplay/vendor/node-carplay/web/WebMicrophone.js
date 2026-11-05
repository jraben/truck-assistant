import { EventEmitter } from 'events';
export default class WebMicrophone extends EventEmitter {
    active = false;
    sampleRate = 16000;
    audioContext;
    inputStream;
    recorder = null;
    constructor(mediaStream, messagePort) {
        super();
        const audioContext = new AudioContext({ sampleRate: this.sampleRate });
        this.inputStream = audioContext.createMediaStreamSource(mediaStream);
        this.audioContext = audioContext;
        audioContext.audioWorklet
            .addModule(new URL('./recorder.worklet.js', import.meta.url))
            .then(() => {
            this.recorder = new AudioWorkletNode(audioContext, 'recorder.worklet');
            this.recorder.port.postMessage(messagePort, [messagePort]);
        });
    }
    async start() {
        if (!this.recorder)
            return;
        console.debug('starting mic');
        this.active = true;
        this.inputStream
            .connect(this.recorder)
            .connect(this.audioContext.destination);
    }
    stop() {
        if (!this.recorder)
            return;
        console.debug('stopping mic');
        this.active = false;
        this.inputStream.disconnect();
        this.recorder.disconnect();
    }
    destroy() {
        if (!this.recorder)
            return;
        this.inputStream.disconnect();
        this.recorder.disconnect();
        this.recorder = null;
        this.audioContext.close();
    }
}
