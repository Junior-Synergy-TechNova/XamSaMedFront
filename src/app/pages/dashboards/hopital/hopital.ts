import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, map, switchMap, throwError } from 'rxjs';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Tag } from '../../../components/tag/tag';
import { PartnersPanel, PartnerTypeOption } from '../../../components/partners-panel/partners-panel';
import { IncomingDeliveries } from '../../../components/incoming-deliveries/incoming-deliveries';
import { ExpiryTag } from '../../../components/expiry-tag/expiry-tag';
import { PlatformState } from '../../../services/platform/platform';
import { HospitalService } from '../../../services/hospital/hospital';
import { MedicineService } from '../../../services/medicines/medicines';
import { StructureService } from '../../../services/structures/structures';
import { AuthService } from '../../../services/auth/auth';
import { AlerteHop, CritMedRow } from '../../../interfaces/models';
import { ModalA11y } from '../../../directives/modal-a11y/modal-a11y';
import { FieldLabel } from '../../../directives/field-label/field-label';
import { TableLabels } from '../../../directives/table-labels/table-labels';
import {
  ApiDispensation, ApiDispensationByService, ApiErrorBody, ApiHospitalDashboard, ApiHospitalStockRow, ApiInstitutionalOrder,
  ApiRestockRequest, ApiSupplier, HospitalSeverity,
} from '../../../interfaces/api';

const EMPTY_SET: ReadonlySet<number> = new Set<number>();

/**
 * Niveau tension / rupture d'une ligne de stock : celui recalculé par l'API
 * (rupture = disponible à zéro, tension = disponible ≤ seuil de tension), sinon le statut.
 */
const lineLevel = (s: ApiHospitalStockRow): HospitalSeverity | null =>
  s.alert_level !== undefined ? s.alert_level : s.severity;

/** Lot à surveiller : orange (< 3 mois), rouge (< 1 mois) ou périmé. */
const isExpiring = (s: ApiHospitalStockRow): boolean =>
  s.expiry_level === 'warn' || s.expiry_level === 'crit' || s.expiry_level === 'expired';

/** Services / unités courants (circuit fermé type CCPC) — saisie libre possible. */
const SERVICES = ['Urgences', 'Réanimation', 'Bloc opératoire', 'Cardiologie', 'Neurologie', 'Pédiatrie', 'Maternité', 'Endocrinologie', 'Médecine interne', 'Pharmacie centrale'];

/* ============================================================
   HÔPITAL — alertes internes (tension / rupture), stock et sorties
   vers service / unité, réceptions, commandes PRA (public),
   réseau de partenaires, médicaments critiques (API réelle).
   ============================================================ */
@Component({
  selector: 'app-hopital-dash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalA11y, FieldLabel, TableLabels, Icon, Card, PageHead, Stat, Tag, PartnersPanel, IncomingDeliveries, ExpiryTag],
  templateUrl: './hopital.html',
  styleUrl: './hopital.css',
})
export class HopitalDash {
  private readonly platform = inject(PlatformState);
  private readonly hospital = inject(HospitalService);
  private readonly medicines = inject(MedicineService);
  private readonly structures = inject(StructureService);
  private readonly auth = inject(AuthService);

  readonly section = model.required<string>();
  readonly alertes = signal<AlerteHop[]>([]);
  readonly critMeds = signal<CritMedRow[]>([]);
  readonly alertHistory = signal<AlerteHop[]>([]);
  readonly services = SERVICES;

  readonly signalModal = signal(false);
  readonly signalSeverity = signal<HospitalSeverity>('tension');
  readonly loading = signal(true);

  /** Secteur lu en base : un hôpital public commande à sa PRA, un privé à ses distributeurs. */
  readonly isPublic = computed(() => (this.auth.structure()?.sector ?? 'public') === 'public');
  readonly structureName = computed(() => this.auth.structure()?.name ?? 'Hôpital');
  readonly headerSub = computed(() => {
    const s = this.auth.structure();
    const pra = this.dashboardData()['pra'];
    return `${this.structureName()} — ${this.isPublic() ? 'hôpital public' : 'hôpital / clinique privé'}${s?.city ? ' · ' + s.city : ''}`
      + (this.isPublic() && typeof pra === 'string' ? ` · PRA de rattachement : ${pra}` : '');
  });
  readonly supplierRule = computed(() => this.isPublic()
    ? 'Hôpital public : réapprovisionnement uniquement auprès de la PRA de votre région (jamais d\'un distributeur privé).'
    : 'Hôpital privé : réapprovisionnement auprès de vos distributeurs privés.');
  readonly partnerTypes = computed<readonly PartnerTypeOption[]>(() => [
    { value: 'distributor', label: this.isPublic() ? 'PRA / PNA' : 'Distributeur privé' },
    { value: 'pharmacy', label: 'Pharmacie d\'officine' },
    { value: 'hospital', label: 'Hôpital / clinique' },
  ]);

