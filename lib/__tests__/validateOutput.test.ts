import { describe, it, expect } from "vitest";
import { validateStrudelCode, ValidationConfig } from "../validateOutput";

describe("validateStrudelCode", () => {
  // helper to create valid base code (needs 5+ non-empty, non-comment lines)
  const validCode = (extra = "") => `setcpm(120)
$: note("c4 e4 g4").s("piano").gain(0.5)
$: s("bd sd bd sd").gain(0.4)
$: note("e4 g4 b4").s("sine").gain(0.3)
$: s("hh*8").gain(0.2)
${extra}`;

  describe("valid code", () => {
    it("accepts well-formed strudel code", () => {
      const result = validateStrudelCode(validCode());
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("accepts code with multiple voices", () => {
      const code = `setcpm(90)
$: note("c4").s("sine")
$: note("e4").s("triangle")
$: s("bd")
$: s("hh*4")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(true);
    });
  });

  describe("voice limits", () => {
    it("rejects too many voices", () => {
      // With maxVoices now 8, exceed by using 9 voices
      const code = `setcpm(120)
$: note("c4").s("piano")
$: note("d4").s("piano")
$: note("e4").s("piano")
$: note("f4").s("piano")
$: note("g4").s("piano")
$: note("a4").s("piano")
$: note("b4").s("piano")
$: s("bd")
$: s("hh*4")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("too many voices"))).toBe(true);
    });

    it("respects custom voice limit", () => {
      const code = `setcpm(120)
$: note("c4").s("piano")
$: note("d4").s("piano")
$: note("e4").s("piano")`;

      const config: Partial<ValidationConfig> = { maxVoices: 2 };
      const result = validateStrudelCode(code, config);
      expect(result.valid).toBe(false);
    });
  });

  describe("setcpm requirement", () => {
    it("rejects code without setcpm", () => {
      const code = `$: note("c4").s("piano")
$: s("bd sd")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("missing setcpm"))).toBe(true);
    });

    it("allows code without setcpm when disabled", () => {
      const code = `$: note("c4").s("piano")
$: s("bd sd bd sd bd sd")`;

      const config: Partial<ValidationConfig> = { requireSetcpm: false };
      const result = validateStrudelCode(code, config);
      // should only fail on "too short" not setcpm
      expect(result.issues.some((i) => i.includes("missing setcpm"))).toBe(false);
    });
  });

  describe("code length", () => {
    it("rejects code that is too short", () => {
      const code = `setcpm(120)
$: s("bd")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("too short"))).toBe(true);
    });
  });

  describe("forbidden samples", () => {
    it("rejects localhost samples", () => {
      const code = `setcpm(120)
samples("http://localhost:8080/samples")
$: s("mysample").gain(0.5)
$: note("c4").s("piano")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("localhost") || i.includes("external"))).toBe(true);
    });

    it("rejects external URL samples", () => {
      const code = `setcpm(120)
samples("https://example.com/samples")
$: s("mysample").gain(0.5)
$: note("c4").s("piano")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
    });
  });

  describe("randomness limits", () => {
    it("rejects excessive random usage", () => {
      // maxRandomUsage increased to 15; exceed with 16 rand() usages
      const code = `setcpm(120)
$: s("bd").gain(rand()).delay(rand()).room(rand()).hpf(rand()).lpf(rand()).lpq(rand()).pan(rand()).shape(rand())
$: note("c4").s("piano").gain(rand()).delay(rand()).room(rand()).crush(rand()).coarse(rand()).shape(rand()).pan(rand()).lpf(rand())`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("randomness"))).toBe(true);
    });
  });

  describe("extreme effects", () => {
    it("warns about high delay feedback", () => {
      const code = `setcpm(120)
$: note("c4").s("piano").delayfeedback(0.9)
$: s("bd sd bd sd bd sd")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("extreme effect"))).toBe(true);
    });

    it("warns about high room values", () => {
      // maxRoomSize increased to 0.95; exceed with 0.96
      const code = `setcpm(120)
$: note("c4").s("piano").room(0.96)
$: s("bd sd bd sd bd sd")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("extreme effect"))).toBe(true);
    });
  });

  describe("invalid method usage", () => {
    it("rejects string literal method calls", () => {
      const code = `setcpm(120)
$: s("bd").struct("1 0 1 0".euclidean(5, 8))
$: s("hh")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("string literal method"))).toBe(true);
    });

    it("rejects .resonance() method", () => {
      const code = `setcpm(120)
$: note("c4").s("piano").resonance(0.2)
$: s("bd sd bd sd bd sd")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("resonance"))).toBe(true);
    });

    it("rejects .note() method", () => {
      const code = `setcpm(120)
$: note("c4").s("piano").note(0)
$: s("bd sd bd sd bd sd")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes(".note"))).toBe(true);
    });

    it("rejects .euclidean() method", () => {
      const code = `setcpm(120)
$: s("bd").euclidean(5, 8)
$: s("hh")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("euclidean"))).toBe(true);
    });
  });

  describe("syntax issues", () => {
    it("catches unbalanced parentheses", () => {
      const code = `setcpm(120)
$: note("c4".s("piano")
$: s("bd sd bd sd bd sd")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("unbalanced parentheses"))).toBe(true);
    });

    it("catches unbalanced brackets", () => {
      const code = `setcpm(120)
$: note("[c4 e4 g4").s("piano")
$: s("bd sd bd sd bd sd")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("unbalanced brackets"))).toBe(true);
    });

    it("catches unbalanced angle brackets in patterns", () => {
      const code = `setcpm(120)
$: note("<c4 e4 g4").s("piano")
$: s("bd sd bd sd bd sd")`;

      const result = validateStrudelCode(code);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes("unbalanced mini-notation"))).toBe(true);
    });
  });

});
