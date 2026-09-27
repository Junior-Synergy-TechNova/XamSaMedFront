import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { map, switchMap, throwError } from 'rxjs';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Bar } from '../../../components/bar/bar';
import { Tag } from '../../../components/tag/tag';
import { PartnersPanel, PartnerTypeOption } from '../../../components/partners-panel/partners-panel';
import { IncomingDeliveries } from '../../../components/incoming-deliveries/incoming-deliveries';
import { PlatformState, saveBlob } from '../../../services/platform/platform';
import { PharmacyService } from '../../../services/pharmacy/pharmacy';
import { MedicineService } from '../../../services/medicines/medicines';
import { AuthService } from '../../../services/auth/auth';
import { StructureService } from '../../../services/structures/structures';
import { DemandeRow, ExpiryLevel, StockRow } from '../../../interfaces/models';
import {
  ApiErrorBody, ApiGroupedAlert, ApiPrescription, ApiRestockRequest, ApiSale, ApiSalesStats, ApiStockMovement, ApiSupplier,
} from '../../../interfaces/api';
import { PharmaDemandes } from '../pharma-demandes/pharma-demandes';
import { SimpleProfile } from '../profile/profile';

type BarTone = 'green' | 'amber' | 'red' | 'blue';
type StatusFilter = 'all' | 'ok' | 'low' | 'out';
type ExpiryFilter = 'all' | 'soon' | 'expired';

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
  imports: [Icon, Card, PageHead, Stat, Bar, Tag, PharmaDemandes, SimpleProfile, PartnersPanel, IncomingDeliveries, DatePipe],
  templateUrl: './pharma.html',
  styleUrl: './pharma.css',
})
export class PharmaDash {
  private readonly platform = inject(PlatformState);
  private readonly pharmacy = inject(PharmacyService);
  private readonly medicines = inject(MedicineService);
  private readonly structures = inject(StructureService);
  protected readonly auth = inject(AuthService);

  readonly section = model.required<string>();
  readonly loading = signal(true);
  readonly stock = signal<StockRow[]>([]);
  readonly demandes = signal<DemandeRow[]>([]);

  readonly addRefModal = signal(false);
  readonly restockModal = signal<StockRow | null>(null);
  readonly sellModal = signal<StockRow | null>(null);
  readonly adjustModal = signal<StockRow | null>(null);
  readonly expireModal = signal<StockRow | null>(null);

  // --- Filtres du stock : statut, médicament contrôlé, péremption proche ---
  readonly statusFilter = signal<StatusFilter>('all');
  readonly controlledOnly = signal(false);
  readonly expiryFilter = signal<ExpiryFilter>('all');
  readonly filteredStock = computed(() => {
    const status = this.statusFilter();
    const expiry = this.expiryFilter();
    return this.stock().filter(s =>
      (status === 'all' || (status === 'out' ? s.s === 'out' || s.s === 'crit' : s.s === status))
      && (!this.controlledOnly() || s.controlled)
      && (expiry === 'all'
        || (expiry === 'expired' ? s.expiryLevel === 'expired' : ['warn', 'crit', 'expired'].includes(s.expiryLevel))));
  });

  // Demande de réapprovisionnement ciblée : fournisseurs (lus en base avec
  // leur stock du médicament) + sélection multiple.
  readonly supplierModal = signal<StockRow | null>(null);
  readonly suppliers = signal<ApiSupplier[]>([]);
  readonly suppliersLoading = signal(false);
  readonly selectedSuppliers = signal<Set<number>>(new Set());
  readonly sending = signal(false);
  // Suivi des demandes envoyées (en attente / livraison planifiée / rejetée).
  readonly restockRequests = signal<ApiRestockRequest[]>([]);
  readonly pendingRequests = computed(() => this.restockRequests().filter(r => r.status === 'pending'));
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

  // Ordonnances numériques reçues
  readonly prescriptions = signal<ApiPrescription[]>([]);
  readonly processModal = signal<ApiPrescription | null>(null);
  readonly pendingPrescriptions = computed(() => this.prescriptions().filter(p => p.status === 'pending').length);

  // Alertes groupées reçues (recherches patient)
  readonly groupedAlerts = signal<ApiGroupedAlert[]>([]);

  // Historique complet des mouvements (traçabilité : qui / quoi / quand / pourquoi)
  readonly history = signal<ApiStockMovement[]>([]);