  // Commandes institutionnelles vers la PRA
  readonly praOrders = signal<ApiInstitutionalOrder[]>([]);
  readonly praModal = signal(false);

  // Stock de la pharmacie interne + sorties vers service / unité
  readonly hStock = signal<ApiHospitalStockRow[]>([]);
  readonly stockFilter = signal<'all' | 'tension' | 'rupture' | 'controlled'>('all');
  /** Filtre péremption, cumulable avec le filtre de niveau (même logique que l'espace pharmacie). */
  readonly expiryFilter = signal<'all' | 'soon' | 'expired'>('all');
  readonly filteredStock = computed(() => {
    const f = this.stockFilter();
    const e = this.expiryFilter();
    return this.hStock().filter(s => (f === 'all' || (f === 'controlled' ? s.is_controlled : lineLevel(s) === f))
      && (e === 'all' || (e === 'expired' ? s.expiry_level === 'expired' : isExpiring(s))));
  });
  /** Répartition des lignes de stock : rupture / tension / normal. */
  readonly stockLevels = computed(() => {
    const levels = { rupture: 0, tension: 0, normal: 0 };
    for (const s of this.hStock()) levels[lineLevel(s) ?? 'normal']++;
    return levels;
  });

  // Seuil de tension propre à une ligne (PATCH /hospital/stock/{id}/alert-level)
  readonly tensionModal = signal<ApiHospitalStockRow | null>(null);
  readonly tensionDraft = signal<number | null>(null);
  readonly savingTension = signal(false);
  /** Niveau que la ligne aurait avec le seuil saisi — aperçu avant enregistrement. */
  readonly tensionPreview = computed<HospitalSeverity | null>(() => {
    const s = this.tensionModal();
    if (!s) return null;
    const t = this.tensionDraft() ?? this.defaultTension(s);
    return s.available <= 0 ? 'rupture' : s.available <= t ? 'tension' : null;
  });
  /** Lots orange / rouge (péremption < 3 mois ou dépassée), les plus proches d'abord. */
  readonly expiring = computed(() => this.hStock()
    .filter(isExpiring)
    .sort((a, b) => (a.days_to_expiry ?? 0) - (b.days_to_expiry ?? 0)));
  readonly expiredCount = computed(() => this.hStock().filter(s => s.expiry_level === 'expired').length);
  readonly dispenseModal = signal<ApiHospitalStockRow | null>(null);
  readonly dispensations = signal<ApiDispensation[]>([]);
  readonly byService = signal<ApiDispensationByService[]>([]);

  // Demande de réapprovisionnement ciblée (fournisseurs autorisés lus en base avec leur stock)
  readonly supplierModal = signal<AlerteHop | null>(null);
  readonly suppliers = signal<ApiSupplier[]>([]);
  readonly suppliersLoading = signal(false);
  readonly selectedSuppliers = signal<Set<number>>(new Set());
  readonly sending = signal(false);
  readonly restockRequests = signal<ApiRestockRequest[]>([]);
  readonly pendingRequests = computed(() => this.restockRequests().filter(r => r.status === 'pending'));
  /** Suivi en cours : en attente (les plus anciennes en tête), livraisons en retard, refus récents, livraisons prévues. */
  readonly activeRequests = computed(() => {
    const rank = (r: ApiRestockRequest) => r.status === 'pending' ? 0 : r.delivery_late ? 1 : r.status === 'rejected' ? 2 : 3;
    return this.restockRequests().filter(r => !this.isPastRequest(r))
      .sort((a, b) => rank(a) - rank(b) || (b.age_days ?? 0) - (a.age_days ?? 0));
  });
  /** Historique replié : livrées, refus anciens, annulées, closes — les plus récentes d'abord. */
  readonly pastRequests = computed(() => this.restockRequests().filter(r => this.isPastRequest(r))
    .sort((a, b) => (a.age_days ?? 0) - (b.age_days ?? 0)));
  /** Fournisseurs déjà sollicités, indexés par alerte source — calculé une fois par changement. */
  readonly askedByAlert = computed(() => {
    const index = new Map<string, Set<number>>();
    for (const r of this.pendingRequests()) {
      if (r.source_alert_id == null || !r.distributor_id) continue;
      const key = String(r.source_alert_id);
      let set = index.get(key);
      if (!set) { set = new Set(); index.set(key, set); }
      set.add(r.distributor_id);
    }
    return index;
  });

