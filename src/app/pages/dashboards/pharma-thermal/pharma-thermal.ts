import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Tag } from '../../../components/tag/tag';
import { TableLabels } from '../../../directives/table-labels/table-labels';
import { PharmacyService } from '../../../services/pharmacy/pharmacy';
import { ApiErrorBody, ApiPharmacyThermalItem, ApiPharmacyThermalStatus } from '../../../interfaces/api';

/** Pourquoi l'écran ne peut rien comparer : service absent, officine non localisée, ou panne. */
type LoadProblem = { kind: 'unavailable' } | { kind: 'no-location'; message: string } | { kind: 'error' };

/** Écart sous le maximum en dessous duquel une référence est « proche du seuil ». */
const NEAR_MARGIN_C = 2;
/** Valeur posée par le backend tant qu'aucun pharmacien n'a validé la règle : ce n'est pas une source. */
const SOURCE_PENDING = 'à valider';

interface ThermalRow {
  item: ApiPharmacyThermalItem;
  label: string;
  /** Température extérieure − maximum supporté (positif = au-dessus). */
  gap: number | null;
  near: boolean;
  /** Source réelle de la règle (notice, ARP, OMS), null si non renseignée ou « à valider ». */
  source: string | null;
}

/* ============================================================
   PHARMACIEN — Conservation thermique du stock
   (GET /pharmacy/thermal-status : météo de la zone × règles de conservation)
   ============================================================ */
@Component({
  selector: 'app-pharma-thermal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card, PageHead, Stat, Tag, TableLabels, DatePipe, DecimalPipe],
  templateUrl: './pharma-thermal.html',
  styleUrl: './pharma-thermal.css',
})
export class PharmaThermal {
  private readonly api = inject(PharmacyService);

  readonly status = signal<ApiPharmacyThermalStatus | null>(null);
  readonly problem = signal<LoadProblem | null>(null);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly nearMargin = NEAR_MARGIN_C;

  constructor() { this.load(); }

  load(): void {
    // Après le premier chargement, on garde l'écran affiché pendant l'actualisation.
    if (this.status()) this.refreshing.set(true); else this.loading.set(true);
    this.api.thermalStatus().subscribe({
      next: s => { this.status.set(s); this.problem.set(null); this.loading.set(false); this.refreshing.set(false); },
      error: (e: HttpErrorResponse) => {
        this.loading.set(false);
        this.refreshing.set(false);
        this.problem.set(
          e.status === 404 ? { kind: 'unavailable' }
          : e.status === 422 ? { kind: 'no-location', message: (e.error as ApiErrorBody | null)?.message ?? 'La position de l\'officine n\'est pas enregistrée.' }
          : { kind: 'error' });
      },
    });
  }

  private readonly rows = computed<ThermalRow[]>(() => {
    const s = this.status();
    if (!s) return [];
    return s.data.map(item => {
      const gap = s.current_temp_c === null ? null : Math.round((s.current_temp_c - item.max_temp_c) * 10) / 10;
      return {
        item,
        label: item.dosage ? `${item.medicine} — ${item.dosage}${item.form ? ' (' + item.form + ')' : ''}` : item.medicine,
        gap,
        near: !item.at_risk && gap !== null && gap > -NEAR_MARGIN_C,
        source: item.source && item.source.trim().toLowerCase() !== SOURCE_PENDING ? item.source : null,
      };
    });
  });

  /** Ambiant : au-dessus du seuil d'abord, puis les plus proches du seuil (plus petit maximum). */
  readonly roomRows = computed(() => this.rows()
    .filter(r => r.item.storage === 'room')
    .sort((a, b) => Number(b.item.at_risk) - Number(a.item.at_risk) || Number(b.near) - Number(a.near) || a.item.max_temp_c - b.item.max_temp_c || a.label.localeCompare(b.label, 'fr')));

  readonly fridgeRows = computed(() => this.rows()
    .filter(r => r.item.storage === 'fridge')
    .sort((a, b) => a.label.localeCompare(b.label, 'fr')));

  readonly counts = computed(() => ({
    watched: this.rows().length,
    atRisk: this.roomRows().filter(r => r.item.at_risk).length,
    near: this.roomRows().filter(r => r.near).length,
    fridge: this.fridgeRows().length,
    unvalidated: this.rows().filter(r => !r.item.validated).length,
  }));

  readonly atRiskNames = computed(() => {
    const names = this.roomRows().filter(r => r.item.at_risk).map(r => r.item.medicine);
    return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} et ${names.length - 3} autres`;
  });

  plural(n: number, one: string, many: string): string { return `${n} ${n > 1 ? many : one}`; }

  gapLabel(gap: number | null): string {
    if (gap === null) return '—';
    return gap > 0 ? `+${gap.toLocaleString('fr')} °C` : `${gap.toLocaleString('fr')} °C`;
  }
}
