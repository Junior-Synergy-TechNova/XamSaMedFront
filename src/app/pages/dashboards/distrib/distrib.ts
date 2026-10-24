import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, model, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Observable, finalize } from 'rxjs';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Bar } from '../../../components/bar/bar';
import { Tag } from '../../../components/tag/tag';
import { ZoneMap } from '../../../components/zone-map/zone-map';
import { PartnersPanel, PartnerTypeOption } from '../../../components/partners-panel/partners-panel';
import { IncomingDeliveries } from '../../../components/incoming-deliveries/incoming-deliveries';
import { PlatformState, saveBlob } from '../../../services/platform/platform';
import { DeliveryReceiptService } from '../../../services/deliveries/deliveries';
import { DistributorDashboard, DistributorService } from '../../../services/distributor/distributor';
import { MedicineService } from '../../../services/medicines/medicines';
import {
  ApiDestination, ApiErrorBody, ApiForecast, ApiIncomingRequest, ApiInstitutionalOrder, ApiPnaDashboard, ApiShortageReport,
} from '../../../interfaces/api';
import { DemandeReg, DeliveryRow, DeliveryStatus, SupplierKind, ZoneInfo } from '../../../interfaces/models';
import { AuthService } from '../../../services/auth/auth';

import { ModalA11y } from '../../../directives/modal-a11y/modal-a11y';
import { FieldLabel } from '../../../directives/field-label/field-label';
import { TableLabels } from '../../../directives/table-labels/table-labels';
type BarTone = 'green' | 'amber' | 'red' | 'blue';

/** Données rechargeables séparément : une action ne relit que ce qu'elle a changé. */
type Resource = 'dashboard' | 'requests' | 'demandes' | 'zones' | 'forecasts' | 'deliveries' | 'shortages' | 'institutional';
const ALL_RESOURCES: readonly Resource[] = ['dashboard', 'requests', 'demandes', 'zones', 'forecasts', 'deliveries', 'shortages', 'institutional'];
/** Retour sur l'onglet après 5 min : l'écran est relu. */
const STALE_AFTER_MS = 5 * 60 * 1000;
/** Une demande sans réponse depuis 3 jours remonte dans la file. */
const STALE_REQUEST_DAYS = 3;
/** Au-delà, la file se replie derrière « Voir les N autres ». */
const TODO_VISIBLE = 12;

/** Élément de la file « À traiter maintenant » : une action précise par ligne. */
interface TodoItem {
  key: string; tone: 'red' | 'amber' | 'blue'; icon: string;
  title: string; detail: string; controlled: boolean;
  action: string; primary: boolean; run: () => void;
  /** Clé de verrouillage pendant l'appel (action directe), null si l'action ouvre un modal. */
  busyKey: string | null;
  /** 0 = à faire tout de suite, 1 = aujourd'hui, 2 = courant. */
  rank: number;
  /** Horodatage : à rang égal, le plus ancien d'abord. */
  since: number;
}

/** Jour local au format AAAA-MM-JJ (même format que DeliveryRow.date). */
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function timeOf(iso: string | null, fallback: number): number {
  const t = iso ? new Date(iso).getTime() : NaN;
  return isNaN(t) ? fallback : t;
}
/** Jours écoulés depuis une date ISO (null si inconnue). */
function ageDays(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/** Contexte du modal « Planifier une livraison ». */
interface PlanContext {
  /** Destinations proposées : celles d'une demande régionale (officines en tension) ou toutes les structures livrables. */
  destinations: ApiDestination[];
  /** Médicament imposé (demande régionale / demande reçue) ou libre. */
  medicineId: number | null;
  medicineName: string | null;
  /** Destination pré-sélectionnée (demande reçue). */
  structureId: number | null;
  quantity: number | null;
  /** Demande de réapprovisionnement à clôturer avec cette livraison. */
  requestId: number | null;
  title: string;
}

/* ============================================================
   DISTRIBUTEUR / PNA / PRA — demandes reçues, demandes régionales,
   livraisons, flux institutionnel (API réelle).
   Le périmètre (PNA nationale, PRA régionale, privé) découle du type de
   la structure de l'utilisateur en base — jamais de profile_meta.
   ============================================================ */
@Component({
  selector: 'app-distrib-dash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:visibilitychange)': 'onVisibilityChange()' },
  imports: [ModalA11y, FieldLabel, TableLabels, Icon, Card, PageHead, Stat, Bar, Tag, ZoneMap, PartnersPanel, IncomingDeliveries, DatePipe],
  templateUrl: './distrib.html',
  styleUrl: './distrib.css',
})
export class DistribDash {
  private readonly platform = inject(PlatformState);
  private readonly distributor = inject(DistributorService);
  private readonly medicines = inject(MedicineService);
  private readonly auth = inject(AuthService);
  private readonly receipts = inject(DeliveryReceiptService);

