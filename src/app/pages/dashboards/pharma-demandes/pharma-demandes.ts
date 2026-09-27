import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Tag } from '../../../components/tag/tag';
import { PlatformState } from '../../../services/platform/platform';
import { PharmacyService } from '../../../services/pharmacy/pharmacy';
import { MedicineService } from '../../../services/medicines/medicines';
import { AvailabilityRow, DemandeRow } from '../../../interfaces/models';
import { AuthService } from '../../../services/auth/auth';
import { rankByDistance, structurePoint } from '../../../services/structures/structures';
import { ApiErrorBody } from '../../../interfaces/api';

/* Demandes ciblées reçues par le pharmacien : accepter / orienter / retirer (API réelle). */
@Component({
  selector: 'app-pharma-demandes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card, PageHead, Tag],
  templateUrl: './pharma-demandes.html',
  styleUrl: './pharma-demandes.css',
})
export class PharmaDemandes {
  private readonly platform = inject(PlatformState);
  private readonly pharmacy = inject(PharmacyService);
  private readonly medicines = inject(MedicineService);
  private readonly auth = inject(AuthService);

  readonly demandes = input.required<DemandeRow[]>();
  readonly changed = output<void>();

  /** Demande en cours d'orientation. */
  readonly orient = signal<number | null>(null);
  /**
   * Officines réellement capables de servir la demande : lues via
   * GET /medicines/{id}/availability (stock disponible ≥ quantité demandée),
   * hors officine courante — le backend refuse toute autre cible.
   */
  readonly orientOptions = signal<AvailabilityRow[]>([]);
  readonly orientLoading = signal(false);
  /** Précise l'origine des distances affichées (officine connectée ou position de référence). */
  readonly originLabel = computed(() => structurePoint(this.auth.user()?.structure) ? ' depuis votre officine' : '');

  private apiError(e: HttpErrorResponse, fallback: string): string {
    return (e.error as ApiErrorBody | null)?.message ?? fallback;
  }

  typeIcon(type: string): string { return type === 'Hôpital' ? 'hospital' : type === 'Patient' ? 'user' : 'pill'; }
  urg(u: string): string { return u === 'Critique' ? 'crit' : u === 'Élevé' ? 'low' : 'new'; }
  statusLabel(s: string): string {
    return s === 'oriented' ? 'Orientée' : s === 'collected' ? 'Retirée' : s === 'cancelled' ? 'Annulée' : s;
  }

  accept(id: number): void {
    this.pharmacy.acceptDemande(id).subscribe({
      next: () => { this.platform.notify('Demande acceptée et confirmée', 'ok'); this.changed.emit(); },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec de l’acceptation'), 'alert'),
    });
  }

  startOrient(d: DemandeRow): void {
    this.orient.set(d.id);
    this.orientOptions.set([]);
    if (!d.medId) { this.platform.notify('Médicament inconnu pour cette demande', 'alert'); return; }
    this.orientLoading.set(true);
    const myId = this.auth.user()?.structure_id;
    // Référence des distances : l'officine connectée si elle est géolocalisée
    // (le patient part d'ici), sinon la position de référence par défaut.
    const from = structurePoint(this.auth.user()?.structure);
    this.medicines.availability(d.medId).subscribe({
      next: rows => {
        this.orientLoading.set(false);
        const eligible = rows.filter(r => r.structureId !== myId && r.available >= d.qty);
        this.orientOptions.set(rankByDistance(eligible, from));
      },
      error: () => this.orientLoading.set(false),
    });
  }

  doOrient(d: DemandeRow, p: AvailabilityRow): void {
    this.pharmacy.orientDemande(d.id, p.structureId).subscribe({
      next: () => { this.orient.set(null); this.platform.notify('Patient orienté vers ' + p.pharmacy, 'info'); this.changed.emit(); },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec de l’orientation'), 'alert'),
    });
  }

  collect(id: number): void {
    this.pharmacy.collectDemande(id).subscribe({
      next: () => { this.platform.notify('Retrait finalisé', 'ok'); this.changed.emit(); },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec de la finalisation'), 'alert'),
    });
  }
}
