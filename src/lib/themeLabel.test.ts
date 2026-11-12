import { describe, expect, it } from 'vitest';
import { themeLabel } from './themeLabel';

describe('themeLabel', () => {
  it.each([
    [{ kind: 'OP', sequence: 3, slug: 'OP3' }, 'Opening 3'],
    [{ kind: 'ED', sequence: 1, slug: 'ED1' }, 'Ending 1'],
    [{ kind: 'IN', sequence: 2, slug: 'IN2' }, 'Insert song 2'],
    [{ kind: 'OP', sequence: 0, slug: 'OP' }, 'Opening'],
    [{ kind: 'OP', sequence: 1, slug: 'OP1-v2' }, 'Opening 1 (v2)'],
    [{ kind: 'ED', sequence: 2, slug: 'ED2-BD' }, 'Ending 2 (BD)'],
  ] as const)('%o → %s', (theme, label) => {
    expect(themeLabel(theme)).toBe(label);
  });
});
