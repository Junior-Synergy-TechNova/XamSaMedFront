import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Tag } from '../tag/tag';

/* Légende du code couleur péremption, affichée au-dessus des tableaux de stock. */
@Component({
  selector: 'pf-expiry-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Tag],
  templateUrl: './expiry-legend.html',
  styleUrl: './expiry-legend.css',
})
export class ExpiryLegend {}
