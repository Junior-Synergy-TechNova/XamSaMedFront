import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/* Barre de progression (quantité vs seuil, tension, etc.) */
@Component({
  selector: 'pf-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bar.html',
  styleUrl: './bar.css',
})
export class Bar {
  readonly pct = input(0);
  readonly tone = input<'green' | 'amber' | 'red' | 'blue'>('green');
  /** Nom annoncé par les lecteurs d'écran (la valeur en % est lue en plus). */
  readonly label = input('Niveau');
  /** Position (en %) d'un repère vertical, ex. le seuil d'alerte. */
  readonly marker = input<number | null>(null);
  /** Valeur lue par les lecteurs d'écran à la place du pourcentage (ex. « 90 unités, seuil 80 »). */
  readonly valueText = input<string | null>(null);
  readonly valueNow = computed(() => Math.round(Math.min(100, Math.max(0, this.pct()))));
}
