import { EventEmitter } from 'events';
export default class WebMicrophone extends EventEmitter {
    private active;
    private sampleRate;
    private audioContext;
    private inputStream;
    private recorder;
    constructor(mediaStream: MediaStream, messagePort: MessagePort);
    start(): Promise<void>;
    stop(): void;
    destroy(): void;
}
