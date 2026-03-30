export interface OutputValidationResult {
  warnings: string[];
  sanitized: string;
}

const OUTPUT_LEAK_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  {
    regex: /BOUNDARY_[a-f0-9]{16}/i,
    description: 'boundary nonce leak',
  },
];

export function validateOutput(text: string): OutputValidationResult {
  const warnings: string[] = [];

  for (const { regex, description } of OUTPUT_LEAK_PATTERNS) {
    if (regex.test(text)) {
      warnings.push(description);
    }
  }

  // Redact boundary nonces if leaked
  const sanitized = text.replace(/BOUNDARY_[a-f0-9]{16}/gi, '[REDACTED]');

  return { warnings, sanitized };
}
