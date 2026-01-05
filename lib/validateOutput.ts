// validates generated strudel code for coherence and safety
// guards against chaotic, unmusical, or broken compositions
// UPDATED: optimized for complex experimental electronic music generation

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

export interface ValidationConfig {
  maxVoices: number;
  maxLines: number;
  maxRandomUsage: number;
  maxEffectsPerVoice: number;
  requireSetcpm: boolean;
  rejectLocalhost: boolean;
  maxDelayFeedback: number;
  maxRoomSize: number;
}

// DEFAULT CONFIG - optimized for Autechre-style experimental compositions
const DEFAULT_CONFIG: ValidationConfig = {
  maxVoices: 8, // increased to allow complex layering (3-4 melodic + percussion layers)
  maxLines: 250, // slightly increased for intricate compositions
  maxRandomUsage: 15, // significantly increased for organic variation and instability
  maxEffectsPerVoice: 8, // increased to allow rich effect chains
  requireSetcpm: true,
  rejectLocalhost: true,
  maxDelayFeedback: 0.7, // increased to allow creative feedback effects (was 0.5)
  maxRoomSize: 0.95, // increased to allow spacious ambient fields (was 0.8)
};

// count voice assignments ($: patterns)
function countVoices(code: string): number {
  const matches = code.match(/\$:/g);
  return matches ? matches.length : 0;
}

// count non-empty, non-comment lines
function countLines(code: string): number {
  const lines = code.split("\n");
  return lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//");
  }).length;
}

