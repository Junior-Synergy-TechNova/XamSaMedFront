import { ChangeDetectionStrategy, Component, DestroyRef, Injector, afterNextRender, computed, effect, inject, model, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DatePipe, DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Observable, catchError, finalize, forkJoin, of } from 'rxjs';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Bar } from '../../../components/bar/bar';
import { Tag } from '../../../components/tag/tag';
import { PartnersPanel, PartnerTypeOption } from '../../../components/partners-panel/partners-panel';
import { IncomingDeliveries } from '../../../components/incoming-deliveries/incoming-deliveries';
import { ExpiryTag } from '../../../components/expiry-tag/expiry-tag';
import { PlatformState, saveBlob } from '../../../services/platform/platform';
import { PharmacyService } from '../../../services/pharmacy/pharmacy';
import { MedicineService } from '../../../services/medicines/medicines';
import { AuthService } from '../../../services/auth/auth';
import { StructureService, rankByDistance, structurePoint } from '../../../services/structures/structures';
import { AvailabilityRow, DemandeRow, StockRow } from '../../../interfaces/models';
import {
  ApiErrorBody, ApiGroupedAlert, ApiPrescription, ApiPrescriptionLine, ApiProcessLine, ApiRestockRequest, ApiSale, ApiSalesStats, ApiStockMovement, ApiSupplier,
} from '../../../interfaces/api';
import { PharmaDemandes } from '../pharma-demandes/pharma-demandes';
import { SimpleProfile } from '../profile/profile';

import { ModalA11y } from '../../../directives/modal-a11y/modal-a11y';
import { FieldLabel } from '../../../directives/field-label/field-label';
import { TableLabels } from '../../../directives/table-labels/table-labels';
type BarTone = 'green' | 'amber' | 'red' | 'blue';
type StatusFilter = 'all' | 'ok' | 'low' | 'out';
type ExpiryFilter = 'all' | 'soon' | 'expired';

