import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, model, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, finalize, map, switchMap, throwError } from 'rxjs';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Tag } from '../../../components/tag/tag';
import { MapMedicine, MapRequest, NetworkMap } from '../../../components/network-map/network-map';
import { PartnersPanel, PartnerTypeOption } from '../../../components/partners-panel/partners-panel';
import { IncomingDeliveries } from '../../../components/incoming-deliveries/incoming-deliveries';
import { ExpiryTag } from '../../../components/expiry-tag/expiry-tag';
import { SegControl, SegOption } from '../../../components/seg-control/seg-control';
import { ActiveFilters, ActiveFilter } from '../../../components/active-filters/active-filters';
import { PlatformState } from '../../../services/platform/platform';
import { HospitalService } from '../../../services/hospital/hospital';
import { SHARED_READ_MS } from '../../../services/shared-read/shared-read';
import { MedicineService } from '../../../services/medicines/medicines';
import { StructureService, structurePoint } from '../../../services/structures/structures';
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

/** Recherche sans accents ni casse (« Amoxicilline » = « amoxicilline »). */
const fold = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

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
/** Lectures de la page, rechargées séparément après une action. */
type HospitalResource = 'alerts' | 'crit' | 'history' | 'dashboard' | 'requests' | 'stock' | 'dispensations' | 'pra';
const ALL_RESOURCES: HospitalResource[] = ['alerts', 'crit', 'history', 'dashboard', 'requests', 'stock', 'dispensations', 'pra'];

