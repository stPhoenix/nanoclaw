import { describe, it, expect } from 'vitest';

import { validateOutput } from './output-validator.js';

describe('validateOutput', () => {
  it('passes normal output unchanged', () => {
    const result = validateOutput('Here is the answer to your question.');
    expect(result.sanitized).toBe('Here is the answer to your question.');
    expect(result.warnings).toEqual([]);
  });

  it('redacts boundary nonces', () => {
    const result = validateOutput(
      'The boundary is BOUNDARY_a1b2c3d4e5f6a7b8 and it should be secret.',
    );
    expect(result.sanitized).toBe(
      'The boundary is [REDACTED] and it should be secret.',
    );
    expect(result.warnings).toContain('boundary nonce leak');
  });

  it('redacts multiple boundary nonces', () => {
    const result = validateOutput(
      'BOUNDARY_0000000000000000 and BOUNDARY_ffffffffffffffff are nonces.',
    );
    expect(result.sanitized).toBe('[REDACTED] and [REDACTED] are nonces.');
    expect(result.warnings).toHaveLength(1); // one warning for the pattern
  });

  it('is case-insensitive for boundary detection', () => {
    const result = validateOutput('boundary_AABBCCDD11223344');
    expect(result.sanitized).toBe('[REDACTED]');
    expect(result.warnings).toContain('boundary nonce leak');
  });

  it('does not flag text without boundary pattern', () => {
    const result = validateOutput('BOUNDARY_ is not a full nonce');
    expect(result.warnings).toEqual([]);
    expect(result.sanitized).toBe('BOUNDARY_ is not a full nonce');
  });

  it('handles empty string', () => {
    const result = validateOutput('');
    expect(result.sanitized).toBe('');
    expect(result.warnings).toEqual([]);
  });
});
