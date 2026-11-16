import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const TAG_CLASS: Record<string, string> = {
  ok: 'chip-green', low: 'chip-amber', crit: 'chip-red',
  out: 'chip-red', vue: 'chip-gray', new: 'chip-blue',
  // Teintes de catégorie (ex. type de mouvement) — le point coloré reste le même langage.
  green: 'chip-green', blue: 'chip-blue', amber: 'chip-amber', red: 'chip-red', gray: 'chip-gray',
  violet: 'chip-violet', teal: 'chip-teal', sky: 'chip-sky', rose: 'chip-rose',
};

/* Chip d'état (statut de stock, urgence, tension…) */
@Component({
  selector: 'pf-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tag.html',
  styleUrl: './tag.css',
})
export class Tag {
  readonly s = input.required<string>();
  readonly cls = computed(() => TAG_CLASS[this.s()] || 'chip-gray');
}
