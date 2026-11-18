import type { Theme } from '../types';

const KIND_NAME: Record<Theme['kind'], string> = { OP: 'Opening', ED: 'Ending', IN: 'Insert song' };

/**
 * "Opening 3", "Ending 1", "Insert song 2": the theme spelled out from its
 * kind and sequence. A slug suffix beyond `OP3` (AnimeThemes' "OP1-v2",
 * "ED-BD") is kept in brackets so two versions stay distinguishable.
 */
export function themeLabel(theme: Pick<Theme, 'kind' | 'sequence' | 'slug'>): string {
  const base = theme.sequence > 0 ? `${KIND_NAME[theme.kind]} ${theme.sequence}` : KIND_NAME[theme.kind];
  const suffix = theme.slug.replace(/^(?:OP|ED|IN)\d*/i, '').replace(/^[-_\s]+/, '');
  return suffix ? `${base} (${suffix})` : base;
}
