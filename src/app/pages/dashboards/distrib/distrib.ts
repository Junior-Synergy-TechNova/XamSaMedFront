import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
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
  ApiDestination, ApiErrorBody, ApiForecast, ApiIncomingRequest, ApiInstitutionalOrder, ApiPnaDashboard, ApiShortageReport, ShortageAlert,
} from '../../../interfaces/api';
import { DemandeReg, DeliveryRow, DeliveryStatus, SupplierKind, ZoneInfo } from '../../../interfaces/models';
import { AuthService } from '../../../services/auth/auth';

type BarTone = 'green' | 'amber' | 'red' | 'blue';

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
  imports: [Icon, Card, PageHead, Stat, Bar, Tag, ZoneMap, PartnersPanel, IncomingDeliveries, DatePipe],
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
  readonly autoAlerts = signal<ShortageAlert[]>([]);
  readonly dashboardData = signal<Partial<DistributorDashboard>>({});
  readonly forecasts = signal<ApiForecast[]>([]);
  readonly sel = signal<string | null>(null);
  readonly loading = signal(true);
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
  readonly tensionHigh = computed(() => this.autoAlerts().filter(a => a.severity === 'high').length);
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

  constructor() {
    this.reload();
    this.medicines.list().subscribe({ next: c => this.catalog.set(c), error: () => { /* ignore */ } });
  }

  reload(): void {
    this.loading.set(true);
    this.distributor.dashboard().subscribe({
      next: d => { this.dashboardData.set(d); this.loading.set(false); this.loadInstitutional(); },
      error: () => { this.loading.set(false); this.loadInstitutional(); },
    });
    this.distributor.requests().subscribe({ next: r => this.requests.set(r), error: () => { /* ignore */ } });
    this.distributor.regionalDemands().subscribe({ next: d => this.demandes.set(d), error: () => { /* ignore */ } });
    this.distributor.zones().subscribe({ next: z => this.zones.set(z), error: () => { /* ignore */ } });
    this.distributor.alerts().subscribe({ next: a => this.autoAlerts.set(a), error: () => { /* ignore */ } });
    this.distributor.previsions().subscribe({ next: p => this.forecasts.set(p), error: () => { /* ignore */ } });
    this.distributor.deliveries().subscribe({ next: d => this.deliveries.set(d), error: () => { /* ignore */ } });
    this.distributor.shortageReports().subscribe({ next: r => this.shortageReports.set(r), error: () => { /* ignore */ } });
  }

  /** Flux institutionnel selon le type de structure (lu en base). */
  private loadInstitutional(): void {
    switch (this.distType()) {
      case 'PNA':
        this.distributor.pnaDashboard().subscribe({ next: d => this.pnaDash.set(d), error: () => { /* ignore */ } });
        this.distributor.pnaRequests().subscribe({ next: o => this.pnaRequests.set(o), error: () => { /* ignore */ } });
        this.distributor.pnaOrders().subscribe({ next: o => this.pnaOrders.set(o), error: () => { /* ignore */ } });
        break;
      case 'PRA':
        this.distributor.praOrders().subscribe({ next: o => this.praOrders.set(o), error: () => { /* ignore */ } });
        this.distributor.praPnaOrders().subscribe({ next: o => this.praPnaOrders.set(o), error: () => { /* ignore */ } });
        break;
      default:
        break;
    }
  }

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
    this.distributor.rejectRequest(r.id, reason.trim()).subscribe({
      next: () => { this.platform.notify('Demande refusée — le demandeur est notifié', 'info'); this.rejectModal.set(null); this.reload(); },
      error: e => this.platform.notify(this.apiError(e, 'Échec du refus'), 'alert'),
    });
  }

  requestTag(status: string): string { return status === 'resolved' ? 'ok' : status === 'rejected' ? 'crit' : 'low'; }
  requestStatusLabel(r: ApiIncomingRequest): string {
    return r.status === 'resolved' ? 'Livraison planifiée' + (r.delivery_date ? ' · ' + r.delivery_date : '')
      : r.status === 'rejected' ? 'Refusée' : 'En attente';
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
    this.distributor.createDelivery(sid, mid, q, date, notes.trim() || undefined, ctx.requestId ?? undefined).subscribe({
      next: () => {
        this.platform.notify(`Livraison de ${q} u. de ${medName} planifiée le ${date} vers ${dest}`, 'ok');
        this.planModal.set(null);
        this.reload();
      },
      error: e => this.platform.notify(this.apiError(e, 'Échec de la planification'), 'alert'),
    });
  }

  // ─────────────────────────────────────────────────────────────
  // LIVRAISONS
  // ─────────────────────────────────────────────────────────────

  startTransit(id: string): void {
    this.distributor.changeDeliveryStatus(id, 'En transit').subscribe({
      next: () => { this.platform.notify('La livraison est en transit', 'info'); this.reload(); },
      error: e => this.platform.notify(this.apiError(e, 'Échec du démarrage'), 'alert'),
    });
  }

  confirmDelivery(id: string): void {
    this.distributor.changeDeliveryStatus(id, 'Livrée').subscribe({
      next: () => { this.platform.notify('Livraison confirmée — stocks mis à jour', 'ok'); this.reload(); },
      error: e => this.platform.notify(this.apiError(e, 'Échec de la confirmation'), 'alert'),
    });
  }

  cancelDelivery(id: string): void {
    this.distributor.changeDeliveryStatus(id, 'Annulée').subscribe({
      next: () => { this.platform.notify('Livraison annulée', 'alert'); this.reload(); },
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
    this.distributor.notifyAvailable(r.id).subscribe({
      next: res => { this.platform.notify(res.message, 'ok'); this.reload(); },
      error: e => this.platform.notify(this.apiError(e, 'Échec de la notification'), 'alert'),
    });
  }

  submitEditLivraison(qtyInput: string, date: string): void {
    const s = this.editLivraisonModal();
    if (!s) return;
    const qty = parseInt(qtyInput, 10);
    this.distributor.updateDelivery(s.id, qty, date).subscribe({
      next: () => {
        this.platform.notify('Livraison modifiée avec succès', 'ok');
        this.editLivraisonModal.set(null);
        this.reload();
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
    call.subscribe({
      next: () => { this.platform.notify('Commande traitée — livraison planifiée', 'ok'); this.fulfillModal.set(null); this.reload(); },
      error: e => this.platform.notify(this.apiError(e, 'Échec du traitement'), 'alert'),
    });
  }

  rejectInstitutional(o: ApiInstitutionalOrder): void {
    const reason = 'Stock insuffisant';
    const call = this.distType() === 'PNA' ? this.distributor.pnaReject(o.id, reason) : this.distributor.praReject(o.id, reason);
    call.subscribe({
      next: () => { this.platform.notify('Commande rejetée', 'info'); this.reload(); },
      error: e => this.platform.notify(this.apiError(e, 'Échec du rejet'), 'alert'),
    });
  }

  submitPnaOrder(medId: string, qty: string, urgency: string, notes: string): void {
    const mid = parseInt(medId, 10);
    const quantity = parseInt(qty, 10);
    if (isNaN(mid) || isNaN(quantity) || quantity <= 0) { this.platform.notify('Médicament et quantité requis', 'alert'); return; }
    this.distributor.createPnaOrder({ medicine_id: mid, quantity, urgency, notes: notes.trim() || undefined }).subscribe({
      next: () => { this.platform.notify('Commande envoyée à la PNA', 'ok'); this.pnaOrderModal.set(false); this.reload(); },
      error: e => this.platform.notify(this.apiError(e, 'Échec de la commande'), 'alert'),
    });
  }

  instUrgencyTag(u: string): string { return u === 'critical' ? 'crit' : u === 'urgent' ? 'low' : 'new'; }
  instStatusLabel(o: ApiInstitutionalOrder): string {
    return o.status === 'resolved' ? 'Livraison planifiée' + (o.delivery_date ? ' · ' + o.delivery_date : '')
      : o.status === 'rejected' ? 'Rejetée' : o.status === 'received' ? 'Reçue' : 'En attente';
  }

  // ─────────────────────────────────────────────────────────────
  // DIVERS
  // ─────────────────────────────────────────────────────────────

  tcol(t: string): string { return t === 'haute' ? 'crit' : t === 'moyenne' ? 'low' : 'ok'; }
  ztag(n: string): string { return n === 'crit' ? 'crit' : n === 'haute' ? 'low' : 'ok'; }
  tone(pct: number): BarTone { return pct > 70 ? 'red' : pct > 40 ? 'amber' : 'green'; }
  sevTag(sev: string): string { return sev === 'high' ? 'crit' : 'low'; }
  sevLabel(sev: string): string { return sev === 'high' ? 'Critique' : 'Élevé'; }

  /** Délai réel de réappro. (delivery_plans livrés) ou absence d'historique. */
  delayLabel(t: ApiForecast): string {
    return t.avg_delay_days === null ? 'délai réappro. inconnu' : `délai réappro. ${t.avg_delay_days} j`;
  }
  delayTitle(t: ApiForecast): string {
    return t.avg_delay_days === null
      ? 'Aucune livraison de ce médicament confirmée à ce jour'
      : `Moyenne création → livraison confirmée sur ${t.delay_sample} livraison(s)`;
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