@Component({
  selector: 'app-hopital-dash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ModalA11y, FieldLabel, TableLabels, Icon, Card, PageHead, Stat, Tag, PartnersPanel, NetworkMap, IncomingDeliveries, ExpiryTag, SegControl, ActiveFilters, NgTemplateOutlet],
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
  /** Infobulle du champ « Quantité restante », désactivé en rupture. */
  readonly qtyTip = 'En rupture, la quantité restante est 0 : rien à saisir.';
  /** Premier chargement seulement : les rafraîchissements après une action gardent l'écran affiché. */
  readonly loading = signal(true);
  /** Les alertes n'ont pas pu être lues : écran « Réessayer » (« aucune alerte » serait trompeur). */
  readonly alertsError = signal(false);
  /** Données secondaires en échec (stock, demandes…) : bandeau ambre avec « Réessayer ». */
  readonly failedLoads = signal<ReadonlySet<string>>(new Set());
  readonly failedLabel = computed(() => [...this.failedLoads()].join(', '));
  /** Heure de la dernière lecture réussie des alertes. */
  readonly lastSync = signal<Date | null>(null);
  /** Lectures en cours (actualisation discrète). */
  readonly inFlight = signal(0);

  /** Secteur lu en base : un hôpital public commande à sa PRA, un privé à ses distributeurs. */
  readonly isPublic = computed(() => (this.auth.structure()?.sector ?? 'public') === 'public');
  readonly structureName = computed(() => this.auth.structure()?.name ?? 'Hôpital');
  /** Carte du réseau : position de l'hôpital et médicaments de son stock (ruptures puis tensions en tête). */
  readonly myPoint = computed(() => structurePoint(this.auth.structure()));
  readonly mapMedicines = computed<MapMedicine[]>(() => {
    const seen = new Set<number>();
    return this.hStock().flatMap(s => {
      if (seen.has(s.medicine_id)) return [];
      seen.add(s.medicine_id);
      const level = lineLevel(s);
      const name = s.medicine_name ?? s.medicine ?? '—';
      return [{
        id: s.medicine_id,
        label: s.dosage ? `${name} ${s.dosage}` : name,
        state: level === 'rupture' ? 'out' : level === 'tension' ? 'crit' : s.status === 'low' ? 'low' : 'ok',
      } satisfies MapMedicine];
    });
  });
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
  // Filtres du stock : niveau, péremption et « contrôlés » se cumulent (même présentation que l'espace pharmacie).
  readonly stockFilter = signal<'all' | 'tension' | 'rupture'>('all');
  readonly expiryFilter = signal<'all' | 'soon' | 'expired'>('all');
  readonly controlledOnly = signal(false);
  readonly levelOptions: readonly SegOption<'all' | 'tension' | 'rupture'>[] = [
    { id: 'all', label: 'Tous' }, { id: 'rupture', label: 'Ruptures' }, { id: 'tension', label: 'Tensions' },
  ];
  readonly expiryOptions: readonly SegOption<'all' | 'soon' | 'expired'>[] = [
    { id: 'all', label: 'Toutes' }, { id: 'soon', label: '< 3 mois' }, { id: 'expired', label: 'Périmés' },
  ];
  /** Recherche d'un médicament : nom, forme ou dosage, sans tenir compte des accents ni de la casse. */
  readonly stockQuery = signal('');
  readonly filteredStock = computed(() => {
    const f = this.stockFilter();
    const e = this.expiryFilter();
    const ctrl = this.controlledOnly();
    const q = fold(this.stockQuery().trim());
    const severity: Record<string, number> = { rupture: 0, tension: 1 };
    return this.hStock().filter(s => (!q || fold(`${s.medicine_name ?? s.medicine ?? ''} ${s.form ?? ''} ${s.dosage ?? ''}`).includes(q))
      && (f === 'all' || lineLevel(s) === f)
      && (!ctrl || s.is_controlled)
      && (e === 'all' || (e === 'expired' ? s.expiry_level === 'expired' : isExpiring(s))))
      // Ruptures, puis tensions, puis le reste ; ordre alphabétique à niveau égal.
      .sort((a, b) => (severity[lineLevel(a) ?? ''] ?? 2) - (severity[lineLevel(b) ?? ''] ?? 2)
        || (a.medicine_name ?? a.medicine ?? '').localeCompare(b.medicine_name ?? b.medicine ?? '', 'fr'));
  });
  /** Filtres secondaires actifs (repliés sur téléphone : le nombre s'affiche sur le bouton). */
  readonly secondaryFilters = computed(() => (this.controlledOnly() ? 1 : 0) + (this.expiryFilter() !== 'all' ? 1 : 0));
  readonly anyStockFilter = computed(() => !!this.stockQuery().trim() || this.stockFilter() !== 'all' || this.secondaryFilters() > 0);
  readonly resultCountLabel = computed(() => {
    const shown = this.plural(this.filteredStock().length, 'ligne', 'lignes');
    return (this.anyStockFilter() ? `${shown} sur ${this.hStock().length}` : shown) + ' · les plus urgentes en premier';
  });
  /** Téléphone : « Péremption » et « Réglementation » se replient sous « Autres filtres ». */
  readonly isPhone = signal(typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);
  /** Filtres appliqués, en clair : la combinaison explique un tableau court ou vide. */
  readonly activeStockFilters = computed(() => {
    const out: ActiveFilter[] = [];
    const q = this.stockQuery().trim();
    if (q) out.push({ key: 'query', label: `« ${q} »` });
    const f = this.stockFilter();
    if (f !== 'all') out.push({ key: 'level', label: f === 'rupture' ? 'Ruptures' : 'Tensions' });
    const e = this.expiryFilter();
    if (e !== 'all') out.push({ key: 'expiry', label: e === 'soon' ? 'Péremption < 3 mois' : 'Périmés' });
    if (this.controlledOnly()) out.push({ key: 'controlled', label: 'Contrôlés' });
    return out;
  });
  removeStockFilter(key: string): void {
    if (key === 'query') this.stockQuery.set('');
    else if (key === 'level') this.stockFilter.set('all');
    else if (key === 'expiry') this.expiryFilter.set('all');
    else this.controlledOnly.set(false);
  }
  resetStockFilters(): void {
    this.stockQuery.set('');
    this.stockFilter.set('all');
    this.expiryFilter.set('all');
    this.controlledOnly.set(false);
  }
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

  /** Médicaments critiques en rupture ou sous le seuil d'alerte : ce qui demande une action. */
  readonly critToHandle = computed(() => this.critMeds().filter(m => m.s !== 'ok').length);

  /** Vrai seulement pendant le reload() du constructeur : la cloche vient de lire les mêmes alertes. */
  private firstLoad = true;

  constructor() {
    const phoneQuery = window.matchMedia('(max-width: 640px)');
    const onPhone = (e: MediaQueryListEvent) => this.isPhone.set(e.matches);
    phoneQuery.addEventListener('change', onPhone);
    inject(DestroyRef).onDestroy(() => phoneQuery.removeEventListener('change', onPhone));
    this.reload();
    this.firstLoad = false;
    // Les pastilles de la sidebar comptent ce que les pages affichent — jamais un autre chiffre.
    effect(() => this.platform.navCounts.set({
      alert: this.alertes().length,
      stock: this.expiredCount(),
      crit: this.critToHandle(),
    }));
    inject(DestroyRef).onDestroy(() => this.platform.navCounts.set(null));
  }

  private apiError(e: HttpErrorResponse, fallback: string): string {
    return (e.error as ApiErrorBody | null)?.message ?? fallback;
  }

  /** Tout recharger : premier affichage et « Actualiser ». */
  reload(): void { this.refresh(...ALL_RESOURCES); }

  /** « Réessayer » / « Actualiser » : l'écran de chargement ne revient que s'il n'y a encore rien à montrer. */
  retry(): void {
    this.loading.set(this.lastSync() === null);
    this.alertsError.set(false);
    this.reload();
  }

  /** Recharge uniquement ce qu'une action a changé (1 à 4 appels au lieu de 8). */
  refresh(...what: HospitalResource[]): void {
    for (const resource of new Set(what)) {
      switch (resource) {
        case 'alerts':
          this.inFlight.update(n => n + 1);
          this.hospital.alerts(this.firstLoad ? SHARED_READ_MS : 0).pipe(finalize(() => this.inFlight.update(n => n - 1))).subscribe({
            next: a => { this.alertes.set(a); this.alertsError.set(false); this.loading.set(false); this.lastSync.set(new Date()); },
            // Échec : on garde ce qui est affiché ; sans lecture réussie, écran d'erreur.
            error: () => {
              this.alertsError.set(this.lastSync() === null);
              this.loading.set(false);
              if (this.lastSync()) this.platform.notify('Alertes non actualisées — connexion instable', 'alert');
            },
          });
          break;
        case 'crit': this.track('médicaments critiques', this.hospital.criticalMedicines(), m => this.critMeds.set(m)); break;
        case 'history': this.track('historique des alertes', this.hospital.alertHistory(), h => this.alertHistory.set(h)); break;
        case 'dashboard': this.track('indicateurs', this.hospital.dashboard(), d => this.dashboardData.set(d)); break;
        case 'requests': this.track('demandes fournisseurs', this.hospital.restockRequests(), r => this.restockRequests.set(r)); break;
        case 'stock': this.track('stock de la pharmacie interne', this.hospital.stock(), st => this.hStock.set(st)); break;
        case 'dispensations': this.track('sorties vers les services', this.hospital.dispensations(), d => { this.dispensations.set(d.data); this.byService.set(d.by_service); }); break;
        case 'pra': if (this.isPublic()) this.track('commandes PRA', this.hospital.praOrders(), o => this.praOrders.set(o)); break;
      }
    }
  }

  /** Charge une donnée secondaire et note son échec (bandeau) au lieu de l'ignorer. */
  private track<T>(label: string, source: Observable<T>, apply: (value: T) => void): void {
    this.inFlight.update(n => n + 1);
    source.pipe(finalize(() => this.inFlight.update(n => n - 1))).subscribe({
      next: value => { apply(value); this.setFailed(label, false); },
      error: () => this.setFailed(label, true),
    });
  }

  private setFailed(label: string, failed: boolean): void {
    const current = this.failedLoads();
    if (current.has(label) === failed) return;
    const next = new Set(current);
    if (failed) next.add(label); else next.delete(label);
    this.failedLoads.set(next);
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
    this.resetStockFilters();
    this.expiryFilter.set('expired');
    this.section.set('stock');
  }

  // --- Demande de réapprovisionnement (PRA pour un hôpital public, distributeurs privés sinon) ---

  askRestock(alert: AlerteHop, only?: number): void {
    this.supplierModal.set(alert);
    this.suppliers.set([]);
    this.selectedSuppliers.set(new Set());
    this.suppliersLoading.set(true);
    this.structures.suppliers(alert.medId ?? null).subscribe({
      next: list => {
        this.suppliers.set(list);
        this.suppliersLoading.set(false);
        const asked = this.alreadyAsked(alert);
        this.selectedSuppliers.set(new Set(list.filter(d => (only ? d.id === only : d.has_stock || d.is_partner) && !asked.has(d.id)).map(d => d.id)));
      },
      error: () => this.suppliersLoading.set(false),
    });
  }

  /**
   * « Demander » sur la carte du réseau. Une demande de réappro. hospitalière part d'une alerte
   * (POST /hospital/alerts/{alert}/restock) : sans alerte ouverte pour ce médicament, on ouvre
   * le signalement pré-rempli, la demande se fait ensuite depuis l'alerte créée.
   */
  requestFromMap(r: MapRequest): void {
    const alert = this.alertes().find(a => a.medId === r.medicineId);
    if (alert) { this.askRestock(alert, r.supplierId); return; }
    const s = this.hStock().find(x => x.medicine_id === r.medicineId);
    this.platform.notify('Signalez d’abord la tension ou la rupture : la demande au fournisseur part de l’alerte', 'info');
    this.signalRupture(s && s.available <= 0 ? 'rupture' : 'tension', s ? (s.medicine_name ?? s.medicine ?? '') : '');
  }

  /** Fournisseurs déjà sollicités par médicament (pour la carte du réseau). */
  readonly askedByMedicine = computed(() => {
    const index = new Map<number, Set<number>>();
    for (const a of this.alertes()) {
      const asked = this.askedByAlert().get(a.id);
      if (a.medId == null || !asked) continue;
      const set = index.get(a.medId) ?? new Set<number>();
      asked.forEach(id => set.add(id));
      index.set(a.medId, set);
    }
    return index;
  });

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
        this.refresh('alerts', 'requests');
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
  /** Couleur d'une demande terminée : livrée/prévue vert, refusée rouge, annulée violet, close (stock revenu) teal. */
  pastTone(r: { status: string }): string {
    return r.status === 'resolved' ? 'green' : r.status === 'rejected' ? 'red'
      : r.status === 'cancelled' ? 'violet' : r.status === 'closed' ? 'teal' : 'gray';
  }
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
        this.refresh('requests', 'alerts');
      },
      error: (e: HttpErrorResponse) => { done(); this.platform.notify(this.apiError(e, 'Action impossible — réessayez'), 'alert'); },
    });
  }

  resolve(id: string): void {
    this.hospital.resolveAlert(Number(id)).subscribe({
      next: () => { this.platform.notify('Alerte résolue — réapprovisionnement reçu', 'ok'); this.refresh('alerts', 'history', 'stock', 'dashboard', 'requests'); },
      error: () => this.platform.notify('Échec de la résolution', 'alert'),
    });
  }

  /** Médicament pré-rempli dans le signalement (depuis la carte du réseau). */
  readonly signalMed = signal('');

  signalRupture(severity: HospitalSeverity = 'tension', med = ''): void {
    this.signalMed.set(med);
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
        this.refresh('alerts', 'history', 'dashboard');
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
    this.hospital.setTensionThreshold(s.id, value).subscribe({
      next: r => {
        this.savingTension.set(false);
        this.tensionModal.set(null);
        // Le seuil est enregistré : une relecture du stock en échec ne doit pas le faire croire perdu.
        this.refresh('stock');
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
      next: r => { this.platform.notify(r.message, 'ok'); this.dispenseModal.set(null); this.refresh('stock', 'dispensations', 'dashboard', 'alerts'); },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec de la sortie'), 'alert'),
    });
  }
}
