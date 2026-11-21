import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Icon } from '../icon/icon';

export interface ActiveFilter { key: string; label: string }

/**
 * Ligne « Filtres cumulés : A et B — Tout effacer » sous une barre de filtres :
 * rend visible la combinaison qui explique un résultat court ou vide. Chaque puce retire son filtre.
 */
@Component({
  selector: 'pf-active-filters',
  imports: [Icon],
  templateUrl: './active-filters.html',
  styleUrl: './active-filters.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActiveFilters {
  readonly filters = input.required<readonly ActiveFilter[]>();
  readonly remove = output<string>();
  readonly clear = output<void>();
}
