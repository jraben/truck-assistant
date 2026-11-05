import { VideoData, AudioData, MediaData, Command, DongleDriver, DongleConfig } from '../modules/index.js';
export type CarplayMessage = {
    type: 'plugged';
    message?: undefined;
} | {
    type: 'unplugged';
    message?: undefined;
} | {
    type: 'failure';
    message?: undefined;
} | {
    type: 'audio';
    message: AudioData;
} | {
    type: 'video';
    message: VideoData;
} | {
    type: 'media';
    message: MediaData;
} | {
    type: 'command';
    message: Command;
};
export declare const isCarplayDongle: (device: USBDevice) => boolean;
export declare const findDevice: () => Promise<USBDevice | null>;
export declare const requestDevice: () => Promise<USBDevice | null>;
export default class CarplayWeb {
    private _started;
    private _pairTimeout;
    private _frameInterval;
    private _config;
    dongleDriver: DongleDriver;
    constructor(config: Partial<DongleConfig>);
    private clearPairTimeout;
    private clearFrameInterval;
    onmessage: ((ev: CarplayMessage) => void) | null;
    start: (usbDevice: USBDevice) => Promise<void>;
    stop: () => Promise<void>;
}