  readonly ruptures = computed(() => this.alertes().filter(a => a.severity === 'rupture'));
  readonly activeIds = computed(() => new Set(this.alertes().map(a => a.id)));
  readonly tensions = computed(() => this.alertes().filter(a => a.severity === 'tension'));
  readonly dashboardData = signal<ApiHospitalDashboard>({});

  constructor() { this.reload(); }

  private apiError(e: HttpErrorResponse, fallback: string): string {
    return (e.error as ApiErrorBody | null)?.message ?? fallback;
  }

  reload(): void {
    this.loading.set(true);
    this.hospital.alerts().subscribe({
      next: a => { this.alertes.set(a); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.hospital.criticalMedicines().subscribe({ next: m => this.critMeds.set(m), error: () => { /* ignore */ } });
    this.hospital.alertHistory().subscribe({ next: h => this.alertHistory.set(h), error: () => { /* ignore */ } });
    this.hospital.dashboard().subscribe({ next: d => this.dashboardData.set(d), error: () => { /* ignore */ } });
    this.hospital.restockRequests().subscribe({ next: r => this.restockRequests.set(r), error: () => { /* ignore */ } });
    this.hospital.stock().subscribe({ next: s => this.hStock.set(s), error: () => { /* ignore */ } });
    this.hospital.dispensations().subscribe({ next: d => { this.dispensations.set(d.data); this.byService.set(d.by_service); } });
    if (this.isPublic()) {
      this.hospital.praOrders().subscribe({ next: o => this.praOrders.set(o), error: () => { /* ignore */ } });
    }
  }

  submitPraOrder(med: string, qty: string, urgency: string, service: string, notes: string): void {
    const quantity = parseInt(qty, 10);
    if (!med.trim() || isNaN(quantity) || quantity <= 0) { this.platform.notify('Médicament et quantité requis', 'alert'); return; }
    this.medicines.search(med.trim()).pipe(
      switchMap(matches => {
        const medicine = matches[0];
        if (!medicine) return throwError(() => new Error('not_found'));
        return this.hospital.createPraOrder({
          medicine_id: Number(medicine.id), quantity, urgency,
          service: service.trim() || undefined, notes: notes.trim() || undefined,
        });
      }),
      switchMap(() => this.hospital.praOrders()),
    ).subscribe({
      next: orders => {
        this.platform.notify('Commande envoyée à la PRA régionale', 'ok');
        this.praModal.set(false);
        this.praOrders.set(orders);
      },
      error: (e: unknown) => this.platform.notify(
        e instanceof Error && e.message === 'not_found' ? 'Médicament introuvable dans le catalogue'
          : e instanceof HttpErrorResponse ? this.apiError(e, 'Échec (aucune PRA pour votre région ?)') : 'Échec de la commande', 'alert'),
    });
  }

  praUrgencyTag(u: string): string { return u === 'critical' ? 'crit' : u === 'urgent' ? 'low' : 'new'; }
  praUrgencyLabel(u: string): string { return u === 'critical' ? 'Critique' : u === 'urgent' ? 'Urgente' : 'Normale'; }
  praStatusLabel(s: string): string {
    return s === 'resolved' ? 'Traitée' : s === 'rejected' ? 'Rejetée' : s === 'received' ? 'Reçue' : 'En attente';
  }

  /** Deux niveaux d'urgence : rupture (rouge) / tension (orange). */
  sevTag(s: HospitalSeverity | null | undefined): string { return s === 'rupture' ? 'crit' : s === 'tension' ? 'low' : 'ok'; }
  sevLabel(s: HospitalSeverity | null | undefined): string { return s === 'rupture' ? 'Rupture' : s === 'tension' ? 'Tension' : 'Suivi normal'; }
  level(s: ApiHospitalStockRow): HospitalSeverity | null { return lineLevel(s); }
  /** Seuil de tension par défaut : 2 × le seuil d'alerte de la ligne. */
  defaultTension(s: ApiHospitalStockRow): number { return 2 * (s.threshold_qty ?? 0); }
  /** Médicament contrôlé : « Non stocké » (aucune ligne en pharmacie interne) se distingue d'une rupture. */
  critTag(m: CritMedRow): string { return !m.stocked ? 'vue' : m.s === 'out' ? 'crit' : m.s === 'low' ? 'low' : 'ok'; }
  critLabel(m: CritMedRow): string { return !m.stocked ? 'Non stocké' : m.s === 'out' ? 'Rupture' : m.s === 'low' ? 'Tension' : 'Suivi normal'; }
  critTone(m: CritMedRow): string { return !m.stocked ? '' : m.s === 'out' ? 'red' : m.s === 'low' ? 'amber' : 'green'; }
  /** Un lot périmé ne sort plus vers les services (refus 422 côté API). */
  isExpired(s: ApiHospitalStockRow): boolean { return s.expiry_level === 'expired'; }
  when(iso: string | null): string { return iso ? new Date(iso).toLocaleString('fr-FR') : ''; }

  /** Ouvre le stock filtré sur les lots périmés (bandeau du tableau de bord). */
  showExpired(): void {
    this.stockFilter.set('all');
    this.expiryFilter.set('expired');
    this.section.set('stock');
  }

  // --- Demande de réapprovisionnement (PRA pour un hôpital public, distributeurs privés sinon) ---

  askRestock(alert: AlerteHop): void {
    this.supplierModal.set(alert);
    this.suppliers.set([]);
    this.selectedSuppliers.set(new Set());
    this.suppliersLoading.set(true);
    this.structures.suppliers(alert.medId ?? null).subscribe({
      next: list => {
        this.suppliers.set(list);
        this.suppliersLoading.set(false);
        const asked = this.alreadyAsked(alert);
        this.selectedSuppliers.set(new Set(list.filter(d => (d.has_stock || d.is_partner) && !asked.has(d.id)).map(d => d.id)));
      },
      error: () => this.suppliersLoading.set(false),
    });
  }

  alreadyAsked(alert: AlerteHop): ReadonlySet<number> {
    return this.askedByAlert().get(alert.id) ?? EMPTY_SET;
  }
  /** Tous les fournisseurs possibles ont déjà une demande en cours : la suite est la relance. */
  allAsked(alert: AlerteHop): boolean {
    const asked = this.alreadyAsked(alert);
    return !this.suppliersLoading() && this.suppliers().length > 0 && this.suppliers().every(d => asked.has(d.id));
  }

  toggleSupplier(id: number): void {
    const next = new Set(this.selectedSuppliers());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selectedSuppliers.set(next);
  }

  submitSupplierRequest(qtyInput: string, message: string): void {
    const a = this.supplierModal();
    if (!a) return;
    const ids = [...this.selectedSuppliers()];
    if (ids.length === 0) { this.platform.notify('Sélectionnez au moins un fournisseur', 'alert'); return; }
    const qty = parseInt(qtyInput, 10);
    if (isNaN(qty) || qty <= 0) { this.platform.notify('Quantité invalide', 'alert'); return; }

    this.sending.set(true);
    this.hospital.requestRestock(Number(a.id), ids, qty, message.trim() || undefined).subscribe({
      next: res => {
        this.sending.set(false);
        const names = res.data.map(d => d.distributor).join(', ');
        this.platform.notify(res.data.length ? 'Demande envoyée à ' + names : 'Demande déjà en attente chez ces fournisseurs', res.data.length ? 'ok' : 'info');
        this.supplierModal.set(null);
        this.reload();
      },
      error: (e: HttpErrorResponse) => { this.sending.set(false); this.platform.notify(this.apiError(e, 'Échec de la demande de réapprovisionnement'), 'alert'); },
    });
  }

  requestStatusLabel(r: ApiRestockRequest): string {
    const day = (iso: string) => this.dayMonth(iso);
    if (r.status === 'cancelled') return 'Annulée';
    if (r.status === 'closed') return 'Close';
    if (r.status === 'pending' && r.stale) return `Sans réponse depuis ${this.plural(r.age_days ?? 0, 'jour', 'jours')}`;
    if (r.delivery_late) return 'Livraison en retard' + (r.delivery_date ? ' (prévue le ' + day(r.delivery_date) + ')' : '');
    if (r.status === 'resolved' && r.delivery_status === 'delivered') return 'Livrée' + (r.delivered_at ? ' le ' + day(r.delivered_at) : '');
    return r.status === 'resolved' ? 'Livraison prévue' + (r.delivery_date ? ' le ' + day(r.delivery_date) : '')
      : r.status === 'rejected' ? 'Refusée' + (r.rejected_at ? ' le ' + day(r.rejected_at) : '')
      : 'En attente de réponse';
  }
  /** État d'une demande en cours : bleu en attente, orange si sans réponse ou livraison en retard (même code que l'officine). */
  requestTag(r: ApiRestockRequest): string {
    if (r.delivery_late || (r.status === 'pending' && r.stale)) return 'low';
    return r.status === 'resolved' ? 'ok' : r.status === 'rejected' ? 'crit' : 'new';
  }
  requestTile(r: ApiRestockRequest): string {
    if (r.delivery_late || (r.status === 'pending' && r.stale)) return 'amber';
    return r.status === 'resolved' ? 'green' : r.status === 'rejected' ? 'red' : 'blue';
  }
  /** Destinataire : les anciennes demandes non ciblées étaient adressées à tout le réseau. */
  requestTarget(r: ApiRestockRequest): string {
    return !r.distributor_id || r.distributor === 'Réseau' ? 'Tous les fournisseurs du réseau' : r.distributor;
  }
  /** « il y a 5 jours » / « aujourd'hui ». */
  ageLabel(r: ApiRestockRequest): string {
    const d = r.age_days ?? null;
    return d === null ? '' : d === 0 ? 'aujourd\'hui' : 'il y a ' + this.plural(d, 'jour', 'jours');
  }
  dayMonth(iso: string): string { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); }
  /** Demande terminée, plus rien à suivre : elle passe dans l'historique (un refus récent reste visible). */
  isPastRequest(r: ApiRestockRequest): boolean {
    if (r.status === 'pending' || r.delivery_late || r.recently_rejected) return false;
    return r.status !== 'resolved' || r.delivery_status === 'delivered';
  }
  plural(n: number, one: string, many: string): string { return `${n} ${n > 1 ? many : one}`; }

  /** Demandes en cours d'envoi (relance / annulation) : boutons désactivés, pas de double envoi. */
  readonly busyRequests = signal<ReadonlySet<number>>(new Set());
  /** Pourquoi « Relancer » est indisponible (infobulle). */
  remindHint(r: ApiRestockRequest): string {
    if (!r.distributor_id) return 'Ancienne demande adressée à tout le réseau : annulez-la puis envoyez une demande ciblée';
    return r.can_remind ? 'Prévenir à nouveau ' + r.distributor : 'Déjà relancée il y a moins de 24 h';
  }
  remindRequest(r: ApiRestockRequest): void { this.requestAction(r, this.hospital.remindRestockRequest(r.id), 'ok'); }
  cancelRequest(r: ApiRestockRequest): void { this.requestAction(r, this.hospital.cancelRestockRequest(r.id), 'info'); }

  private requestAction(r: ApiRestockRequest, call: Observable<{ message: string }>, kind: 'ok' | 'info'): void {
    if (this.busyRequests().has(r.id)) return;
    this.busyRequests.update(set => new Set(set).add(r.id));
    const done = () => this.busyRequests.update(set => { const next = new Set(set); next.delete(r.id); return next; });
    call.subscribe({
      next: res => {
        done();
        this.platform.notify(res.message, kind);
        // Une annulation libère aussi le fournisseur sur l'alerte d'origine (« Demander réappro. » redevient possible).
        this.hospital.restockRequests().subscribe(list => this.restockRequests.set(list));
        this.hospital.alerts().subscribe({ next: a => this.alertes.set(a), error: () => { /* ignore */ } });
      },
      error: (e: HttpErrorResponse) => { done(); this.platform.notify(this.apiError(e, 'Action impossible — réessayez'), 'alert'); },
    });
  }

  resolve(id: string): void {
    this.hospital.resolveAlert(Number(id)).subscribe({
      next: () => { this.platform.notify('Alerte résolue — réapprovisionnement reçu', 'ok'); this.reload(); },
      error: () => this.platform.notify('Échec de la résolution', 'alert'),
    });
  }

  signalRupture(severity: HospitalSeverity = 'tension'): void {
    this.signalSeverity.set(severity);
    this.signalModal.set(true);
  }

  submitSignal(med: string, severity: string, service: string, unit: string, qty: string): void {
    const sev: HospitalSeverity = severity === 'rupture' ? 'rupture' : 'tension';
    const remaining = sev === 'rupture' ? 0 : parseInt(qty, 10);
    if (!med.trim() || !service.trim()) { this.platform.notify('Médicament et service requis', 'alert'); return; }
    if (sev === 'tension' && (isNaN(remaining) || remaining <= 0)) {
      this.platform.notify('Une tension correspond à un stock critique non nul : indiquez la quantité restante', 'alert');
      return;
    }
    this.medicines.search(med.trim()).pipe(
      switchMap(matches => {
        const medicine = matches[0];
        if (!medicine) return throwError(() => new Error('not_found'));
        return this.hospital.createAlert({
          medicine_id: Number(medicine.id), service: service.trim(), unit: unit.trim() || undefined,
          severity: sev, remaining_quantity: remaining,
        }).pipe(map(r => ({ medicine, notified: r.notified_partners })));
      }),
    ).subscribe({
      next: ({ medicine, notified }) => {
        this.platform.notify(`${sev === 'rupture' ? 'Rupture' : 'Tension'} signalée pour ${medicine.nom} — ${this.plural(notified, 'partenaire notifié', 'partenaires notifiés')}`, 'ok');
        this.signalModal.set(false);
        this.reload();
      },
      error: (e: unknown) => this.platform.notify(
        e instanceof Error && e.message === 'not_found' ? 'Médicament introuvable dans le catalogue' : 'Échec du signalement', 'alert'),
    });
  }

  // --- Seuil de tension par ligne ---
  openTension(s: ApiHospitalStockRow): void {
    this.tensionDraft.set(s.tension_threshold_custom ? (s.tension_threshold ?? null) : null);
    this.tensionModal.set(s);
  }

  /** value = seuil saisi ; null = revenir au seuil par défaut (2 × seuil d'alerte). */
  saveTension(value: number | null): void {
    const s = this.tensionModal();
    if (!s) return;
    if (value !== null && (!Number.isInteger(value) || value < 1)) { this.platform.notify('Seuil de tension invalide (entier ≥ 1)', 'alert'); return; }
    this.savingTension.set(true);
    this.hospital.setTensionThreshold(s.id, value).pipe(
      switchMap(r => this.hospital.stock().pipe(map(stock => ({ r, stock })))),
    ).subscribe({
      next: ({ r, stock }) => {
        this.savingTension.set(false);
        this.hStock.set(stock);
        this.tensionModal.set(null);
        this.platform.notify(`${s.medicine_name} : seuil de tension ${r.tension_threshold} u. — ${this.sevLabel(r.alert_level).toLowerCase()}`, 'ok');
      },
      error: (e: HttpErrorResponse) => { this.savingTension.set(false); this.platform.notify(this.apiError(e, "Échec de l'enregistrement du seuil"), 'alert'); },
    });
  }

  // --- Sorties vers service / unité (circuit fermé) ---
  submitDispense(qtyInput: string, service: string, unit: string, patientRef: string): void {
    const s = this.dispenseModal();
    if (!s) return;
    if (this.isExpired(s)) { this.platform.notify('Lot périmé : sortie vers un service interdite', 'alert'); return; }
    const quantity = parseInt(qtyInput, 10);
    if (isNaN(quantity) || quantity <= 0 || quantity > s.available) { this.platform.notify(`Quantité invalide (disponible : ${s.available})`, 'alert'); return; }
    if (!service.trim()) { this.platform.notify('Service destinataire requis', 'alert'); return; }
    this.hospital.dispense(s.id, {
      quantity, service: service.trim(), unit: unit.trim() || undefined, patient_ref: patientRef.trim() || undefined,
    }).subscribe({
      next: r => { this.platform.notify(r.message, 'ok'); this.dispenseModal.set(null); this.reload(); },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec de la sortie'), 'alert'),
    });
  }
}
