// Types the vendored node-carplay .d.ts files expect. Buffer and 'events'
// already come from @types/node (vite.config.ts pulls it into this project);
// WebUSB's types come from @types/w3c-web-usb.
/// <reference types="w3c-web-usb" />
export {};
