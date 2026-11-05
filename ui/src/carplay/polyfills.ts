// node-carplay was written for Node and uses the global Buffer. The npm
// `buffer` package is the browser stand-in; `events` is imported directly by
// the vendored code. Import this module before the vendored code runs.
import { Buffer as BufferImpl } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof BufferImpl };
if (!g.Buffer) g.Buffer = BufferImpl;

export {};
