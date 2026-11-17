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
import { Observable, finalize } from 'rxjs';

type UrgencyKey = 'crit' | 'high' | 'normal';
const URGENCY: Record<UrgencyKey, { label: string; tone: string }> = {
  crit: { label: 'Critique', tone: 'red' },
  high: { label: 'Élevée', tone: 'amber' },
  normal: { label: 'Normale', tone: 'blue' },
};
/** Le backend envoie « Critique », « Élevé » ou « Normal » (meta.urgency), casse et accents variables. */
function urgKey(u: string): UrgencyKey {
  const k = u.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return k.startsWith('crit') ? 'crit' : k.startsWith('elev') || k.startsWith('haut') || k === 'high' ? 'high' : 'normal';
}
const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'En attente', tone: 'sky' },
  confirmed: { label: 'Confirmée — à retirer', tone: 'green' },
  oriented: { label: 'Orientée', tone: 'violet' },
  collected: { label: 'Retirée', tone: 'teal' },
  cancelled: { label: 'Annulée', tone: 'rose' },
  expired: { label: 'Expirée', tone: 'gray' },
  rejected: { label: 'Refusée', tone: 'rose' },
};

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
  /** Stocks des autres officines non lus : « Réessayer », pas « aucune officine ne dispose… ». */
  readonly orientError = signal(false);
  /** Demandes dont une action est en cours d'envoi : boutons désactivés, pas de double envoi sur réseau lent. */
  readonly busy = signal<ReadonlySet<number>>(new Set());

  /** Exécute une action une seule fois par demande à la fois. */
  private run(id: number, call: Observable<unknown>, onDone: () => void, failure: string): void {
    if (this.busy().has(id)) return;
    this.busy.update(set => new Set(set).add(id));
    call.pipe(finalize(() => this.busy.update(set => { const next = new Set(set); next.delete(id); return next; }))).subscribe({
      next: onDone,
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, failure), 'alert'),
    });
  }
  /** Précise l'origine des distances affichées (officine connectée ou position de référence). */
  readonly originLabel = computed(() => structurePoint(this.auth.user()?.structure) ? ' depuis votre officine' : '');

  private apiError(e: HttpErrorResponse, fallback: string): string {
    return (e.error as ApiErrorBody | null)?.message ?? fallback;
  }

  /** Type de demandeur en texte coloré : patient bleu ciel, hôpital rose, officine teal. */
  typeTone(type: string): string { return type === 'Hôpital' ? 'rose' : type === 'Patient' ? 'sky' : 'teal'; }
  typeIcon(type: string): string { return type === 'Hôpital' ? 'hospital' : type === 'Patient' ? 'user' : 'pill'; }
  /** Urgence : critique = rouge, élevée = ambre, normale = bleu (clé `pf-tag` / `.pf-liic`). */
  urgTone(u: string): string { return URGENCY[urgKey(u)].tone; }
  urgLabel(u: string): string { return URGENCY[urgKey(u)].label; }
  /** État d'une demande traitée : chaque issue a sa teinte (rouge réservé à l'urgence critique). */
  statusTone(s: string): string { return STATUS[s]?.tone ?? 'gray'; }
  statusLabel(s: string): string { return STATUS[s]?.label ?? s; }

  accept(id: number): void {
    this.run(id, this.pharmacy.acceptDemande(id), () => { this.platform.notify('Demande acceptée et confirmée', 'ok'); this.changed.emit(); }, 'Échec de l’acceptation');
  }

  startOrient(d: DemandeRow): void {
    this.orient.set(d.id);
    this.orientOptions.set([]);
    if (!d.medId) { this.platform.notify('Médicament inconnu pour cette demande', 'alert'); return; }
    this.orientLoading.set(true);
    this.orientError.set(false);
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
      error: () => { this.orientLoading.set(false); this.orientError.set(true); },
    });
  }

  doOrient(d: DemandeRow, p: AvailabilityRow): void {
    this.run(d.id, this.pharmacy.orientDemande(d.id, p.structureId), () => { this.orient.set(null); this.platform.notify('Patient orienté vers ' + p.pharmacy, 'info'); this.changed.emit(); }, 'Échec de l’orientation');
  }

  collect(id: number): void {
    this.run(id, this.pharmacy.collectDemande(id), () => { this.platform.notify('Retrait finalisé', 'ok'); this.changed.emit(); }, 'Échec de la finalisation');
  }
}
