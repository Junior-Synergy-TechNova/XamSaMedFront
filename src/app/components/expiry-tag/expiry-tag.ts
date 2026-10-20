import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Tag } from '../tag/tag';
import { ExpiryLevel } from '../../interfaces/models';

/** Couleur de pastille par niveau de péremption (StockLedger::expiry côté API). */
const EXPIRY_TONE: Record<ExpiryLevel, string> = {
  ok: 'ok', warn: 'low', crit: 'crit', expired: 'crit', none: 'vue',
};

/** Compte à rebours affiché sous 3 mois (même seuil que le niveau « warn »). */
const COUNTDOWN_DAYS = 90;

/* Date de péremption en code couleur : vert > 3 mois, orange < 3 mois,
   rouge < 1 mois ou périmé — même rendu dans tous les espaces (pharmacie, hôpital). */
@Component({
  selector: 'pf-expiry',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Tag, DatePipe],
  templateUrl: './expiry-tag.html',
  styleUrl: './expiry-tag.css',
})
export class ExpiryTag {
  readonly level = input.required<ExpiryLevel>();
  readonly date = input<string | null>(null);
  readonly days = input<number | null>(null);

  readonly tone = computed(() => EXPIRY_TONE[this.level()]);
  readonly countdown = computed(() => {
    const d = this.days();
    return this.level() !== 'expired' && d !== null && d < COUNTDOWN_DAYS ? `J-${d}` : null;
  });
}
