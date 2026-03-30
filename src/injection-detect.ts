export interface InjectionFlag {
  pattern: string;
  description: string;
}

const INJECTION_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  {
    regex: /ignore\s+(all\s+)?previous\s+instructions/i,
    description: 'instruction override',
  },
  { regex: /you\s+are\s+now\s+/i, description: 'role reassignment' },
  { regex: /^system\s*:/im, description: 'fake system message' },
  {
    regex: /^(admin|root|developer)\s*(override|mode|access)/im,
    description: 'privilege escalation',
  },
  {
    regex: /reveal\s+(your\s+)?(system\s+prompt|instructions|claude\.?md)/i,
    description: 'prompt extraction',
  },
  {
    regex: /pretend\s+(you\s+are|to\s+be)\s/i,
    description: 'identity override',
  },
  {
    regex: /do\s+not\s+follow\s+(your\s+)?(rules|instructions|guidelines)/i,
    description: 'rule bypass',
  },
  {
    regex: /disregard\s+(all\s+)?(prior|previous|above)/i,
    description: 'instruction override',
  },
  { regex: /new\s+instructions?\s*:/i, description: 'instruction injection' },
];

export function detectInjectionPatterns(content: string): InjectionFlag[] {
  const flags: InjectionFlag[] = [];
  for (const { regex, description } of INJECTION_PATTERNS) {
    if (regex.test(content)) {
      flags.push({ pattern: regex.source, description });
    }
  }
  return flags;
}