  readonly crit = computed(() => this.stock().filter(s => s.s === 'crit' || s.s === 'out'));
  readonly alerts = computed(() => this.stock().filter(s => s.s !== 'ok'));
  readonly lowCount = computed(() => this.stock().filter(s => s.s === 'low').length);
  readonly newDem = computed(() => this.demandes().filter(d => d.status === 'pending').length);
  readonly topStock = computed(() => this.stock().slice(0, 5));
  /** Lots orange / rouge (péremption < 3 mois ou dépassée). */
  readonly expiring = computed(() => this.stock()
    .filter(s => ['warn', 'crit', 'expired'].includes(s.expiryLevel))
    .sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0)));
  readonly expiredCount = computed(() => this.stock().filter(s => s.expiryLevel === 'expired').length);

  readonly structureName = computed(() => this.auth.structure()?.name ?? 'Mon officine');
  readonly headerSub = computed(() => {
    const s = this.auth.structure();
    return s ? `${s.name} — ${s.city ?? ''} · offre ${this.planLabel(s.plan)}` : 'Officine';
  });

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
      ['Téléphone', u.phone || '+221 33 000 00 00'],
      ['Email', u.email || 'Non renseigné'],
      ['Région', str(meta['region']) ?? u.structure?.region ?? u.structure?.city ?? 'Non renseignée'],
      ['Offre', this.planLabel(u.structure?.plan)],
    ];
  });

  constructor() { this.reload(); }

  reload(): void {
    this.loading.set(true);
    this.pharmacy.stock().subscribe({
      next: s => { this.loading.set(false); this.stock.set(s); },
      error: () => { this.loading.set(false); this.stock.set([]); },
    });
    this.pharmacy.movements().subscribe({ next: m => this.history.set(m), error: () => { /* ignore */ } });
    this.pharmacy.demandes().subscribe({ next: d => this.demandes.set(d), error: () => { /* ignore */ } });
    this.pharmacy.restockRequests().subscribe({ next: r => this.restockRequests.set(r), error: () => { /* ignore */ } });
    this.pharmacy.prescriptions().subscribe({ next: p => this.prescriptions.set(p), error: () => { /* ignore */ } });
    this.pharmacy.groupedAlerts().subscribe({ next: g => this.groupedAlerts.set(g), error: () => { /* ignore */ } });
    if (this.isPro()) this.reloadSales();
  }

  private apiError(e: HttpErrorResponse, fallback: string): string {
    return (e.error as ApiErrorBody | null)?.message ?? fallback;
  }

  planLabel(plan: string | null | undefined): string {
    return plan === 'pro' ? 'Pro' : plan === 'institutionnel' ? 'Institutionnel' : 'Starter';
  }

  pct(s: StockRow): number {
    if (s.seuil > 0) return Math.min(100, Math.round((s.q / (s.seuil * 3)) * 100));
    return s.q > 0 ? 100 : 0;
  }
  barTone(s: StockRow): BarTone { return s.s === 'ok' ? 'green' : s.s === 'low' ? 'amber' : 'red'; }
  urg(u: string): string { return u === 'Critique' ? 'crit' : u === 'Élevé' ? 'low' : 'new'; }
  homeBadge(s: StockRow): string {
    return s.s === 'ok' ? s.q + ' u.' : s.s === 'low' ? 'Stock faible · ' + s.q : s.s === 'out' ? 'Rupture' : 'Critique · ' + s.q;
  }
  stateLabel(s: string): string {
    return s === 'ok' ? 'En stock' : s === 'low' ? 'Stock faible' : s === 'out' ? 'Rupture' : 'Critique';
  }
  alertLabel(s: string): string { return s === 'low' ? 'Stock faible' : s === 'out' ? 'Rupture' : 'Critique'; }

  /** Code couleur péremption : vert > 3 mois, orange < 3 mois, rouge < 1 mois ou expiré. */
  expiryTag(level: ExpiryLevel): string { return level === 'ok' ? 'ok' : level === 'warn' ? 'low' : level === 'none' ? 'vue' : 'crit'; }
  expiryLabel(s: StockRow): string {
    if (s.expiryLevel === 'none' || !s.expiry) return 'Non renseignée';
    const date = new Date(s.expiry).toLocaleDateString('fr-FR');
    if (s.expiryLevel === 'expired') return `Périmé (${date})`;
    return s.daysToExpiry !== null && s.daysToExpiry < 90 ? `${date} · J-${s.daysToExpiry}` : date;
  }

  movementTag(m: ApiStockMovement): string {
    return m.type === 'tension_detected' || m.type === 'expired' ? 'crit'
      : m.direction === 'entrée' ? 'ok' : m.direction === 'sortie' ? 'low' : 'new';
  }
  signedQty(m: ApiStockMovement): string {
    return m.direction === 'entrée' ? '+' + m.quantity : m.direction === 'sortie' ? '−' + m.quantity : '—';
  }
  when(iso: string | null): string { return iso ? new Date(iso).toLocaleString('fr-FR') : ''; }

  restock(s: StockRow): void { this.restockModal.set(s); }

  submitRestock(qtyInput: string): void {
    const s = this.restockModal();
    if (!s) return;
    const qty = parseInt(qtyInput, 10);
    if (isNaN(qty) || qty <= 0) return;
    this.pharmacy.restock(s.stockId, qty).subscribe({
      next: () => {
        this.platform.notify(`${s.name} réapprovisionné de ${qty} unités`, 'ok');
        this.restockModal.set(null);
        this.reload();
      },
      error: () => this.platform.notify('Échec du réapprovisionnement', 'alert'),
    });
  }

  submitAddRef(name: string, qty: string, seuil: string, batch: string, expiry: string): void {
    const quantity = parseInt(qty, 10);
    const threshold = parseInt(seuil, 10);
    if (!name.trim() || isNaN(quantity) || quantity < 0 || isNaN(threshold) || threshold < 0) {
      this.platform.notify('Informations de référence invalides', 'alert');
      return;
    }
    this.medicines.search(name.trim()).pipe(
      switchMap(matches => {
        const medicine = matches[0];
        if (!medicine) return throwError(() => new Error('not_found'));
        return this.pharmacy.addStock(Number(medicine.id), quantity, threshold, batch.trim(), expiry).pipe(map(() => medicine));
      }),
    ).subscribe({
      next: medicine => { this.platform.notify(`${medicine.nom} a été ajouté au stock`, 'ok'); this.addRefModal.set(false); this.reload(); },
      error: (e: unknown) => this.platform.notify(
        e instanceof Error && e.message === 'not_found' ? 'Médicament introuvable dans le catalogue'
          : e instanceof HttpErrorResponse ? this.apiError(e, 'Cette référence existe peut-être déjà dans le stock') : 'Échec de l\'ajout', 'alert'),
    });
  }

  // --- Vente hors plateforme (sans facture) ---
  sell(s: StockRow): void { this.sellModal.set(s); }
  submitSell(qtyInput: string): void {
    const s = this.sellModal();
    if (!s) return;
    const qty = parseInt(qtyInput, 10);
    if (isNaN(qty) || qty <= 0 || qty > s.q) {
      this.platform.notify('Quantité invalide', 'alert');
      return;
    }
    this.pharmacy.externalSale(s.stockId, qty, 'Vente hors plateforme').subscribe({
      next: () => {
        this.platform.notify(`Vente de ${qty} unité(s) enregistrée`, 'ok');
        this.sellModal.set(null);
        this.reload();
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
    this.pharmacy.inventoryAdjustment(s.stockId, real + s.reserved, motif).subscribe({
      next: () => {
        const diff = real - s.q;
        this.platform.notify(diff === 0 ? 'Stock conforme — aucun écart' : `Écart d'inventaire enregistré (${diff > 0 ? '+' : ''}${diff})`, 'info');
        this.adjustModal.set(null);
        this.reload();
      },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec de l\'ajustement'), 'alert'),
    });
  }

  // --- Retrait d'un lot périmé ---
  submitExpire(qtyInput: string, reason: string): void {
    const s = this.expireModal();
    if (!s) return;
    const qty = qtyInput ? parseInt(qtyInput, 10) : undefined;
    if (qty !== undefined && (isNaN(qty) || qty <= 0)) { this.platform.notify('Quantité invalide', 'alert'); return; }
    this.pharmacy.expire(s.stockId, qty, reason.trim() || undefined).subscribe({
      next: r => { this.platform.notify(r.message, 'ok'); this.expireModal.set(null); this.reload(); },
      error: (e: HttpErrorResponse) => this.platform.notify(this.apiError(e, 'Échec du retrait'), 'alert'),
    });
  }

  // --- Demande de réapprovisionnement aux fournisseurs ---

  /** Ouvre le choix des fournisseurs : ceux qui disposent du médicament sont proposés en premier. */
  alertDistrib(s: StockRow): void {
    this.supplierModal.set(s);
    this.suppliers.set([]);
    this.selectedSuppliers.set(new Set());
    this.suppliersLoading.set(true);
    this.structures.suppliers(s.medId).subscribe({
      next: list => {
        this.suppliers.set(list);
        this.suppliersLoading.set(false);
        // Pré-sélection : les fournisseurs qui ont le médicament et ne sont pas déjà sollicités.
        const asked = this.alreadyAsked(s);
        this.selectedSuppliers.set(new Set(list.filter(d => d.has_stock && !asked.has(d.id)).map(d => d.id)));
      },
      error: () => this.suppliersLoading.set(false),
    });
  }

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
        this.pharmacy.restockRequests().subscribe({ next: r => this.restockRequests.set(r), error: () => { /* ignore */ } });
      },
      error: (e: HttpErrorResponse) => { this.sending.set(false); this.platform.notify(this.apiError(e, 'Échec de l\'envoi de la demande'), 'alert'); },
    });
  }

  requestStatusLabel(r: ApiRestockRequest): string {
    return r.status === 'resolved' ? 'Livraison planifiée' + (r.delivery_date ? ' · ' + r.delivery_date : '')
      : r.status === 'rejected' ? 'Refusée'
      : 'En attente';
  }
  requestTag(status: string): string { return status === 'resolved' ? 'ok' : status === 'rejected' ? 'crit' : 'low'; }

  // --- Ordonnances numériques ---
  openProcess(p: ApiPrescription): void { this.processModal.set(p); }

  downloadOrdo(p: ApiPrescription): void {
    this.pharmacy.downloadPrescription(p.id).subscribe({
      next: blob => saveBlob(blob, `ordonnance-${p.id}`),
      error: () => this.platform.notify('Impossible de télécharger l\'ordonnance', 'alert'),
    });
  }

  submitProcess(medName: string, qtyInput: string, priceInput: string): void {
    const p = this.processModal();
    if (!p) return;
    const qty = parseInt(qtyInput, 10);
    if (!medName.trim() || isNaN(qty) || qty <= 0) { this.platform.notify('Médicament et quantité requis', 'alert'); return; }
    const price = priceInput ? Number(priceInput) : undefined;
    this.medicines.search(medName.trim()).pipe(
      switchMap(matches => {
        const med = matches[0];
        if (!med) return throwError(() => new Error('not_found'));
        return this.pharmacy.processPrescription(p.id, Number(med.id), qty, price);
      }),
    ).subscribe({
      next: () => { this.platform.notify('Ordonnance traitée — commande prête au retrait', 'ok'); this.processModal.set(null); this.reload(); },
      error: (e: unknown) => this.platform.notify(
        e instanceof Error && e.message === 'not_found' ? 'Médicament introuvable dans le catalogue' : 'Échec du traitement (stock insuffisant ?)', 'alert'),
    });
  }

  ordoLabel(status: string): string {
    return status === 'confirmed' ? 'Prête au retrait' : status === 'collected' ? 'Retirée' : status === 'cancelled' ? 'Refusée' : 'À traiter';
  }

  rejectOrdo(p: ApiPrescription): void {
    this.pharmacy.rejectPrescription(p.id, 'Ordonnance non traitable').subscribe({
      next: () => { this.platform.notify('Ordonnance rejetée', 'info'); this.reload(); },
      error: () => this.platform.notify('Échec du rejet', 'alert'),
    });
  }

  // --- Alertes groupées ---
  respondGrouped(a: ApiGroupedAlert, available: boolean): void {
    const qty = available ? (this.stock().find(s => s.medId === a.medicine_id)?.q ?? undefined) : undefined;
    this.pharmacy.respondGroupedAlert(a.response_id, available, qty).subscribe({
      next: () => { this.platform.notify(available ? 'Disponibilité transmise au patient' : 'Indisponibilité enregistrée', available ? 'ok' : 'info'); this.reload(); },
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
    if (qty + already > s.q) { this.platform.notify(`Stock insuffisant (${s.q} disponible(s))`, 'alert'); return; }
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
        this.reload();
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