/** Texte comparable : minuscules, sans accents (« Paracétamol » = « paracetamol »). */
const fold = (text: string): string => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Données du tableau de bord rechargeables séparément (une action ne recharge que ce qu'elle modifie). */
type Resource = 'stock' | 'history' | 'demandes' | 'requests' | 'prescriptions' | 'grouped' | 'sales';
const ALL_RESOURCES: readonly Resource[] = ['stock', 'history', 'demandes', 'requests', 'prescriptions', 'grouped', 'sales'];
/** Au retour sur l'onglet, données plus vieilles que ce délai : on actualise. */
const STALE_AFTER_MS = 5 * 60 * 1000;

/** Médicament du catalogue (saisie assistée). */
type CatalogueItem = { id: number; name: string; label: string };
type LineAction = 'reserve' | 'orient' | 'substitute';
/** Ligne en cours de saisie dans « Traiter l'ordonnance ». */
interface DraftLine {
  key: number;
  input: string;
  medicine: CatalogueItem | null;
  qty: number;
  action: LineAction;
  targetId: number | null;
  substituteId: number | null;
  /** Officines proches qui ont la quantité (orientation), triées par distance. */
  options: AvailabilityRow[];
  /** Équivalents de même DCI présents dans le stock de l'officine. */
  equivalents: { id: number; label: string; available: number }[];
  loading: boolean;
  /** Message renvoyé par le serveur pour cette ligne (rien n'est enregistré tant qu'une ligne échoue). */
  error: string | null;
}

/** Élément de la file « À traiter maintenant » (accueil) : une action précise par ligne. */
interface TodoItem {
  key: string; tone: 'red' | 'amber' | 'blue'; icon: string;
  title: string; detail: string; action: string; primary: boolean; run: () => void;
  /** 0 = rupture sans demande, 1 = urgent, 2 = courant. */
  rank: number;
}

/** Ligne du panier de vente (module Vente & Comptabilité). */
interface CartLine { stockId: number; name: string; qty: number; price: number; requiresRx: boolean; available: number; }

const EMPTY_SET: ReadonlySet<number> = new Set<number>();

/* ============================================================
   PHARMACIEN — tableau de bord, stock (lots / péremption), alertes,
   demandes, ordonnances, ventes (offre Pro), réceptions, réseau.
   ============================================================ */
@Component({
  selector: 'app-pharma-dash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalA11y, FieldLabel, TableLabels, Icon, Card, PageHead, Stat, Bar, Tag, PharmaDemandes, SimpleProfile, PartnersPanel, IncomingDeliveries, ExpiryTag, DatePipe, DecimalPipe, NgTemplateOutlet],
  templateUrl: './pharma.html',
  styleUrl: './pharma.css',
  host: {
    '(document:click)': 'closeOpenMenus($event)',
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
})
export class PharmaDash {
  private readonly platform = inject(PlatformState);
  private readonly pharmacy = inject(PharmacyService);
  private readonly medicines = inject(MedicineService);
  private readonly structures = inject(StructureService);
  private readonly injector = inject(Injector);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly auth = inject(AuthService);

  readonly section = model.required<string>();
  /** Premier chargement seulement : les rafraîchissements après une action gardent l'écran affiché. */
  readonly loading = signal(true);
  /** Le stock n'a pas pu être chargé : écran d'erreur avec « Réessayer » (un stock vide serait trompeur). */
  readonly stockError = signal(false);
  /** Données secondaires en échec (demandes, ordonnances…) : bandeau discret avec « Réessayer ». */
  readonly failedLoads = signal<ReadonlySet<string>>(new Set());
  readonly failedLabel = computed(() => [...this.failedLoads()].join(', '));
  /** Heure de la dernière lecture réussie du stock : affichée pour savoir si l'écran est à jour. */
  readonly lastSync = signal<Date | null>(null);
  /** Lectures en cours (actualisation discrète, l'écran reste affiché). */
  readonly inFlight = signal(0);
  /** Une requête d'écriture est en cours : boutons de validation désactivés (pas de double envoi). */
  readonly saving = signal(false);
  /** Catalogue (nom + forme/dosage) proposé en saisie assistée ; chargé à la première ouverture d'un formulaire. */
  readonly catalogue = signal<{ id: number; name: string; label: string }[]>([]);
  readonly rejectModal = signal<ApiPrescription | null>(null);
  readonly rejectReasons: readonly string[] = [
    'Ordonnance illisible ou incomplète',
    'Ordonnance expirée',
    'Médicament non disponible à l\'officine',
    'Original de l\'ordonnance exigé (médicament contrôlé)',
    'Autre motif',
  ];
  readonly stock = signal<StockRow[]>([]);
  readonly demandes = signal<DemandeRow[]>([]);

  readonly addRefModal = signal(false);
  readonly restockModal = signal<StockRow | null>(null);
  readonly sellModal = signal<StockRow | null>(null);
  readonly adjustModal = signal<StockRow | null>(null);
  readonly expireModal = signal<StockRow | null>(null);
  /** Corriger la fiche d'une ligne : seuils, lot, péremption. */
  readonly editModal = signal<StockRow | null>(null);

  // --- Filtres du stock : statut, médicament contrôlé, péremption proche ---
  readonly statusFilter = signal<StatusFilter>('all');
  readonly controlledOnly = signal(false);
  readonly expiryFilter = signal<ExpiryFilter>('all');
  /** Recherche au comptoir : nom, forme ou dosage, sans tenir compte des accents ni de la casse. */
  readonly stockQuery = signal('');
  readonly filteredStock = computed(() => {
    const status = this.statusFilter();
    const expiry = this.expiryFilter();
    const q = fold(this.stockQuery().trim());
    const severity: Record<string, number> = { out: 0, crit: 1, low: 2, ok: 3 };
    return this.stock().filter(s =>
      (!q || fold(s.name + ' ' + s.sub).includes(q))
      && (status === 'all' || (status === 'out' ? s.s === 'out' || s.s === 'crit' : s.s === status))
      && (!this.controlledOnly() || s.controlled)
      && (expiry === 'all'
        || (expiry === 'expired' ? s.expiryLevel === 'expired' : ['warn', 'crit', 'expired'].includes(s.expiryLevel))))
      // Les lignes qui demandent une action d'abord, puis l'ordre alphabétique.
      .sort((a, b) => (severity[a.s] ?? 3) - (severity[b.s] ?? 3) || a.name.localeCompare(b.name, 'fr'));
  });
  /** Filtres secondaires actifs (repliés sur téléphone : le nombre s'affiche sur le bouton). */
  readonly secondaryFilters = computed(() => (this.controlledOnly() ? 1 : 0) + (this.expiryFilter() !== 'all' ? 1 : 0));
  readonly anyStockFilter = computed(() => !!this.stockQuery().trim() || this.statusFilter() !== 'all' || this.secondaryFilters() > 0);
  readonly resultCountLabel = computed(() => {
    const shown = this.plural(this.filteredStock().length, 'référence', 'références');
    return (this.anyStockFilter() ? `${shown} sur ${this.stock().length}` : shown) + ' · les plus urgentes en premier';
  });
  /** Téléphone : les filtres secondaires se replient sous « Autres filtres ». */
  readonly isPhone = signal(typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);

  resetStockFilters(): void {
    this.stockQuery.set('');
    this.statusFilter.set('all');
    this.controlledOnly.set(false);
    this.expiryFilter.set('all');
  }

  // Demande de réapprovisionnement ciblée : fournisseurs (lus en base avec
  // leur stock du médicament) + sélection multiple.
  readonly supplierModal = signal<StockRow | null>(null);
  readonly suppliers = signal<ApiSupplier[]>([]);
  readonly suppliersLoading = signal(false);
  /** La liste des fournisseurs n'a pas pu être lue : la fenêtre propose « Réessayer ». */
  readonly suppliersError = signal(false);
  /** Aucun fournisseur n'a le médicament : la fenêtre propose les solutions de repli. */
  readonly noSupplierStock = computed(() => !this.suppliersLoading() && !this.suppliersError()
    && this.suppliers().length > 0 && this.suppliers().every(d => !d.has_stock));
  readonly selectedSuppliers = signal<Set<number>>(new Set());
  readonly sending = signal(false);
  // Suivi des demandes envoyées (en attente / livraison planifiée / rejetée).
  readonly restockRequests = signal<ApiRestockRequest[]>([]);
  readonly pendingRequests = computed(() => this.restockRequests().filter(r => r.status === 'pending'));
  /** Suivi en cours : en attente (les plus anciennes en tête), livraisons en retard, refus récents, livraisons prévues. */
  readonly activeRequests = computed(() => {
    const rank = (r: ApiRestockRequest) => r.status === 'pending' ? 0 : r.delivery_late ? 1 : r.status === 'rejected' ? 2 : 3;
    return this.restockRequests().filter(r => !this.isPastRequest(r))
      .sort((a, b) => rank(a) - rank(b) || (b.age_days ?? 0) - (a.age_days ?? 0));
  });
  /** Historique replié : livrées, refusées, annulées, closes — les plus récentes d'abord. */
  readonly pastRequests = computed(() => this.restockRequests().filter(r => this.isPastRequest(r))
    .sort((a, b) => (a.age_days ?? 0) - (b.age_days ?? 0)));
  /** Demandes en cours d'envoi (relance / annulation) : boutons désactivés, pas de double envoi. */
  readonly busyRequests = signal<ReadonlySet<number>>(new Set());
  /** Fournisseurs déjà sollicités (demande en attente), indexés par médicament — calculé une fois par changement. */
  readonly askedByMedicine = computed(() => {
    const index = new Map<number, Set<number>>();
    for (const r of this.pendingRequests()) {
      if (r.medicine_id === null || !r.distributor_id) continue;
      let set = index.get(r.medicine_id);
      if (!set) { set = new Set(); index.set(r.medicine_id, set); }
      set.add(r.distributor_id);
    }
    return index;
  });
  /** Médicaments ayant une demande en attente adressée à tout le réseau (anciennes demandes non ciblées). */
  readonly networkAsked = computed(() => new Set(this.pendingRequests()
    .filter(r => r.medicine_id !== null && !r.distributor_id).map(r => r.medicine_id as number)));
  /** Prochaine livraison planifiée (date à venir) par médicament. */
  readonly nextDelivery = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    const next = new Map<number, string>();
    for (const r of this.restockRequests()) {
      if (r.status !== 'resolved' || !r.delivery_date || r.medicine_id === null || r.delivery_date < today) continue;
      const known = next.get(r.medicine_id);
      if (!known || r.delivery_date < known) next.set(r.medicine_id, r.delivery_date);
    }
    return next;
  });

  // Ordonnances numériques reçues
  readonly prescriptions = signal<ApiPrescription[]>([]);
  readonly processModal = signal<ApiPrescription | null>(null);
  /** Ordonnance affichée à côté du formulaire de traitement (lue depuis l'API, jamais devinée). */
  readonly ordoPreview = signal<{ url: string; safe: SafeResourceUrl; kind: 'image' | 'pdf' | 'other' } | null>(null);
  readonly ordoPreviewState = signal<'idle' | 'loading' | 'error'>('idle');
  /** Lignes de l'ordonnance en cours de traitement (2 à 4 en général, 8 au plus). */
  readonly draftLines = signal<DraftLine[]>([]);
  private nextLineKey = 1;
  readonly maxLines = 8;
  /** Récapitulatif affiché au pied de la fenêtre : ce qui va se passer en validant. */
  readonly processSummary = computed(() => {
    const lines = this.draftLines().filter(l => l.medicine);
    const n = (a: LineAction) => lines.filter(l => l.action === a && this.lineReady(l)).length;
    return [
      n('reserve') ? this.plural(n('reserve'), 'ligne réservée ici', 'lignes réservées ici') : '',
      n('orient') ? this.plural(n('orient'), 'orientée', 'orientées') + ' vers une autre officine' : '',
      n('substitute') ? this.plural(n('substitute'), 'équivalent proposé', 'équivalents proposés') + ' au patient' : '',
    ].filter(Boolean).join(' · ');
  });
  readonly canSubmitProcess = computed(() => {
    const lines = this.draftLines();
    return lines.length > 0 && lines.every(l => this.lineReady(l));
  });
  readonly pendingPrescriptions = computed(() => this.prescriptions().filter(p => p.status === 'pending').length);

  // Alertes groupées reçues (recherches patient)
  readonly groupedAlerts = signal<ApiGroupedAlert[]>([]);

  // Historique complet des mouvements (traçabilité : qui / quoi / quand / pourquoi)
  readonly history = signal<ApiStockMovement[]>([]);

  readonly crit = computed(() => this.stock().filter(s => s.s === 'crit' || s.s === 'out'));
  readonly alerts = computed(() => {
    const order: Record<string, number> = { out: 0, crit: 1, low: 2 };
    return this.stock().filter(s => s.s !== 'ok').sort((a, b) => (order[a.s] ?? 3) - (order[b.s] ?? 3));
  });
  /** Quantité disponible de l'officine par médicament — affichée sur chaque alerte groupée. */
  readonly ownQtyByMedicine = computed(() => new Map(this.stock().map(s => [s.medId, s.q])));
  readonly stockByMedicine = computed(() => new Map(this.stock().map(s => [s.medId, s])));
  readonly lowCount = computed(() => this.stock().filter(s => s.s === 'low').length);
  /** Titre du bandeau d'alertes : compte exactement les lignes de la liste (ruptures/critiques + stocks faibles). */
  readonly alertBannerTitle = computed(() => {
    const head = this.plural(this.crit().length, 'médicament en rupture ou critique', 'médicaments en rupture ou critiques');
    const low = this.lowCount();
    return low > 0 ? `${head}, ${this.plural(low, 'autre en stock faible', 'autres en stock faible')}` : head;
  });
  readonly newDem = computed(() => this.demandes().filter(d => d.status === 'pending').length);
  /** État du stock à l'accueil : les lignes les plus tendues d'abord. */
  readonly topStock = computed(() => {
    const order: Record<string, number> = { out: 0, crit: 1, low: 2, ok: 3 };
    return [...this.stock()].sort((a, b) => (order[a.s] ?? 3) - (order[b.s] ?? 3)).slice(0, 5);
  });

  /** Tout ce qui attend une action du pharmacien, trié par urgence — l'écran d'accueil part de là. */
  readonly todo = computed<TodoItem[]>(() => {
    const items: TodoItem[] = [];
    for (const s of this.crit()) {
      // Demandé, mais rien ne bougera : aucune demande relançable, et la plus récente a plus de 7 jours.
      if (this.requested(s)) {
        const pending = this.pendingRequests().filter(r => r.medicine_id === s.medId);
        const stuck = pending.length > 0 && pending.every(r => !r.can_remind && (r.age_days ?? 0) >= 7);
        if (stuck) {
          const age = Math.min(...pending.map(r => r.age_days ?? 0));
          items.push({
            key: 'stuck-' + s.stockId, tone: 'red', icon: 'alert', rank: 0, primary: true,
            title: `${s.name} — ${s.s === 'out' ? 'rupture' : 'stock critique'}, demande sans réponse`,
            detail: `${this.plural(s.q, 'unité restante', 'unités restantes')} · demande ${pending.some(r => !r.distributor_id) ? 'réseau ' : ''}envoyée il y a ${this.plural(age, 'jour', 'jours')}, impossible à relancer`,
            action: "Demander à d'autres", run: () => this.alertDistrib(s),
          });
        }
        continue;
      }
      items.push({
        key: 'crit-' + s.stockId, tone: 'red', icon: 'alert', rank: 0, primary: true,
        title: `${s.name} — ${s.s === 'out' ? 'rupture' : 'stock critique'}`,
        detail: `${this.plural(s.q, 'unité restante', 'unités restantes')} · aucune demande envoyée à un distributeur`,
        action: 'Demander aux distributeurs', run: () => this.alertDistrib(s),
      });
    }
    for (const s of this.stock()) {
      if (s.expiryLevel !== 'expired') continue;
      items.push({
        key: 'exp-' + s.stockId, tone: 'red', icon: 'clock', rank: 1, primary: false,
        title: `${s.name} — lot périmé encore en stock`,
        detail: `${s.batch ? 'Lot ' + s.batch + ' · ' : ''}${this.plural(s.q, 'unité', 'unités')} à retirer de la vente`,
        action: 'Retirer le lot', run: () => this.expireModal.set(s),
      });
    }
    for (const d of this.demandes()) {
      if (d.status !== 'pending') continue;
      const urgent = d.urgency === 'Critique';
      items.push({
        key: 'dem-' + d.id, tone: urgent ? 'red' : d.urgency === 'Élevé' ? 'amber' : 'blue', icon: 'mail', rank: urgent ? 1 : 2, primary: false,
        title: `${d.from} demande ${d.medName}`,
        detail: `${this.plural(d.qty, 'unité', 'unités')} · urgence ${d.urgency.toLocaleLowerCase('fr')} · ${d.quand}`,
        action: 'Répondre', run: () => this.section.set('dem'),
      });
    }
    for (const p of this.prescriptions()) {
      if (p.status !== 'pending') continue;
      items.push({
        key: 'ordo-' + p.id, tone: 'blue', icon: 'doc', rank: 2, primary: false,
        title: `Ordonnance de ${p.patient ?? 'un patient'}`,
        detail: p.submitted_at ? 'Reçue le ' + this.dayMonth(p.submitted_at) : 'À préparer',
        action: 'Traiter', run: () => this.openProcess(p),
      });
    }
    for (const a of this.groupedAlerts()) {
      items.push({
        key: 'grp-' + a.response_id, tone: 'amber', icon: 'search', rank: 2, primary: false,
        title: `Un patient cherche ${a.medicine}`,
        detail: this.ownQty(a) > 0
          ? `Votre stock : ${this.plural(this.ownQty(a), 'unité', 'unités')} — seule la disponibilité est transmise`
          : 'Votre stock est à 0 — indiquez au patient que vous ne l’avez pas',
        action: 'Répondre', run: () => this.section.set('grouped'),
      });
    }
    for (const r of this.restockRequests()) {
      if (r.status === 'pending' && r.stale && r.can_remind) {
        items.push({
          key: 'stale-' + r.id, tone: 'amber', icon: 'truck', rank: 2, primary: false,
          title: `${r.medicine ?? 'Demande'} — ${r.distributor} n'a pas répondu`,
          detail: `Demande envoyée ${this.ageLabel(r)} · ${r.quantity ?? '?'} u.`,
          action: 'Relancer', run: () => this.remindRequest(r),
        });
      } else if (r.delivery_late) {
        items.push({
          key: 'late-' + r.id, tone: 'amber', icon: 'truck', rank: 2, primary: false,
          title: `${r.medicine ?? 'Livraison'} — livraison en retard`,
          detail: `${r.distributor} · prévue le ${r.delivery_date ? this.dayMonth(r.delivery_date) : '?'} — vérifiez dans Réceptions ou contactez le distributeur`,
          action: 'Voir les réceptions', run: () => this.section.set('recep'),
        });
      }
    }
    return items.sort((x, y) => x.rank - y.rank);
  });

  /** Clic hors d'un menu « Plus » ouvert : on le referme (comportement attendu d'un menu déroulant). */
  closeOpenMenus(event: MouseEvent): void {
    const target = event.target as Node | null;
    document.querySelectorAll<HTMLDetailsElement>('details.pf-more[open]').forEach(menu => {
      if (!target || !menu.contains(target)) menu.open = false;
    });
  }

  /** Ferme le menu « Plus » d'une ligne de stock (élément <details>) et rend le focus à son bouton. */
  closeMore(menu: HTMLDetailsElement, refocus = false): void {
    menu.open = false;
    if (refocus) menu.querySelector('summary')?.focus();
  }
  /** Lots orange / rouge (péremption < 3 mois ou dépassée). */
  readonly expiring = computed(() => this.stock()
    .filter(s => ['warn', 'crit', 'expired'].includes(s.expiryLevel))
    .sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0)));
  readonly expiredCount = computed(() => this.stock().filter(s => s.expiryLevel === 'expired').length);

  readonly structureName = computed(() => this.auth.structure()?.name ?? 'Mon officine');

  // --- Module Vente & Comptabilité (offre Pro) ---
  readonly isPro = this.auth.isPro;
  readonly sales = signal<ApiSale[]>([]);
  readonly salesStats = signal<ApiSalesStats | null>(null);
  readonly cart = signal<CartLine[]>([]);
  readonly vatRate = signal(0);
  readonly savingSale = signal(false);
  readonly cartNeedsRx = computed(() => this.cart().some(l => l.requiresRx));
  /** Médicaments du panier qui exigent une ordonnance (les autres sont en vente libre). */
  readonly rxNames = computed(() => this.cart().filter(l => l.requiresRx).map(l => l.name.split(' · ')[0]).join(', '));
  readonly rxRef = signal('');
  readonly cartTotals = computed(() => {
    const ht = this.cart().reduce((sum, l) => sum + l.qty * l.price, 0);
    const vat = Math.round(ht * this.vatRate()) / 100;
    return { ht, vat, ttc: ht + vat };
  });
  readonly sellable = computed(() => this.stock().filter(s => s.q > 0 && s.expiryLevel !== 'expired'));
  readonly revenueMax = computed(() => Math.max(1, ...(this.salesStats()?.daily ?? []).map(d => d.revenue)));

  readonly partnerTypes: readonly PartnerTypeOption[] = [
    { value: 'distributor', label: 'Distributeur privé' },
    { value: 'pharmacy', label: 'Officine (réseau inter-pharmacies)' },
    { value: 'hospital', label: 'Hôpital / clinique' },
  ];

  readonly profilFields = computed<readonly [string, string][]>(() => {
    const u = this.auth.user();
    if (!u) return [];
    const meta = u.profile_meta ?? {};
    const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
    return [
      ['Titulaire', str(meta['titulaire']) ?? 'Non renseigné'],
      ['Téléphone', u.phone || 'Non renseigné'],
      ['Email', u.email || 'Non renseigné'],
      ['Région', str(meta['region']) ?? u.structure?.region ?? u.structure?.city ?? 'Non renseignée'],
      ['Offre', this.planLabel(u.structure?.plan)],
    ];
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearOrdoPreview());
    const phoneQuery = window.matchMedia('(max-width: 640px)');
    const onPhone = (e: MediaQueryListEvent) => this.isPhone.set(e.matches);
    phoneQuery.addEventListener('change', onPhone);
    inject(DestroyRef).onDestroy(() => phoneQuery.removeEventListener('change', onPhone));
    this.reload();
    // Les pastilles de la sidebar comptent ce que les pages affichent — jamais un autre chiffre.
    effect(() => this.platform.navCounts.set({
      alert: this.alerts().length,
      dem: this.newDem(),
      ordo: this.pendingPrescriptions(),
      grouped: this.groupedAlerts().length,
    }));
    inject(DestroyRef).onDestroy(() => this.platform.navCounts.set(null));
  }

  /** « 1 médicament », « 2 médicaments » — accord du nom avec le nombre. */
  plural(n: number, one: string, many: string): string { return `${n} ${n > 1 ? many : one}`; }

  /** Tout recharger : premier affichage, « Actualiser », retour sur l'onglet après une longue absence. */
  reload(): void { this.refresh(...ALL_RESOURCES); }

  /**
   * Recharge uniquement les données touchées par une action. Sur une 3G à
   * 300–600 ms par aller-retour, 2 appels au lieu de 8 font la différence.
   */
  refresh(...what: Resource[]): void {
    for (const resource of new Set(what)) {
      switch (resource) {
        case 'stock':
          this.inFlight.update(n => n + 1);
          this.pharmacy.stock().pipe(finalize(() => this.inFlight.update(n => n - 1))).subscribe({
            next: s => { this.stock.set(s); this.stockError.set(false); this.loading.set(false); this.lastSync.set(new Date()); },
            // Échec : on garde les données déjà affichées ; au premier chargement, écran d'erreur.
            error: () => { this.stockError.set(this.stock().length === 0); this.loading.set(false); if (this.stock().length) this.platform.notify('Stock non actualisé — connexion instable', 'alert'); },
          });
          break;
        case 'history': this.track('historique', this.pharmacy.movements(), m => this.history.set(m)); break;
        case 'demandes': this.track('demandes', this.pharmacy.demandes(), d => this.demandes.set(d)); break;
        case 'requests': this.track('demandes fournisseurs', this.pharmacy.restockRequests(), r => this.restockRequests.set(r)); break;
        case 'prescriptions': this.track('ordonnances', this.pharmacy.prescriptions(), p => this.prescriptions.set(p)); break;
        case 'grouped': this.track('alertes groupées', this.pharmacy.groupedAlerts(), g => this.groupedAlerts.set(g)); break;
        case 'sales': if (this.isPro()) this.reloadSales(); break;
      }
    }
  }

  /** Retour sur l'onglet (comptoir interrompu) : actualise si l'écran date de plus de 5 min. */
  onVisibilityChange(): void {
    const last = this.lastSync();
    if (document.visibilityState === 'visible' && last && Date.now() - last.getTime() > STALE_AFTER_MS && this.inFlight() === 0) {
      this.reload();
    }
  }

  /** Une demande patient a changé (acceptée, orientée, retirée) : réservations et stock bougent aussi. */
  onDemandesChanged(): void { this.refresh('demandes', 'stock', 'history'); }
  /** Une livraison a été réceptionnée : stock crédité, demande fournisseur éventuellement close. */
  onDeliveryReceived(): void { this.refresh('stock', 'history', 'requests'); }

  retry(): void {
    this.loading.set(this.stock().length === 0);
    this.stockError.set(false);
    this.reload();
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

  /** Charge le catalogue une seule fois (saisie assistée des médicaments). */
  private ensureCatalogue(): void {
    if (this.catalogue().length) return;
    this.medicines.list().subscribe({ next: list => this.catalogue.set(list), error: () => { /* la saisie reste possible, résolue par nom */ } });
  }

  /** Médicament choisi dans la liste : correspondance exacte du libellé, sinon nom exact et unique — jamais « le premier résultat ». */
  private resolveMedicine(input: string): { id: number; name: string; label: string } | null {
    const value = input.trim().toLocaleLowerCase('fr');
    const list = this.catalogue();
    const byLabel = list.find(m => m.label.toLocaleLowerCase('fr') === value);
    if (byLabel) return byLabel;
    const byName = list.filter(m => m.name.toLocaleLowerCase('fr') === value);
    return byName.length === 1 ? byName[0] : null;
  }

  openAddRef(): void { this.ensureCatalogue(); this.addRefModal.set(true); }

  private apiError(e: HttpErrorResponse, fallback: string): string {
    return (e.error as ApiErrorBody | null)?.message ?? fallback;
  }

  planLabel(plan: string | null | undefined): string {
    return plan === 'pro' ? 'Pro' : plan === 'institutionnel' ? 'Institutionnel' : 'Starter';
  }

  /** Niveau sur une échelle 0 → 2 × seuil : le seuil tombe au milieu de la barre (repère). */
  pct(s: StockRow): number {
    if (s.seuil > 0) return Math.min(100, Math.round((s.q / (s.seuil * 2)) * 100));
    return s.q > 0 ? 100 : 0;
  }
  thresholdMark(s: StockRow): number | null { return s.seuil > 0 ? 50 : null; }
  levelText(s: StockRow): string { return `${this.plural(s.q, 'unité', 'unités')}, seuil ${s.seuil}`; }
  barTone(s: StockRow): BarTone { return s.s === 'ok' ? 'green' : s.s === 'low' ? 'amber' : 'red'; }
  urg(u: string): string { return u === 'Critique' ? 'crit' : u === 'Élevé' ? 'low' : 'new'; }
  homeBadge(s: StockRow): string {
    return s.s === 'ok' ? s.q + ' u.' : s.s === 'low' ? 'Stock faible · ' + s.q : s.s === 'out' ? 'Rupture' : 'Critique · ' + s.q;
  }
  stateLabel(s: string): string {
    return s === 'ok' ? 'En stock' : s === 'low' ? 'Stock faible' : s === 'out' ? 'Rupture' : 'Critique';
  }
  alertLabel(s: string): string { return s === 'low' ? 'Stock faible' : s === 'out' ? 'Rupture' : 'Critique'; }

  /** Libellé texte de la péremption (listes) — le code couleur est rendu par <pf-expiry>. */
  expiryLabel(s: StockRow): string {
    if (s.expiryLevel === 'none' || !s.expiry) return 'Non renseignée';
    const date = new Date(s.expiry).toLocaleDateString('fr-FR');
    if (s.expiryLevel === 'expired') return `Périmé (${date})`;
    return s.daysToExpiry !== null && s.daysToExpiry < 90 ? `${date} · J-${s.daysToExpiry}` : date;
  }

  /** Un mouvement ordinaire (vente, sortie, ajustement) est neutre ; seuls un lot périmé ou une tension sont des alertes. */
  movementTag(m: ApiStockMovement): string {
    return m.type === 'tension_detected' || m.type === 'expired' ? 'crit'
      : m.direction === 'entrée' ? 'ok' : 'vue';
  }
  /** Ordonnance : à traiter (orange), prête ou retirée (vert), refusée (neutre — ce n'est pas une alerte). */
  ordoTile(status: string): string { return status === 'pending' ? 'amber' : status === 'cancelled' ? '' : 'green'; }
  signedQty(m: ApiStockMovement): string {
    return m.direction === 'entrée' ? '+' + m.quantity : m.direction === 'sortie' ? '−' + m.quantity : '—';
  }
  when(iso: string | null): string { return iso ? new Date(iso).toLocaleString('fr-FR') : ''; }

  restock(s: StockRow): void { this.restockModal.set(s); }

  submitRestock(qtyInput: string): void {
    const s = this.restockModal();
    if (!s) return;
    const qty = parseInt(qtyInput, 10);
    if (isNaN(qty) || qty <= 0) { this.platform.notify('Indiquez une quantité supérieure à 0', 'alert'); return; }
    this.saving.set(true);
    this.pharmacy.restock(s.stockId, qty).subscribe({
      next: () => {
        this.saving.set(false);
        this.platform.notify(`${this.plural(qty, 'unité ajoutée', 'unités ajoutées')} au stock de ${s.name}`, 'ok');
        this.restockModal.set(null);
        this.refresh('stock', 'history');
      },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.platform.notify(this.apiError(e, 'Échec du réapprovisionnement — réessayez'), 'alert'); },
    });
  }

  submitAddRef(name: string, qty: string, seuil: string, batch: string, expiry: string): void {
    const quantity = parseInt(qty, 10);
    const threshold = parseInt(seuil, 10);
    if (isNaN(quantity) || quantity < 0 || isNaN(threshold) || threshold < 0) {
      this.platform.notify('Quantité et seuil doivent être des nombres positifs', 'alert');
      return;
    }
    const medicine = this.resolveMedicine(name);
    if (!medicine) {
      this.platform.notify(name.trim() ? `« ${name.trim()} » n'est pas dans le catalogue — choisissez une ligne de la liste` : 'Choisissez un médicament dans la liste', 'alert');
      return;
    }
    this.saving.set(true);
    this.pharmacy.addStock(medicine.id, quantity, threshold, batch.trim(), expiry).subscribe({
      next: () => { this.saving.set(false); this.platform.notify(`${medicine.label} a été ajouté au stock`, 'ok'); this.addRefModal.set(false); this.refresh('stock', 'history'); },
      error: (e: HttpErrorResponse) => { this.saving.set(false); this.platform.notify(this.apiError(e, 'Cette référence existe peut-être déjà dans le stock'), 'alert'); },
    });
  }

  // --- Vente hors plateforme (sans facture) ---
  sell(s: StockRow): void { this.sellRx.set(''); this.sellModal.set(s); }
  /** Référence d'ordonnance saisie dans la vente rapide (contrôlés / sur ordonnance). */
  readonly sellRx = signal('');

  submitSell(qtyInput: string): void {
    const rxRef = this.sellRx();
    const s = this.sellModal();
    if (!s) return;
    const qty = parseInt(qtyInput, 10);
    if (isNaN(qty) || qty <= 0 || qty > s.q) {
      this.platform.notify(`Quantité entre 1 et ${s.q}`, 'alert');
      return;
    }
    // Même règle que la vente avec reçu : pas de stupéfiant ni de médicament sur ordonnance sans référence.
    if ((s.controlled || s.requiresRx) && !rxRef.trim()) {
      this.platform.notify(`${s.controlled ? 'Médicament contrôlé' : 'Médicament sur ordonnance'} : indiquez la référence de l'ordonnance`, 'alert');
      return;
    }
    this.saving.set(true);
    this.pharmacy.externalSale(s.stockId, qty, 'Vente hors plateforme', rxRef.trim() || undefined).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.platform.notify(`Vente de ${this.plural(qty, 'unité', 'unités')} enregistrée`, 'ok');
        this.sellModal.set(null);
        this.refresh('stock', 'history');
      },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec de la vente'), 'alert'),
    });
  }

  // --- Ajustement d'inventaire : le stock réel constaté, l'écart est calculé par le serveur ---
  adjust(s: StockRow): void { this.adjustModal.set(s); }
  submitAdjust(realInput: string, motif: string): void {
    const s = this.adjustModal();
    if (!s) return;
    const real = parseInt(realInput, 10);
    if (isNaN(real) || real < 0) { this.platform.notify('Quantité réelle invalide', 'alert'); return; }
    this.saving.set(true);
    this.pharmacy.inventoryAdjustment(s.stockId, real + s.reserved, motif).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        const diff = real - s.q;
        this.platform.notify(diff === 0 ? 'Stock conforme — aucun écart' : `Écart d'inventaire enregistré (${diff > 0 ? '+' : ''}${diff})`, 'info');
        this.adjustModal.set(null);
        this.refresh('stock', 'history');
      },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec de l\'ajustement'), 'alert'),
    });
  }

  // --- Correction de la fiche (seuils, lot, péremption) ---
  submitEdit(thresholdInput: string, criticalInput: string, batch: string, expiry: string): void {
    const s = this.editModal();
    if (!s) return;
    const threshold = parseInt(thresholdInput, 10);
    const critical = criticalInput.trim() === '' ? null : parseInt(criticalInput, 10);
    if (isNaN(threshold) || threshold < 0) { this.platform.notify("Seuil d'alerte : un nombre positif", 'alert'); return; }
    if (critical !== null && (isNaN(critical) || critical < 1)) { this.platform.notify('Seuil critique : au moins 1, ou laissez vide', 'alert'); return; }
    if (critical !== null && threshold > 0 && critical >= threshold) {
      this.platform.notify(`Le seuil critique doit être inférieur au seuil d'alerte (${threshold})`, 'alert');
      return;
    }
    this.saving.set(true);
    this.pharmacy.updateStock(s.stockId, {
      threshold_qty: threshold, critical_threshold: critical, batch_number: batch.trim() || null, expiry_date: expiry || null,
    }).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => { this.platform.notify(`Fiche de ${s.name} mise à jour`, 'ok'); this.editModal.set(null); this.refresh('stock'); },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Fiche non enregistrée — réessayez'), 'alert'),
    });
  }

  // --- Retrait d'un lot périmé ---
  submitExpire(qtyInput: string, reason: string): void {
    const s = this.expireModal();
    if (!s) return;
    const qty = qtyInput ? parseInt(qtyInput, 10) : undefined;
    if (qty !== undefined && (isNaN(qty) || qty <= 0)) { this.platform.notify('Quantité invalide', 'alert'); return; }
    this.saving.set(true);
    this.pharmacy.expire(s.stockId, qty, reason.trim() || undefined).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: r => { this.platform.notify(r.message, 'ok'); this.expireModal.set(null); this.refresh('stock', 'history'); },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec du retrait'), 'alert'),
    });
  }

  // --- Demande de réapprovisionnement aux fournisseurs ---

  /** Ouvre le choix des fournisseurs : ceux qui disposent du médicament sont proposés en premier. */
  alertDistrib(s: StockRow): void {
    this.supplierModal.set(s);
    this.suppliers.set([]);
    this.selectedSuppliers.set(new Set());
    this.suppliersError.set(false);
    this.suppliersLoading.set(true);
    this.structures.suppliers(s.medId).subscribe({
      next: list => {
        this.suppliers.set(list);
        this.suppliersLoading.set(false);
        // Pré-sélection : les fournisseurs qui ont le médicament et ne sont pas déjà sollicités.
        const asked = this.alreadyAsked(s);
        this.selectedSuppliers.set(new Set(list.filter(d => d.has_stock && !asked.has(d.id)).map(d => d.id)));
        // La liste arrive après l'ouverture : le focus va au premier fournisseur, pas sous la liste.
        afterNextRender({ read: () => document.querySelector<HTMLInputElement>('.pf-modal .pf-check:not(:disabled)')?.focus() }, { injector: this.injector });
      },
      error: () => { this.suppliersLoading.set(false); this.suppliersError.set(true); },
    });
  }

  /** Une demande est en attente pour ce médicament (fournisseurs ciblés ou tout le réseau). */
  requested(s: StockRow): boolean { return this.alreadyAsked(s).size > 0 || this.networkAsked().has(s.medId); }
  requestedLabel(s: StockRow): string {
    const n = this.alreadyAsked(s).size;
    return n > 0 ? `Demandé à ${this.plural(n, 'distributeur', 'distributeurs')}` : 'Demandé au réseau';
  }
  /** Depuis la fenêtre fournisseurs : orienter les patients pendant la rupture. */
  goOrient(): void { this.supplierModal.set(null); this.section.set('dem'); }

  /** Fournisseurs ayant déjà une demande en attente pour ce stock. */
  alreadyAsked(s: StockRow): ReadonlySet<number> {
    return this.askedByMedicine().get(s.medId) ?? EMPTY_SET;
  }

  toggleSupplier(id: number): void {
    const next = new Set(this.selectedSuppliers());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selectedSuppliers.set(next);
  }

  suggestedQty(s: StockRow): number {
    return s.seuil > 0 ? Math.max(1, s.seuil * 3 - s.q) : 100;
  }

  submitSupplierRequest(qtyInput: string, message: string): void {
    const s = this.supplierModal();
    if (!s) return;
    const ids = [...this.selectedSuppliers()];
    if (ids.length === 0) { this.platform.notify('Sélectionnez au moins un fournisseur', 'alert'); return; }
    const qty = parseInt(qtyInput, 10);
    if (isNaN(qty) || qty <= 0) { this.platform.notify('Quantité invalide', 'alert'); return; }

    this.sending.set(true);
    this.pharmacy.alertDistributor(s.stockId, ids, qty, message.trim() || undefined).subscribe({
      next: res => {
        this.sending.set(false);
        const names = res.data.map(d => d.distributor).join(', ');
        this.platform.notify(res.data.length ? `Demande envoyée à ${names}` : 'Demande déjà en attente chez ces fournisseurs', res.data.length ? 'ok' : 'info');
        this.supplierModal.set(null);
        this.track('demandes fournisseurs', this.pharmacy.restockRequests(), r => this.restockRequests.set(r));
      },
      error: (e: HttpErrorResponse) => { this.sending.set(false); this.platform.notify(this.apiError(e, 'Échec de l\'envoi de la demande'), 'alert'); },
    });
  }

  requestStatusLabel(r: ApiRestockRequest): string {
    if (r.status === 'cancelled') return 'Annulée';
    if (r.status === 'closed') return 'Close — stock revenu';
    if (r.status === 'pending' && r.stale) return `Sans réponse depuis ${this.plural(r.age_days ?? 0, 'jour', 'jours')}`;
    if (r.delivery_late) return 'Livraison en retard' + (r.delivery_date ? ' (prévue le ' + this.dayMonth(r.delivery_date) + ')' : '');
    if (r.status === 'resolved' && r.delivery_status === 'delivered') return 'Livrée' + (r.delivered_at ? ' le ' + this.dayMonth(r.delivered_at) : '');
    return r.status === 'resolved' ? 'Livraison prévue' + (r.delivery_date ? ' le ' + this.dayMonth(r.delivery_date) : '')
      : r.status === 'rejected' ? 'Refusée' + (r.rejected_at ? ' le ' + this.dayMonth(r.rejected_at) : '')
      : 'En attente de réponse';
  }
  /** Destinataire d'une demande : les anciennes demandes non ciblées étaient adressées à tout le réseau. */
  requestTarget(r: ApiRestockRequest): string {
    return !r.distributor_id || r.distributor === 'Réseau' ? 'Tous les distributeurs partenaires' : r.distributor;
  }
  dayMonth(iso: string): string { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); }
  requestTag(r: ApiRestockRequest): string {
    if (r.status === 'cancelled' || r.status === 'closed') return 'vue';
    if (r.delivery_late || (r.status === 'pending' && r.stale)) return 'low';
    return r.status === 'resolved' ? 'ok' : r.status === 'rejected' ? 'crit' : 'new';
  }
  /** Demande terminée, plus rien à suivre : elle passe dans l'historique (un refus récent reste visible). */
  isPastRequest(r: ApiRestockRequest): boolean {
    if (r.status === 'pending' || r.delivery_late || r.recently_rejected) return false;
    return r.status !== 'resolved' || r.delivery_status === 'delivered';
  }
  requestTile(r: ApiRestockRequest): string {
    if (r.status === 'cancelled' || r.status === 'closed') return '';
    if (r.delivery_late || (r.status === 'pending' && r.stale)) return 'amber';
    return r.status === 'resolved' ? 'green' : r.status === 'rejected' ? 'red' : 'blue';
  }
  /** « il y a 5 j » / « aujourd'hui » — l'âge d'une demande se lit d'un coup d'œil. */
  ageLabel(r: ApiRestockRequest): string {
    const d = r.age_days ?? null;
    return d === null ? '' : d === 0 ? 'aujourd\'hui' : 'il y a ' + this.plural(d, 'jour', 'jours');
  }
  /** Pourquoi « Relancer » est indisponible (infobulle). */
  remindHint(r: ApiRestockRequest): string {
    if (!r.distributor_id) return 'Ancienne demande adressée à tout le réseau : annulez-la puis envoyez une demande ciblée';
    return r.can_remind ? 'Prévenir à nouveau ' + r.distributor : 'Déjà relancée il y a moins de 24 h';
  }

  remindRequest(r: ApiRestockRequest): void { this.requestAction(r, this.pharmacy.remindRestockRequest(r.id), 'ok'); }
  cancelRequest(r: ApiRestockRequest): void { this.requestAction(r, this.pharmacy.cancelRestockRequest(r.id), 'info'); }

  private requestAction(r: ApiRestockRequest, call: Observable<{ message: string }>, kind: 'ok' | 'info'): void {
    if (this.busyRequests().has(r.id)) return;
    this.busyRequests.update(set => new Set(set).add(r.id));
    const done = () => this.busyRequests.update(set => { const next = new Set(set); next.delete(r.id); return next; });
    call.subscribe({
      next: res => {
        done();
        this.platform.notify(res.message, kind);
        this.track('demandes fournisseurs', this.pharmacy.restockRequests(), list => this.restockRequests.set(list));
      },
      error: (e: HttpErrorResponse) => { done(); this.platform.notify(this.apiError(e, 'Action impossible — réessayez'), 'alert'); },
    });
  }

  // --- Ordonnances numériques ---
  /** Traiter : le formulaire s'ouvre avec l'ordonnance à côté, pour recopier sans changer d'écran. */
  openProcess(p: ApiPrescription): void {
    this.ensureCatalogue();
    this.draftLines.set([this.blankLine()]);
    this.processModal.set(p);
    this.loadOrdoPreview(p);
  }

  loadOrdoPreview(p: ApiPrescription): void {
    this.clearOrdoPreview();
    this.ordoPreviewState.set('loading');
    this.pharmacy.downloadPrescription(p.id).subscribe({
      next: blob => {
        if (this.processModal()?.id !== p.id) return; // fenêtre fermée entre-temps
        const url = URL.createObjectURL(blob);
        const kind = blob.type.startsWith('image/') ? 'image' : blob.type === 'application/pdf' ? 'pdf' : 'other';
        // URL locale (blob:) créée à partir de la réponse de notre API : sûre à afficher dans l'aperçu.
        this.ordoPreview.set({ url, kind, safe: this.sanitizer.bypassSecurityTrustResourceUrl(url) });
        this.ordoPreviewState.set('idle');
      },
      error: () => this.ordoPreviewState.set('error'),
    });
  }

  closeProcess(): void {
    this.processModal.set(null);
    this.draftLines.set([]);
    this.clearOrdoPreview();
  }

  private clearOrdoPreview(): void {
    const current = this.ordoPreview();
    if (current) URL.revokeObjectURL(current.url);
    this.ordoPreview.set(null);
    this.ordoPreviewState.set('idle');
  }

  /** Note libre du patient, présentée comme sa parole (entre guillemets), ou absente. */
  patientNote(p: ApiPrescription): string { return p.notes?.trim() ? `Note du patient : « ${p.notes.trim()} »` : 'Pas de note du patient'; }

  downloadOrdo(p: ApiPrescription): void {
    this.pharmacy.downloadPrescription(p.id).subscribe({
      next: blob => saveBlob(blob, `ordonnance-${p.id}`),
      error: () => this.platform.notify('Impossible de télécharger l\'ordonnance', 'alert'),
    });
  }

  // --- Ordonnance multi-lignes ---

  private blankLine(): DraftLine {
    return { key: this.nextLineKey++, input: '', medicine: null, qty: 1, action: 'reserve', targetId: null, substituteId: null, options: [], equivalents: [], loading: false, error: null };
  }

  private patchLine(key: number, patch: Partial<DraftLine>): void {
    this.draftLines.update(lines => lines.map(l => l.key === key ? { ...l, ...patch } : l));
  }

  private line(key: number): DraftLine | undefined { return this.draftLines().find(l => l.key === key); }

  addLine(): void {
    if (this.draftLines().length >= this.maxLines) return;
    const line = this.blankLine();
    this.draftLines.update(lines => [...lines, line]);
    // Le focus va sur le médicament de la nouvelle ligne.
    afterNextRender({ read: () => document.querySelector<HTMLInputElement>(`[data-line="${line.key}"] input[list]`)?.focus() }, { injector: this.injector });
  }

  removeDraftLine(key: number): void { this.draftLines.update(lines => lines.filter(l => l.key !== key)); }

  /** Quantité disponible ici pour la ligne (stock réel, pas une estimation). */
  ownAvailable(l: DraftLine): number { return l.medicine ? (this.stockByMedicine().get(l.medicine.id)?.q ?? 0) : 0; }
  isControlled(l: DraftLine): boolean { return !!l.medicine && !!this.stockByMedicine().get(l.medicine.id)?.controlled; }

  /** ok = assez ici · short = pas assez · none = absent ou à 0 ici. */
  lineState(l: DraftLine): 'ok' | 'short' | 'none' {
    const available = this.ownAvailable(l);
    return available >= l.qty ? 'ok' : available > 0 ? 'short' : 'none';
  }

  lineReady(l: DraftLine): boolean {
    if (!l.medicine || l.qty < 1) return false;
    return l.action === 'reserve' ? this.lineState(l) === 'ok' : l.action === 'orient' ? l.targetId !== null : l.substituteId !== null;
  }

  setLineMedicine(key: number, input: string): void {
    const medicine = this.resolveMedicine(input);
    this.patchLine(key, { input, medicine, error: null, options: [], equivalents: [], targetId: null, substituteId: null });
    this.chooseDefaultAction(key);
  }

  setLineQty(key: number, value: string): void {
    const qty = Math.max(1, Math.min(1000, parseInt(value, 10) || 1));
    this.patchLine(key, { qty, error: null });
    this.chooseDefaultAction(key);
  }

  setLineAction(key: number, action: LineAction): void { this.patchLine(key, { action, error: null }); }
  setLineTarget(key: number, id: string): void { this.patchLine(key, { targetId: Number(id) || null, error: null }); }
  setLineSubstitute(key: number, id: string): void { this.patchLine(key, { substituteId: Number(id) || null, error: null }); }

  /** Assez de stock ici → réserver ; sinon on charge les officines et équivalents et on propose le plus simple. */
  private chooseDefaultAction(key: number): void {
    const l = this.line(key);
    if (!l?.medicine) return;
    if (this.lineState(l) === 'ok') { this.patchLine(key, { action: 'reserve' }); return; }
    const medId = l.medicine.id;
    const qty = l.qty;
    const myId = this.auth.user()?.structure_id;
    const controlled = this.isControlled(l);
    this.patchLine(key, { loading: true });
    forkJoin({
      availability: this.medicines.availability(medId).pipe(catchError(() => of<AvailabilityRow[]>([]))),
      equivalents: controlled ? of([]) : this.medicines.equivalents(medId).pipe(catchError(() => of([]))),
    }).subscribe(({ availability, equivalents }) => {
      const current = this.line(key);
      if (!current || current.medicine?.id !== medId || current.qty !== qty) return; // la ligne a changé entre-temps
      const options = rankByDistance(availability.filter(r => r.structureId !== myId && r.available >= qty), structurePoint(this.auth.user()?.structure));
      const own = equivalents
        .map(e => ({ e, row: this.stockByMedicine().get(e.id) }))
        .filter(({ row }) => !!row && row.q >= qty && !row.controlled)
        .map(({ e, row }) => ({ id: e.id, label: [e.name, e.dosage, e.form].filter(Boolean).join(' · '), available: row!.q }));
      const action: LineAction = options.length ? 'orient' : own.length ? 'substitute' : 'orient';
      this.patchLine(key, { loading: false, options, equivalents: own, action, targetId: options[0]?.structureId ?? null, substituteId: own[0]?.id ?? null });
    });
  }

  submitProcess(): void {
    const p = this.processModal();
    if (!p || !this.canSubmitProcess()) return;
    const payload: ApiProcessLine[] = this.draftLines().map(l => ({
      medicine_id: l.medicine!.id,
      qty: l.qty,
      action: l.action,
      ...(l.action === 'orient' ? { target_structure_id: l.targetId! } : {}),
      ...(l.action === 'substitute' ? { substitute_medicine_id: l.substituteId! } : {}),
    }));
    this.saving.set(true);
    this.pharmacy.processPrescription(p.id, payload).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: res => { this.platform.notify(res.message, 'ok'); this.closeProcess(); this.refresh('prescriptions', 'demandes', 'stock', 'history'); },
      error: (e: HttpErrorResponse) => {
        // 422 : l'erreur de chaque ligne est affichée sous la ligne, la saisie est conservée.
        const errors = (e.error as { errors?: Record<string, string[]> } | null)?.errors ?? {};
        const keys = this.draftLines().map(l => l.key);
        for (const [field, messages] of Object.entries(errors)) {
          const m = /^lines\.(\d+)/.exec(field);
          if (m && keys[Number(m[1])] !== undefined) this.patchLine(keys[Number(m[1])], { error: messages[0] });
        }
        this.platform.notify(this.apiError(e, 'Ordonnance non enregistrée — corrigez les lignes signalées'), 'alert');
      },
    });
  }

  /** Retrait au comptoir d'une ordonnance préparée : les lignes réservées sont débitées. */
  readonly collectingOrdo = signal<number | null>(null);
  collectOrdo(p: ApiPrescription): void {
    if (this.collectingOrdo() !== null) return;
    this.collectingOrdo.set(p.id);
    this.pharmacy.collectDemande(p.id).pipe(finalize(() => this.collectingOrdo.set(null))).subscribe({
      next: () => { this.platform.notify(`Ordonnance de ${p.patient ?? 'ce patient'} retirée`, 'ok'); this.refresh('prescriptions', 'demandes', 'stock', 'history'); },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Retrait non enregistré — réessayez'), 'alert'),
    });
  }

  /** Libellé d'une ligne d'ordonnance traitée, côté officine. */
  ordoLineLabel(l: ApiPrescriptionLine): string {
    switch (l.status) {
      case 'reserved': return 'réservé ici';
      case 'oriented': return 'orienté vers ' + (l.target ?? 'une autre officine') + (l.original_required ? ' · original papier exigé' : '');
      case 'substitute_proposed': return `équivalent proposé (prescrit : ${l.prescribed_medicine ?? '—'}) · en attente du patient`;
      case 'substitute_accepted': return `équivalent accepté (prescrit : ${l.prescribed_medicine ?? '—'})`;
      case 'substitute_refused': return 'équivalent refusé par le patient';
      case 'collected': return 'retiré';
      case 'expired': return 'réservation expirée';
      case 'legacy_debited': return 'délivré';
      default: return 'non délivré';
    }
  }
  ordoLineTone(status: string): string {
    return status === 'reserved' || status === 'substitute_accepted' || status === 'collected' || status === 'legacy_debited' ? 'ok'
      : status === 'substitute_refused' || status === 'expired' ? 'crit' : status === 'cancelled' ? 'vue' : 'low';
  }

  ordoLabel(status: string): string {
    return status === 'confirmed' ? 'Prête au retrait' : status === 'collected' ? 'Retirée' : status === 'oriented' ? 'Orientée'
      : status === 'cancelled' ? 'Refusée ou expirée' : 'À traiter';
  }

  /** Le rejet est communiqué au patient : un motif est obligatoire (choisi, précisé si « Autre motif »). */
  submitReject(reason: string, detail: string): void {
    const p = this.rejectModal();
    if (!p) return;
    const text = reason === 'Autre motif' ? detail.trim() : [reason, detail.trim()].filter(Boolean).join(' — ');
    if (!reason || !text) { this.platform.notify('Précisez le motif du rejet', 'alert'); return; }
    this.saving.set(true);
    this.pharmacy.rejectPrescription(p.id, text).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => { this.platform.notify(`Ordonnance de ${p.patient} rejetée — motif transmis au patient`, 'info'); this.rejectModal.set(null); this.refresh('prescriptions'); },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec du rejet — réessayez'), 'alert'),
    });
  }

  // --- Alertes groupées ---
  formLabel(a: ApiGroupedAlert): string { return [a.dosage, a.form].filter(v => !!v).join(' · ') || 'Forme non précisée'; }
  ownQty(a: ApiGroupedAlert): number { return this.ownQtyByMedicine().get(a.medicine_id) ?? 0; }
  /** Ligne de stock du médicament recherché (absente si l'officine ne le référence pas). */
  stockFor(a: ApiGroupedAlert): StockRow | undefined { return this.stockByMedicine().get(a.medicine_id); }

  /** Réponses aux alertes groupées en cours d'envoi : boutons de la ligne désactivés. */
  readonly respondingGrouped = signal<ReadonlySet<number>>(new Set());

  respondGrouped(a: ApiGroupedAlert, available: boolean): void {
    const qty = available ? this.ownQty(a) : undefined;
    // Le patient se déplacerait pour rien : on ne répond « disponible » qu'avec du stock réel.
    if (available && !qty) { this.platform.notify(`Votre stock de ${a.medicine} est à 0 — répondez « Je n'ai pas »`, 'alert'); return; }
    if (this.respondingGrouped().has(a.response_id)) return;
    this.respondingGrouped.update(set => new Set(set).add(a.response_id));
    const done = () => this.respondingGrouped.update(set => { const next = new Set(set); next.delete(a.response_id); return next; });
    this.pharmacy.respondGroupedAlert(a.response_id, available, qty).pipe(finalize(done)).subscribe({
      next: () => { this.platform.notify(available ? 'Disponibilité transmise au patient' : 'Indisponibilité enregistrée', available ? 'ok' : 'info'); this.refresh('grouped'); },
      error: () => this.platform.notify('Échec de la réponse', 'alert'),
    });
  }

  // --- Ventes & comptabilité (offre Pro) ---
  reloadSales(): void {
    this.pharmacy.sales().subscribe({ next: s => this.sales.set(s), error: () => this.sales.set([]) });
    this.pharmacy.salesStats().subscribe({ next: s => this.salesStats.set(s), error: () => this.salesStats.set(null) });
  }

  addToCart(stockIdInput: string, qtyInput: string, priceInput: string): void {
    const s = this.stock().find(r => r.stockId === Number(stockIdInput));
    const qty = parseInt(qtyInput, 10);
    const price = Number(priceInput);
    if (!s || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) { this.platform.notify('Médicament, quantité et prix requis', 'alert'); return; }
    const already = this.cart().find(l => l.stockId === s.stockId)?.qty ?? 0;
    if (qty + already > s.q) { this.platform.notify(`Stock insuffisant : ${this.plural(s.q, 'unité disponible', 'unités disponibles')}`, 'alert'); return; }
    this.cart.update(lines => already
      ? lines.map(l => l.stockId === s.stockId ? { ...l, qty: l.qty + qty, price } : l)
      : [...lines, { stockId: s.stockId, name: s.name + (s.sub ? ' · ' + s.sub : ''), qty, price, requiresRx: s.requiresRx, available: s.q }]);
  }
  removeLine(stockId: number): void { this.cart.update(lines => lines.filter(l => l.stockId !== stockId)); }
  setVat(value: string): void { const v = Number(value); this.vatRate.set(isNaN(v) || v < 0 ? 0 : v); }

  submitSale(customer: string, payment: string): void {
    const rxRef = this.cartNeedsRx() ? this.rxRef() : '';
    if (this.cart().length === 0) { this.platform.notify('Ajoutez au moins un médicament', 'alert'); return; }
    if (this.cartNeedsRx() && !rxRef.trim()) { this.platform.notify(`Référence d'ordonnance requise pour : ${this.rxNames()}`, 'alert'); return; }
    this.savingSale.set(true);
    this.pharmacy.createSale({
      items: this.cart().map(l => ({ stock_id: l.stockId, quantity: l.qty, unit_price: l.price })),
      vat_rate: this.vatRate(),
      customer_name: customer.trim() || undefined,
      prescription_ref: rxRef.trim() || undefined,
      payment_method: payment,
    }).subscribe({
      next: res => {
        this.savingSale.set(false);
        this.platform.notify(res.message, 'ok');
        this.cart.set([]);
        this.rxRef.set('');
        this.refresh('stock', 'history', 'sales');
        this.downloadReceipt(res.data);
      },
      error: (e: HttpErrorResponse) => { this.savingSale.set(false); this.platform.notify(this.apiError(e, 'Échec de la vente'), 'alert'); },
    });
  }

  downloadReceipt(sale: ApiSale): void {
    this.pharmacy.receipt(sale.id).subscribe({
      next: blob => saveBlob(blob, `${sale.receipt_number}.pdf`),
      error: () => this.platform.notify('Reçu indisponible', 'alert'),
    });
  }

  exportSales(from: string, to: string): void {
    this.pharmacy.exportSales(from || undefined, to || undefined).subscribe({
      next: blob => { saveBlob(blob, `ventes-${from || 'mois'}-${to || 'courant'}.csv`); this.platform.notify('Export comptable téléchargé', 'ok'); },
      error: () => this.platform.notify('Échec de l\'export', 'alert'),
    });
  }

  fcfa(v: number): string { return Math.round(v).toLocaleString('fr-FR') + ' FCFA'; }
  barPct(v: number): number { return Math.max(2, Math.round((v / this.revenueMax()) * 100)); }
  shortDate(iso: string): string { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
}
