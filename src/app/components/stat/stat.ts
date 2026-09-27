import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Icon } from '../icon/icon';

/* Cellule d'indicateur (libellé + valeur + delta) — s'insère dans la bande .pf-statgrid */
@Component({
  selector: 'pf-stat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './stat.html',
  styleUrl: './stat.css',
})
export class Stat {
  readonly icon = input.required<string>();
  readonly label = input('');
  readonly value = input<string | number>('');
  readonly delta = input('');
  readonly deltaUp = input(false);
  readonly tone = input<'blue' | 'green' | 'red' | 'amber'>('blue');
  /** Un indicateur rouge / orange n'attire l'œil que s'il y a quelque chose à traiter. */
  readonly attention = computed(() => {
    const v = this.value();
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, ''));
    return (this.tone() === 'red' || this.tone() === 'amber') && !(n === 0);
  });
}