  readonly section = model.required<string>();
  readonly demandes = signal<DemandeReg[]>([]);
  readonly zones = signal<ZoneInfo[]>([]);
  readonly dashboardData = signal<Partial<DistributorDashboard>>({});
  readonly forecasts = signal<ApiForecast[]>([]);
  readonly sel = signal<string | null>(null);
  /** Premier chargement seulement : les rafraîchissements après une action gardent l'écran affiché. */
  readonly loading = signal(true);
  /** Les demandes reçues n'ont pas pu être lues : écran « Réessayer » (une file vide serait trompeuse). */
  readonly requestsError = signal(false);
  /** Données secondaires en échec (bandeau ambre). */
  readonly failedLoads = signal<ReadonlySet<string>>(new Set());
  readonly failedLabel = computed(() => [...this.failedLoads()].join(', '));
  readonly lastSync = signal<Date | null>(null);
  readonly inFlight = signal(0);
  /** Actions directes en cours (démarrer, confirmer, informer, rejeter) : bouton verrouillé par ligne. */
  readonly busy = signal<ReadonlySet<string>>(new Set());
  /** Envoi d'un modal en cours. */
  readonly saving = signal(false);
  readonly showAllTodo = signal(false);
  readonly catalog = signal<{ id: number; name: string; label: string }[]>([]);

  // --- DEMANDES DE RÉAPPROVISIONNEMENT REÇUES (officines / hôpitaux) ---
  readonly requests = signal<ApiIncomingRequest[]>([]);
  readonly pendingRequests = computed(() => this.requests().filter(r => r.status === 'pending'));
  readonly recentPending = computed(() => this.pendingRequests().slice(0, 5));
  readonly handledRequests = computed(() => this.requests().filter(r => r.status !== 'pending'));
  readonly rejectModal = signal<ApiIncomingRequest | null>(null);

  // --- RUPTURES CONFIRMÉES PAR ALERTE GROUPÉE (patients) ---
  readonly shortageReports = signal<ApiShortageReport[]>([]);

  // --- LIVRAISONS (filtres statut / ville / médicament) ---
  readonly deliveries = signal<DeliveryRow[]>([]);
  readonly filterStatus = signal<DeliveryStatus | 'Toutes'>('Toutes');
  readonly filterCity = signal('');
  readonly filterMed = signal('');
  readonly deliveryCities = computed(() => [...new Set(this.deliveries().map(d => d.zone).filter(z => z && z !== '—'))].sort());
  readonly editLivraisonModal = signal<DeliveryRow | null>(null);
  readonly planModal = signal<PlanContext | null>(null);
  readonly planLoading = signal(false);
  readonly planSelectedMed = signal<number | null>(null);

  // --- INSTITUTIONNEL (PNA / PRA) ---
  readonly praOrders = signal<ApiInstitutionalOrder[]>([]);
  readonly praPnaOrders = signal<ApiInstitutionalOrder[]>([]);
  readonly pnaOrders = signal<ApiInstitutionalOrder[]>([]);
  /** Vue nationale : commandes hôpitaux → PRA (les commandes PRA → PNA ont leur propre liste). */
  readonly hospitalOrders = computed(() => this.pnaOrders().filter(o => o.origin_type !== 'pra_to_pna'));
  readonly pnaRequests = signal<ApiInstitutionalOrder[]>([]);
  readonly pnaDash = signal<ApiPnaDashboard>({});
  readonly fulfillModal = signal<ApiInstitutionalOrder | null>(null);
  readonly pnaOrderModal = signal(false);

  /** Type lu sur la structure de l'utilisateur (structures.type). */
  readonly distType = computed<SupplierKind>(() => {
    const t = this.auth.user()?.structure?.type ?? this.dashboardData().structure?.type;
    return t === 'pna' ? 'PNA' : t === 'pra' ? 'PRA' : 'PRIVATE';
  });
  readonly structureName = computed(() => this.auth.user()?.structure?.name ?? this.dashboardData().structure?.name ?? 'Distributeur');
  readonly region = computed(() => {
    const s = this.auth.user()?.structure ?? this.dashboardData().structure;
    return s?.region ?? s?.city ?? null;
  });

  /** Périmètre strict (§3.3), lu sur le type de la structure en base. */
  readonly distributorContext = computed(() => {
    const name = this.structureName();
    switch (this.distType()) {
      case 'PNA': return `${name} — vue nationale (livre les PRA et les hôpitaux publics nationaux)`;
      case 'PRA': return `${name} — région ${this.region() ?? '—'} (livre uniquement les hôpitaux publics de la région)`;
      default: return `${name} — distributeur privé (livre ses officines et cliniques privées partenaires)`;
    }
  });
  readonly partnerTypes = computed<readonly PartnerTypeOption[]>(() => {
    switch (this.distType()) {
      case 'PNA': return [{ value: 'distributor', label: 'PRA' }, { value: 'hospital', label: 'Hôpital public' }];
      case 'PRA': return [{ value: 'hospital', label: 'Hôpital public de la région' }, { value: 'distributor', label: 'PNA' }];
      default: return [{ value: 'pharmacy', label: 'Officine' }, { value: 'hospital', label: 'Clinique / hôpital privé' }];
    }
  });
  readonly partnerRule = computed(() => this.distType() === 'PRIVATE'
    ? 'Un distributeur privé ne voit et ne livre que ses officines et cliniques privées partenaires : ce réseau définit votre périmètre.'
    : this.distType() === 'PRA'
      ? 'Une PRA approvisionne exclusivement les hôpitaux publics de sa région (jamais les officines privées).'
      : 'La PNA approvisionne les PRA et les grands hôpitaux publics nationaux.');

