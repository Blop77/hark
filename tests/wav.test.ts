import { describe, expect, it } from "vitest";
import { encodeWav, silence } from "../src/lib/wav";

describe("encodeWav", () => {
  it("writes a valid 16-bit mono header and clamps samples", () => {
    const buf = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([2])], 24000);
    const v = new DataView(buf);
    const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(buf, o, n));
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(40, true)).toBe(8);
    expect(buf.byteLength).toBe(44 + 8);
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(32767);
    expect(v.getInt16(48, true)).toBe(-32768);
    expect(v.getInt16(50, true)).toBe(32767); // clamped from 2
  });

  it("makes silence of the right length", () => {
    expect(silence(0.5, 24000).length).toBe(12000);
  });
});
