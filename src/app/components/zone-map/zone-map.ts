import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ZoneInfo } from '../../interfaces/models';

/* Carte des zones (tensions d'approvisionnement) — distrib + santé publique */
@Component({
  selector: 'pf-zone-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './zone-map.html',
  styleUrl: './zone-map.css',
})
export class ZoneMap {
  readonly zones = input<ZoneInfo[]>([]);
  readonly selected = input<string | null>(null);
  readonly sel = output<string>();
}