  readonly critZones = computed(() => this.zones().filter(z => z.niveau === 'crit').length);
  readonly urgentes = computed(() => this.demandes().filter(d => d.tension === 'haute').length);
  readonly zonesList = computed<ZoneInfo[]>(() => {
    const s = this.sel();
    return s ? this.zones().filter(z => z.nom === s) : this.zones();
  });

  readonly filteredDeliveries = computed(() => {
    const s = this.filterStatus();
    const city = this.filterCity();
    const med = this.filterMed().trim().toLowerCase();
    return this.deliveries().filter(d =>
      (s === 'Toutes' || d.status === s)
      && (!city || d.zone === city)
      && (!med || d.med.toLowerCase().includes(med)));
  });

  // ─────────────────────────────────────────────────────────────
  // ACCUEIL — file « À traiter maintenant »
  // ─────────────────────────────────────────────────────────────

  /** Commandes institutionnelles à traiter : PRA → PNA pour la PNA, hôpitaux → PRA pour une PRA. */
  readonly instPending = computed(() => {
    switch (this.distType()) {
      case 'PNA': return this.pnaRequests().filter(o => o.status === 'pending');
      case 'PRA': return this.praOrders().filter(o => o.status === 'pending');
      default: return [];
    }
  });
  /** Planifiées dont la date est passée, sans départ. */
  readonly lateDeliveries = computed(() => {
    const today = localDay();
    return this.deliveries().filter(d => d.status === 'Planifiée' && !!d.date && d.date < today);
  });
  readonly lateIds = computed(() => new Set(this.lateDeliveries().map(d => d.id)));
  /** Borne basse des dates de livraison (formulaires). */
  readonly today = localDay();
  /** Colonne de droite : prochains départs (après aujourd'hui), les plus proches d'abord. */
  readonly upcomingDeliveries = computed(() => {
    const today = localDay();
    return this.deliveries()
      .filter(d => d.status === 'Planifiée' && d.date > today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  });
  /** Colonne de droite : zones les plus tendues du périmètre. */
  readonly topZones = computed(() => {
    const order: Record<string, number> = { crit: 0, haute: 1, moyenne: 2, basse: 3 };
    return [...this.zones()]
      .sort((a, b) => (order[a.niveau] ?? 4) - (order[b.niveau] ?? 4) || b.ruptures - a.ruptures)
      .slice(0, 3);
  });

  /** Tout ce qui attend une action du distributeur, trié par urgence — l'accueil part de là. */
  readonly todo = computed<TodoItem[]>(() => {
    const items: TodoItem[] = [];
    const now = Date.now();
    const today = localDay();
    const askedFor = new Set<string>();

    for (const r of this.pendingRequests()) {
      if (r.structure_id && r.medicine_id) askedFor.add(`${r.structure_id}-${r.medicine_id}`);
      const age = ageDays(r.created_at);
      const reminders = r.reminders ?? 0;
      const controlled = !!r.is_controlled;
      const rank = controlled || reminders > 0 ? 0 : (age ?? 0) >= STALE_REQUEST_DAYS ? 1 : 2;
      items.push({
        key: 'req-' + r.id, tone: rank === 0 ? 'red' : rank === 1 ? 'amber' : 'blue',
        icon: r.kind === 'hospital' ? 'hospital' : 'pill', controlled,
        title: `${r.structure ?? 'Une structure'} demande ${r.medicine ?? 'un médicament'}${r.service ? ' (' + r.service + ')' : ''}`,
        detail: [
          r.quantity_requested ? this.plural(r.quantity_requested, 'unité demandée', 'unités demandées') : null,
          r.available !== null && r.threshold ? `reste ${r.available} pour un seuil de ${r.threshold}` : null,
          this.ago(age, 'reçue'),
          reminders > 0 ? 'relancée ' + this.plural(reminders, 'fois', 'fois') : null,
        ].filter(Boolean).join(' · '),
        action: 'Traiter', primary: rank === 0, busyKey: null, run: () => this.fulfillRequest(r),
        rank, since: timeOf(r.created_at, now),
      });
    }

    const pna = this.distType() === 'PNA';
    for (const o of this.instPending()) {
      const rank = o.urgency === 'critical' ? 0 : o.urgency === 'urgent' ? 1 : 2;
      items.push({
        key: 'inst-' + o.id, tone: rank === 0 ? 'red' : rank === 1 ? 'amber' : 'blue',
        icon: pna ? 'layers' : 'hospital', controlled: false,
        title: `${(pna ? o.pra : o.hospital) ?? 'Une structure'} commande ${o.medicine ?? 'un médicament'}`,
        detail: [
          this.plural(o.quantity, 'unité', 'unités'),
          'urgence ' + this.urgencyLabel(o.urgency),
          o.service ? 'service ' + o.service : null,
          this.ago(ageDays(o.ordered_at), 'reçue'),
        ].filter(Boolean).join(' · '),
        action: 'Livrer', primary: rank === 0, busyKey: null, run: () => this.fulfillModal.set(o),
        rank, since: timeOf(o.ordered_at, now),
      });
    }

    for (const d of this.deliveries()) {
      if (d.status === 'Planifiée' && d.date && d.date <= today) {
        const late = d.date < today;
        items.push({
          key: 'start-' + d.id, tone: late ? 'red' : 'blue', icon: 'truck', controlled: d.controlled,
          title: `${late ? 'Livraison en retard' : 'Départ prévu aujourd\'hui'} — ${d.med} vers ${d.destination}`,
          detail: `${this.plural(d.qty, 'unité', 'unités')} · ${late ? 'prévue le ' + this.dayMonth(d.date) + ', pas encore partie' : d.zone}`,
          action: 'Démarrer', primary: late, busyKey: 'del-' + d.id, run: () => this.startTransit(d.id),
          rank: late ? 0 : 1, since: timeOf(d.date, now),
        });
      } else if (d.status === 'En transit') {
        const overdue = !!d.date && d.date < today;
        items.push({
          key: 'confirm-' + d.id, tone: overdue ? 'amber' : 'blue', icon: 'truck', controlled: d.controlled,
          title: `En route — ${d.med} vers ${d.destination}`,
          detail: `${this.plural(d.qty, 'unité', 'unités')} · `
            + (d.date ? (overdue ? 'devait arriver le ' : 'arrivée prévue le ') + this.dayMonth(d.date) : d.zone)
            + ' · à confirmer une fois remise',
          action: 'Confirmer la livraison', primary: false, busyKey: 'del-' + d.id, run: () => this.confirmDelivery(d.id),
          rank: overdue ? 1 : 2, since: timeOf(d.date, now),
        });
      }
    }

    for (const s of this.shortageReports()) {
      const own = s.own_available;
      const canServe = own === null || own > 0;
      items.push({
        key: 'short-' + s.id, tone: 'amber', icon: 'search', controlled: false,
        title: `Des patients ne trouvent pas ${s.medicine}`,
        detail: `${this.plural(s.searches, 'recherche', 'recherches')} sans officine disponible`
          + (own === null ? '' : own > 0 ? ` · votre stock : ${this.plural(own, 'unité', 'unités')}` : ' · votre stock est aussi à 0'),
        action: canServe ? 'Informer : disponible' : 'Voir les tensions', primary: false,
        busyKey: canServe ? 'short-' + s.id : null,
        run: canServe ? () => this.notifyAvailable(s) : () => this.section.set('reg'),
        rank: 1, since: now,
      });
    }

    for (const d of this.demandes()) {
      if (d.tension !== 'crit' && d.tension !== 'haute') continue;
      // Chaque structure concernée a déjà envoyé sa demande : la ligne « demande » suffit.
      if (d.pharmacies.length > 0 && d.pharmacies.every(p => askedFor.has(`${p.id}-${d.medId}`))) continue;
      const crit = d.tension === 'crit';
      items.push({
        key: 'zone-' + d.id, tone: crit ? 'red' : 'amber', icon: 'pin', controlled: d.controlled,
        title: `${d.med} — tension ${crit ? 'critique' : 'haute'} à ${d.zone}`,
        detail: this.plural(d.officines, 'structure sous le seuil', 'structures sous le seuil')
          + (d.need > 0 ? ` · ${this.plural(d.need, 'unité', 'unités')} à livrer` : ''),
        action: 'Planifier', primary: false, busyKey: null, run: () => this.plan(d),
        rank: crit ? 1 : 2, since: now,
      });
    }

    const toneOrder = { red: 0, amber: 1, blue: 2 };
    return items.sort((a, b) => a.rank - b.rank || toneOrder[a.tone] - toneOrder[b.tone] || a.since - b.since);
  });
  readonly visibleTodo = computed(() => this.showAllTodo() ? this.todo() : this.todo().slice(0, TODO_VISIBLE));
  readonly hiddenTodo = computed(() => this.todo().length - this.visibleTodo().length);

  readonly emptyTodoText = computed(() => {
    switch (this.distType()) {
      case 'PNA': return 'Aucune commande de PRA, demande ni livraison en attente. Les nouvelles commandes régionales apparaîtront ici.';
      case 'PRA': return 'Aucune commande d\'hôpital, demande ni livraison en attente. Les commandes des hôpitaux de la région apparaîtront ici.';
      default: return 'Aucune demande ni livraison en attente. Les demandes de vos officines et cliniques partenaires apparaîtront ici.';
    }
  });

  constructor() {
    this.reload();
    this.medicines.list().subscribe({ next: c => this.catalog.set(c), error: () => { /* le modal libre affiche une liste vide */ } });
    // Les pastilles de la sidebar comptent ce que les pages affichent — jamais un autre chiffre.
    effect(() => this.platform.navCounts.set({
      reg: this.pendingRequests().length,
      inst: this.instPending().length,
      livraisons: this.lateDeliveries().length,
    }));
    inject(DestroyRef).onDestroy(() => this.platform.navCounts.set(null));
  }

  /** « 1 unité », « 2 unités » — accord du nom avec le nombre. */
  plural(n: number, one: string, many: string): string { return `${n} ${n > 1 ? many : one}`; }

  /** Tout recharger : premier affichage, « Actualiser », retour sur l'onglet après une longue absence. */
  reload(): void { this.refresh(...ALL_RESOURCES); }

  retry(): void {
    this.loading.set(this.requests().length === 0);
    this.requestsError.set(false);
    this.reload();
  }

  /** Recharge uniquement les données touchées par une action : 1 à 4 appels au lieu de 10. */
  refresh(...what: Resource[]): void {
    for (const resource of new Set(what)) {
      switch (resource) {
        case 'requests':
          this.inFlight.update(n => n + 1);
          this.distributor.requests().pipe(finalize(() => this.inFlight.update(n => n - 1))).subscribe({
            next: r => { this.requests.set(r); this.requestsError.set(false); this.loading.set(false); this.lastSync.set(new Date()); },
            // Échec : on garde les données déjà affichées ; au premier chargement, écran d'erreur.
            error: () => {
              this.requestsError.set(this.requests().length === 0);
              this.loading.set(false);
              if (this.requests().length) this.platform.notify('Demandes non actualisées — connexion instable', 'alert');
            },
          });
          break;
        case 'dashboard':
          this.distributor.dashboard().subscribe(d => {
            const knewType = !!this.auth.user()?.structure?.type;
            this.dashboardData.set(d);
            // Type de structure inconnu avant /dashboard (session restaurée) : le flux institutionnel suit.
            if (!knewType && d.structure?.type) this.refresh('institutional');
          });
          break;
        case 'demandes': this.track('tensions par zone', this.distributor.regionalDemands(), d => this.demandes.set(d)); break;
        case 'zones': this.track('zones', this.distributor.zones(), z => this.zones.set(z)); break;
        case 'forecasts': this.distributor.previsions().subscribe(p => this.forecasts.set(p)); break;
        case 'deliveries': this.track('livraisons', this.distributor.deliveries(), d => this.deliveries.set(d)); break;
        case 'shortages': this.track('ruptures signalées', this.distributor.shortageReports(), r => this.shortageReports.set(r)); break;
        case 'institutional': this.loadInstitutional(); break;
      }
    }
  }

  /** Retour sur l'onglet : actualise si l'écran date de plus de 5 min. */
  onVisibilityChange(): void {
    const last = this.lastSync();
    if (document.visibilityState === 'visible' && last && Date.now() - last.getTime() > STALE_AFTER_MS && this.inFlight() === 0) {
      this.reload();
    }
  }

  /** Flux institutionnel selon le type de structure (lu en base). */
  private loadInstitutional(): void {
    switch (this.distType()) {
      case 'PNA':
        this.distributor.pnaDashboard().subscribe(d => this.pnaDash.set(d));
        this.track('commandes des PRA', this.distributor.pnaRequests(), o => this.pnaRequests.set(o));
        this.distributor.pnaOrders().subscribe(o => this.pnaOrders.set(o));
        break;
      case 'PRA':
        this.track('commandes des hôpitaux', this.distributor.praOrders(), o => this.praOrders.set(o));
        this.distributor.praPnaOrders().subscribe(o => this.praPnaOrders.set(o));
        break;
      default:
        break;
    }
  }

  /** Charge une donnée secondaire et note son échec (affiché en bandeau) au lieu de l'ignorer. */
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

  isBusy(key: string | null): boolean { return key !== null && this.busy().has(key); }

  /** Verrouille le bouton de la ligne le temps de l'appel. */
  private lock<T>(key: string, call: Observable<T>): Observable<T> {
    this.busy.update(s => new Set(s).add(key));
    return call.pipe(finalize(() => this.busy.update(s => {
      const next = new Set(s);
      next.delete(key);
      return next;
    })));
  }

  /** « reçue aujourd'hui », « reçue il y a 3 jours ». */
  private ago(days: number | null, verb: string): string | null {
    if (days === null) return null;
    return days === 0 ? `${verb} aujourd'hui` : `${verb} il y a ${this.plural(days, 'jour', 'jours')}`;
  }
  /** « 24 octobre » (date ISO ou AAAA-MM-JJ, lue en heure locale). */
  dayMonth(iso: string): string {
    return new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  }
  urgencyLabel(u: string): string { return u === 'critical' ? 'critique' : u === 'urgent' ? 'haute' : 'normale'; }
  /** Pastille d'urgence (en début de libellé : majuscule). */
  urgencyTitle(u: string): string { const l = this.urgencyLabel(u); return l.charAt(0).toUpperCase() + l.slice(1); }

  private apiError(e: HttpErrorResponse, fallback: string): string {
    return (e.error as ApiErrorBody | null)?.message ?? fallback;
  }

  // ─────────────────────────────────────────────────────────────
  // DEMANDES REÇUES
  // ─────────────────────────────────────────────────────────────

  /** « Traiter » : ouvre le modal de livraison pré-rempli (destination, médicament, quantité) et lié à la demande. */
  fulfillRequest(r: ApiIncomingRequest): void {
    if (!r.structure_id || !r.medicine_id) { this.platform.notify('Demande incomplète (structure ou médicament manquant)', 'alert'); return; }
    this.openPlan({
      destinations: [],
      medicineId: r.medicine_id,
      medicineName: r.medicine,
      structureId: r.structure_id,
      quantity: r.quantity_requested ?? this.needFor(r),
      requestId: r.id,
      title: `Livrer ${r.structure ?? 'la structure'}`,
    });
  }

  private needFor(r: ApiIncomingRequest): number | null {
    const avail = Number(r.available ?? 0);
    return r.threshold ? Math.max(1, r.threshold * 3 - (isNaN(avail) ? 0 : avail)) : null;
  }

  submitReject(reason: string): void {
    const r = this.rejectModal();
    if (!r) return;
    if (!reason.trim()) { this.platform.notify('Indiquez un motif', 'alert'); return; }
    this.saving.set(true);
    this.distributor.rejectRequest(r.id, reason.trim()).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => { this.platform.notify('Demande refusée — le demandeur est notifié', 'info'); this.rejectModal.set(null); this.refresh('requests'); },
      error: e => this.platform.notify(this.apiError(e, 'Échec du refus'), 'alert'),
    });
  }

  requestStatusLabel(r: ApiIncomingRequest): string {
    const day = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    return r.status === 'resolved' ? 'Livraison prévue' + (r.delivery_date ? ' le ' + day(r.delivery_date) : '')
      : r.status === 'rejected' ? 'Refusée'
      : r.status === 'cancelled' ? 'Annulée par le demandeur'
      : r.status === 'closed' ? 'Close — stock du demandeur revenu'
      : 'En attente';
  }

  // ─────────────────────────────────────────────────────────────
  // DEMANDES RÉGIONALES → PLANIFIER
  // ─────────────────────────────────────────────────────────────

  /** « Planifier » sur une demande régionale : médicament imposé, destinations = officines en tension de la zone. */
  plan(d: DemandeReg): void {
    this.openPlan({
      destinations: d.pharmacies.map(p => ({
        id: p.id, name: p.nom, type: 'pharmacy', city: d.zone, region: d.zone, phone: p.tel,
        available: p.available, status: p.status, threshold: null, suggested_qty: null,
      })),
      medicineId: d.medId,
      medicineName: d.med,
      structureId: d.pharmacies.length === 1 ? d.pharmacies[0].id : null,
      quantity: d.pharmacies.length === 1 ? d.need : null,
      requestId: null,
      title: `Planifier — ${d.med} · ${d.zone}`,
    });
  }

  /** Officines concernées par une tension (libellé court). */
  pharmacyNames(d: DemandeReg): string {
    const names = d.pharmacies.slice(0, 3).map(p => p.nom).join(', ');
    return d.pharmacies.length > 3 ? names + '…' : names;
  }

  /** « Planifier une livraison » libre : toutes les structures livrables, médicament au choix. */
  planLivraison(): void {
    this.openPlan({ destinations: [], medicineId: null, medicineName: null, structureId: null, quantity: null, requestId: null, title: 'Planifier une livraison' });
  }

  private openPlan(ctx: PlanContext): void {
    this.planModal.set(ctx);
    this.planSelectedMed.set(ctx.medicineId);
    if (ctx.destinations.length === 0) this.loadDestinations(ctx.medicineId);
  }

  /** Charge les destinations livrables (avec leur stock du médicament choisi). */
  private loadDestinations(medicineId: number | null): void {
    this.planLoading.set(true);
    this.distributor.destinations(medicineId).subscribe({
      next: list => {
        this.planLoading.set(false);
        const ctx = this.planModal();
        if (ctx) this.planModal.set({ ...ctx, destinations: list });
      },
      error: () => this.planLoading.set(false),
    });
  }

  /** Changement de médicament dans le modal libre → rafraîchit l'état de stock des destinations. */
  onPlanMedChange(value: string): void {
    const id = parseInt(value, 10);
    this.planSelectedMed.set(isNaN(id) ? null : id);
    const ctx = this.planModal();
    if (ctx && ctx.medicineId === null) this.loadDestinations(isNaN(id) ? null : id);
  }

  destinationLabel(d: ApiDestination): string {
    const kind = d.type === 'pra' ? 'PRA' : d.type === 'hospital' ? 'Hôpital' : 'Officine';
    const stock = d.available === null ? '' : d.status === 'not_referenced' ? ' · non référencé' : ` · ${d.available} u. (${this.stockLabel(d.status)})`;
    return `${d.name} — ${kind}${d.city ? ', ' + d.city : ''}${stock}`;
  }
  stockLabel(status: string | null): string {
    return status === 'out_of_stock' ? 'rupture' : status === 'low' ? 'stock faible' : status === 'available' ? 'ok' : '—';
  }

  submitPlan(structureId: string, qty: string, date: string, notes: string): void {
    const ctx = this.planModal();
    if (!ctx) return;
    const sid = parseInt(structureId, 10);
    const mid = ctx.medicineId ?? this.planSelectedMed() ?? NaN;
    const q = parseInt(qty, 10);
    if (isNaN(sid) || isNaN(mid) || isNaN(q) || q <= 0 || !date) {
      this.platform.notify('Destination, médicament, quantité et date sont requis.', 'alert');
      return;
    }
    const medName = ctx.medicineName ?? this.catalog().find(m => m.id === mid)?.name ?? 'médicament';
    const dest = ctx.destinations.find(d => d.id === sid)?.name ?? 'la structure';
    this.saving.set(true);
    this.distributor.createDelivery(sid, mid, q, date, notes.trim() || undefined, ctx.requestId ?? undefined).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.platform.notify(`Livraison de ${this.plural(q, 'unité', 'unités')} de ${medName} planifiée le ${this.dayMonth(date)} vers ${dest}`, 'ok');
        this.planModal.set(null);
        if (ctx.requestId) this.refresh('deliveries', 'requests'); else this.refresh('deliveries');
      },
      error: e => this.platform.notify(this.apiError(e, 'Échec de la planification'), 'alert'),
    });
  }

  // ─────────────────────────────────────────────────────────────
  // LIVRAISONS
  // ─────────────────────────────────────────────────────────────

  startTransit(id: string): void {
    this.lock('del-' + id, this.distributor.changeDeliveryStatus(id, 'En transit')).subscribe({
      next: () => { this.platform.notify('La livraison est en transit', 'info'); this.refresh('deliveries'); },
      error: e => this.platform.notify(this.apiError(e, 'Échec du démarrage'), 'alert'),
    });
  }

  confirmDelivery(id: string): void {
    this.lock('del-' + id, this.distributor.changeDeliveryStatus(id, 'Livrée')).subscribe({
      // Stock crédité chez le destinataire : tensions et ruptures signalées peuvent tomber.
      next: () => { this.platform.notify('Livraison confirmée — stocks mis à jour', 'ok'); this.refresh('deliveries', 'demandes', 'zones', 'shortages'); },
      error: e => this.platform.notify(this.apiError(e, 'Échec de la confirmation'), 'alert'),
    });
  }

  cancelDelivery(id: string): void {
    this.lock('del-' + id, this.distributor.changeDeliveryStatus(id, 'Annulée')).subscribe({
      // Une demande liée repasse en « refusée » côté demandeur.
      next: () => { this.platform.notify('Livraison annulée', 'alert'); this.refresh('deliveries', 'requests'); },
      error: e => this.platform.notify(this.apiError(e, 'Échec de l\'annulation'), 'alert'),
    });
  }

  /** Bordereau de livraison PDF (généré à la confirmation). */
  downloadSlip(d: DeliveryRow): void {
    this.receipts.slip(d.id).subscribe({
      next: blob => saveBlob(blob, `${d.slip ?? 'bordereau-' + d.id}.pdf`),
      error: () => this.platform.notify('Bordereau indisponible', 'alert'),
    });
  }

  /** Informe le périmètre (et les patients à l'origine des alertes groupées) du retour en stock. */
  notifyAvailable(r: ApiShortageReport): void {
    this.lock('short-' + r.id, this.distributor.notifyAvailable(r.id)).subscribe({
      next: res => { this.platform.notify(res.message, 'ok'); this.refresh('shortages'); },
      error: e => this.platform.notify(this.apiError(e, 'Échec de la notification'), 'alert'),
    });
  }

  submitEditLivraison(qtyInput: string, date: string): void {
    const s = this.editLivraisonModal();
    if (!s) return;
    const qty = parseInt(qtyInput, 10);
    this.saving.set(true);
    this.distributor.updateDelivery(s.id, qty, date).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.platform.notify('Livraison modifiée avec succès', 'ok');
        this.editLivraisonModal.set(null);
        this.refresh('deliveries');
      },
      error: e => this.platform.notify(this.apiError(e, 'Échec de la modification'), 'alert'),
    });
  }

  // ─────────────────────────────────────────────────────────────
  // INSTITUTIONNEL — PRA (commandes hôpitaux, commandes à la PNA)
  // ─────────────────────────────────────────────────────────────

  submitFulfill(date: string, notes: string): void {
    const o = this.fulfillModal();
    if (!o) return;
    if (!date) { this.platform.notify('Date de livraison requise', 'alert'); return; }
    const call = this.distType() === 'PNA'
      ? this.distributor.pnaFulfill(o.id, date, notes.trim() || undefined)
      : this.distributor.praFulfill(o.id, date, notes.trim() || undefined);
    this.saving.set(true);
    call.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => { this.platform.notify('Commande traitée — livraison planifiée', 'ok'); this.fulfillModal.set(null); this.refresh('institutional', 'deliveries'); },
      error: e => this.platform.notify(this.apiError(e, 'Échec du traitement'), 'alert'),
    });
  }

  rejectInstitutional(o: ApiInstitutionalOrder): void {
    const reason = 'Stock insuffisant';
    const call = this.distType() === 'PNA' ? this.distributor.pnaReject(o.id, reason) : this.distributor.praReject(o.id, reason);
    this.lock('inst-' + o.id, call).subscribe({
      next: () => { this.platform.notify('Commande rejetée', 'info'); this.refresh('institutional'); },
      error: e => this.platform.notify(this.apiError(e, 'Échec du rejet'), 'alert'),
    });
  }

  submitPnaOrder(medId: string, qty: string, urgency: string, notes: string): void {
    const mid = parseInt(medId, 10);
    const quantity = parseInt(qty, 10);
    if (isNaN(mid) || isNaN(quantity) || quantity <= 0) { this.platform.notify('Médicament et quantité requis', 'alert'); return; }
    this.saving.set(true);
    this.distributor.createPnaOrder({ medicine_id: mid, quantity, urgency, notes: notes.trim() || undefined }).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => { this.platform.notify('Commande envoyée à la PNA', 'ok'); this.pnaOrderModal.set(false); this.refresh('institutional'); },
      error: e => this.platform.notify(this.apiError(e, 'Échec de la commande'), 'alert'),
    });
  }

  instUrgencyTag(u: string): string { return u === 'critical' ? 'crit' : u === 'urgent' ? 'low' : 'new'; }
  instStatusLabel(o: ApiInstitutionalOrder): string {
    return o.status === 'resolved' ? 'Livraison planifiée' + (o.delivery_date ? ' · ' + this.dayMonth(o.delivery_date) : '')
      : o.status === 'rejected' ? 'Rejetée' : o.status === 'received' ? 'Reçue' : 'En attente';
  }

  // ─────────────────────────────────────────────────────────────
  // DIVERS
  // ─────────────────────────────────────────────────────────────

  tcol(t: string): string { return t === 'crit' || t === 'haute' ? 'crit' : t === 'moyenne' ? 'low' : 'ok'; }
  ztag(n: string): string { return n === 'crit' ? 'crit' : n === 'haute' ? 'low' : 'ok'; }
  /** Mêmes libellés que la légende de la carte. */
  zoneLabel(n: string): string { return n === 'crit' ? 'Critique' : n === 'haute' ? 'Tension haute' : n === 'moyenne' ? 'Modérée' : 'Faible'; }
  zoneTile(n: string): string { return n === 'crit' ? 'red' : n === 'haute' ? 'amber' : ''; }
  tone(pct: number): BarTone { return pct > 70 ? 'red' : pct > 40 ? 'amber' : 'green'; }

  /** Délai réel de réappro. (delivery_plans livrés) ou absence d'historique. */
  delayLabel(t: ApiForecast): string {
    return t.avg_delay_days === null ? 'délai réappro. inconnu'
      : `délai réappro. ${t.avg_delay_days.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`;
  }
  delayTitle(t: ApiForecast): string {
    return t.avg_delay_days === null
      ? 'Aucune livraison de ce médicament confirmée à ce jour'
      : `Moyenne création → livraison confirmée sur ${this.plural(t.delay_sample, 'livraison', 'livraisons')}`;
  }

  exportForecasts(): void {
    const rows = this.forecasts();
    if (rows.length === 0) {
      this.platform.notify('Aucune prévision à exporter', 'alert');
      return;
    }
    const header = [
      'Médicament', 'Probabilité (%)', 'Niveau de risque', 'Structures suivies', 'Structures à risque',
      'En rupture', 'Sous seuil', 'Sous seuil d\'ici 14 j', 'Sorties (u./j)', 'Couverture moyenne (j)',
      'Besoin 14 j (u.)', 'Délai réappro. (j)', 'Livraisons de référence',
    ];
    const csvCell = (value: unknown): string => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = rows.map(row => [
      row.medicine, row.probability, row.risk_level, row.tracked_count, row.affected_count,
      row.out_of_stock, row.low_stock, row.projected_shortages, row.daily_demand, row.avg_days_of_cover,
      row.estimated_need, row.avg_delay_days, row.delay_sample,
    ].map(csvCell).join(','));
    const csv = '\uFEFFsep=,\r\n' + [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'previsions-xamsamed.csv';
    link.click();
    URL.revokeObjectURL(url);
    this.platform.notify('Rapport des prévisions exporté', 'ok');
  }
}