// check if code uses setcpm
function hasSetcpm(code: string): boolean {
  return /setcpm\s*\(/i.test(code);
}

// check for localhost or any remote samples
function hasForbiddenSamples(code: string): boolean {
  if (/samples?\s*\(\s*['"`]https?:\/\/localhost/i.test(code)) return true;
  if (/samples?\s*\(\s*['"`]https?:\/\//i.test(code)) return true;
  if (/await\s+samples?\s*\(/i.test(code)) return true;
  return false;
}

// detect invalid method usage that will throw at runtime
function findInvalidMethodUsage(code: string): string[] {
  const issues: string[] = [];
  const codeWithoutComments = code
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

  if (/\.\s*note\s*\(/.test(codeWithoutComments)) {
    issues.push("invalid method .note(...) - use note(...) or .detune(...) instead");
  }

  if (/\.\s*resonance\s*\(/.test(codeWithoutComments)) {
    issues.push("invalid method .resonance(...) - use .lpq(...) instead");
  }

  if (/\.\s*euclidean\s*\(/.test(codeWithoutComments)) {
    issues.push("invalid method .euclidean(...) - not available in this build");
  }

  // e.g. \"1 0 1 0\".euclidean(5, 8) or \"1 0 1 0\".slow(4)
  const stringMethodPattern = /(["'])(?:\\.|(?!\1).)*\1\s*\.\s*[a-zA-Z_]\w*\s*\(/;
  if (stringMethodPattern.test(codeWithoutComments)) {
    issues.push("string literal method call detected - apply transforms to patterns, not strings");
  }

  return issues;
}

// count randomness usage (rand, irand, perlin with high frequency, etc.)
function countRandomUsage(code: string): number {
  let count = 0;

  // count rand/irand calls
  const randMatches = code.match(/\b(rand|irand)\s*\(/g);
  if (randMatches) count += randMatches.length;

  // count perlin calls
  const perlinMatches = code.match(/\bperlin\b/g);
  if (perlinMatches) count += perlinMatches.length;

  // count sometimesBy/rarely/etc (probability-based randomness)
  const probMatches = code.match(
    /\.(sometimesBy|sometimes|rarely|almostNever|almostAlways|choose|chooseCycles)\s*\(/g
  );
  if (probMatches) count += probMatches.length;

  return count;
}

// check for extreme effect values with updated thresholds
function hasExtremeEffects(code: string, config: ValidationConfig): boolean {
  // delay feedback check with configurable threshold
  const feedbackMatch = code.match(/\.delayfeedback\s*\(\s*([\d.]+)/g);
  if (feedbackMatch) {
    for (const match of feedbackMatch) {
      const value = parseFloat(match.replace(/\.delayfeedback\s*\(\s*/, ""));
      if (value > config.maxDelayFeedback) return true;
    }
  }

  // room size check with configurable threshold
  const roomMatch = code.match(/\.room\s*\(\s*([\d.]+)/g);
  if (roomMatch) {
    for (const match of roomMatch) {
      const value = parseFloat(match.replace(/\.room\s*\(\s*/, ""));
      if (value > config.maxRoomSize) return true;
    }
  }

  // check for dangerous gain values (>2.0 can cause clipping)
  const gainMatch = code.match(/\.gain\s*\(\s*([\d.]+)/g);
  if (gainMatch) {
    for (const match of gainMatch) {
      const value = parseFloat(match.replace(/\.gain\s*\(\s*/, ""));
      if (value > 2.0) return true;
    }
  }

  return false;
}

// check for obvious syntax issues - returns specific error message or null
function getSyntaxIssue(code: string): string | null {
  // unbalanced parentheses
  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    return `unbalanced parentheses: ${openParens} opening '(' vs ${closeParens} closing ')'`;
  }

  // unbalanced brackets
  const openBrackets = (code.match(/\[/g) || []).length;
  const closeBrackets = (code.match(/\]/g) || []).length;
  if (openBrackets !== closeBrackets) {
    return `unbalanced brackets: ${openBrackets} opening '[' vs ${closeBrackets} closing ']'`;
  }

  // unbalanced braces
  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    return `unbalanced braces: ${openBraces} opening '{' vs ${closeBraces} closing '}'`;
  }

  // unbalanced mini-notation angle brackets < > (inside string literals)
  const stringContents = code.match(/["'`][^"'`]*["'`]/g) || [];
  for (const str of stringContents) {
    const openAngles = (str.match(/</g) || []).length;
    const closeAngles = (str.match(/>/g) || []).length;
    if (openAngles !== closeAngles) {
      return `unbalanced mini-notation: ${openAngles} opening '<' vs ${closeAngles} closing '>' in pattern`;
    }
  }

  return null;
}

// estimate effects per voice (updated for richer chains)
function checkEffectsDensity(code: string, config: ValidationConfig): boolean {
  const lines = code.split("\n");
  for (const line of lines) {
    if (line.includes("$:")) {
      // count effect methods on this line
      const effectMethods = [
        ".lpf", ".hpf", ".bpf",
        ".delay", ".delaytime", ".delayfeedback",
        ".room", ".size", ".dry",
        ".crush", ".coarse",
        ".shape", ".distort",
        ".vowel", ".hcutoff", ".hresonance",
        ".cutoff", ".resonance",
        ".pan", ".speed",
      ];
      let effectCount = 0;
      for (const effect of effectMethods) {
        const matches = line.match(new RegExp("\\" + effect.replace(".", "\\."), "g"));
        if (matches) effectCount += matches.length;
      }
      // check against configured max
      if (effectCount > config.maxEffectsPerVoice) return true;
    }
  }
  return false;
}

// check for patterns that might cause audio issues
function hasDangerousPatterns(code: string): string | null {
  // extremely fast patterns can cause audio glitches
  const fastMatches = code.match(/\.fast\s*\(\s*(\d+)/g);
  if (fastMatches) {
    for (const match of fastMatches) {
      const value = parseInt(match.replace(/\.fast\s*\(\s*/, ""));
      if (value > 64) {
        return "extremely fast pattern detected (>64x) - may cause audio glitches";
      }
    }
  }

  // check for dangerously high note values
  const noteMatches = code.match(/note\s*\(\s*"[^"]*"/g);
  if (noteMatches) {
    for (const match of noteMatches) {
      // check for notes beyond reasonable range (c-1 to c9)
      if (/[a-g][#b]?[9]/.test(match.toLowerCase())) {
        return "extremely high note values detected - may cause issues";
      }
    }
  }

  return null;
}

export function validateStrudelCode(
  code: string,
  config: Partial<ValidationConfig> = {}
): ValidationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const issues: string[] = [];

  // check voice count
  const voiceCount = countVoices(code);
  if (voiceCount > cfg.maxVoices) {
    issues.push(
      `too many voices (${voiceCount}/${cfg.maxVoices} max) - simplify to fewer tracks`
    );
  }

  // check line count
  const lineCount = countLines(code);
  if (lineCount > cfg.maxLines) {
    issues.push(
      `code too long (${lineCount}/${cfg.maxLines} lines max) - simplify`
    );
  }

  // must have at least some code
  if (lineCount < 5) {
    issues.push("code too short - add more content");
  }

  // check setcpm
  if (cfg.requireSetcpm && !hasSetcpm(code)) {
    issues.push("missing setcpm() - set tempo at the start");
  }

  // check forbidden samples
  if (cfg.rejectLocalhost && hasForbiddenSamples(code)) {
    issues.push("uses external/localhost samples - only use built-in samples");
  }

  // check randomness with increased threshold
  const randomUsage = countRandomUsage(code);
  if (randomUsage > cfg.maxRandomUsage) {
    issues.push(
      `excessive randomness (${randomUsage}/${cfg.maxRandomUsage} max) - reduce variation techniques`
    );
  }

  // check for extreme effects with updated thresholds
  if (hasExtremeEffects(code, cfg)) {
    issues.push(
      `extreme effect values detected - reduce delay feedback (max ${cfg.maxDelayFeedback}), reverb (max ${cfg.maxRoomSize}), or gain (max 2.0)`
    );
  }

  // check for syntax issues
  const syntaxIssue = getSyntaxIssue(code);
  if (syntaxIssue) {
    issues.push(syntaxIssue);
  }

  // check for invalid method usage
  const invalidMethodIssues = findInvalidMethodUsage(code);
  issues.push(...invalidMethodIssues);

  // check effects density with updated threshold
  if (checkEffectsDensity(code, cfg)) {
    issues.push(`too many effects on a single voice (max ${cfg.maxEffectsPerVoice}) - simplify effect chains`);
  }

  // check for dangerous patterns
  const dangerousPattern = hasDangerousPatterns(code);
  if (dangerousPattern) {
    issues.push(dangerousPattern);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
