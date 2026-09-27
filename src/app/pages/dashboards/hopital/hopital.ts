import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { map, switchMap, throwError } from 'rxjs';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Tag } from '../../../components/tag/tag';
import { PartnersPanel, PartnerTypeOption } from '../../../components/partners-panel/partners-panel';
import { IncomingDeliveries } from '../../../components/incoming-deliveries/incoming-deliveries';
import { PlatformState } from '../../../services/platform/platform';
import { HospitalService } from '../../../services/hospital/hospital';
import { MedicineService } from '../../../services/medicines/medicines';
import { StructureService } from '../../../services/structures/structures';
import { AuthService } from '../../../services/auth/auth';
import { AlerteHop, CritMedRow } from '../../../interfaces/models';
import {
  ApiDispensation, ApiDispensationByService, ApiErrorBody, ApiHospitalDashboard, ApiHospitalStockRow, ApiInstitutionalOrder,
  ApiRestockRequest, ApiSupplier, HospitalSeverity,
} from '../../../interfaces/api';

const EMPTY_SET: ReadonlySet<number> = new Set<number>();

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
  imports: [Icon, Card, PageHead, Stat, Tag, PartnersPanel, IncomingDeliveries, DatePipe],
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
  readonly filteredStock = computed(() => {
    const f = this.stockFilter();
    return this.hStock().filter(s => f === 'all' || (f === 'controlled' ? s.is_controlled : s.severity === f));
  });
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
  readonly partnerCount = computed(() => Number(this.dashboardData()['partners'] ?? 0));
  readonly incomingCount = computed(() => Number(this.dashboardData()['incoming_deliveries'] ?? 0));

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
  praStatusLabel(s: string): string {
    return s === 'resolved' ? 'Traitée' : s === 'rejected' ? 'Rejetée' : s === 'received' ? 'Reçue' : 'En attente';
  }

  /** Deux niveaux d'urgence : rupture (rouge) / tension (orange). */
  sevTag(s: HospitalSeverity | null | undefined): string { return s === 'rupture' ? 'crit' : s === 'tension' ? 'low' : 'ok'; }
  sevLabel(s: HospitalSeverity | null | undefined): string { return s === 'rupture' ? 'Rupture' : s === 'tension' ? 'Tension' : 'Suivi normal'; }
  critTag(s: string): string { return s === 'out' ? 'crit' : s === 'low' ? 'low' : 'ok'; }
  critLabel(s: string): string { return s === 'out' ? 'Rupture' : s === 'low' ? 'Tension' : 'Suivi normal'; }
  expiryTag(level: string | undefined): string { return level === 'ok' ? 'ok' : level === 'warn' ? 'low' : level === 'crit' || level === 'expired' ? 'crit' : 'vue'; }
  when(iso: string | null): string { return iso ? new Date(iso).toLocaleString('fr-FR') : ''; }

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
    return r.status === 'resolved' ? 'Livraison planifiée' + (r.delivery_date ? ' · ' + r.delivery_date : '')
      : r.status === 'rejected' ? 'Refusée'
      : 'En attente';
  }
  requestTag(status: string): string { return status === 'resolved' ? 'ok' : status === 'rejected' ? 'crit' : 'low'; }

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
        this.platform.notify(`${sev === 'rupture' ? 'Rupture' : 'Tension'} signalée pour ${medicine.nom} — ${notified} partenaire(s) notifié(s)`, 'ok');
        this.signalModal.set(false);
        this.reload();
      },
      error: (e: unknown) => this.platform.notify(
        e instanceof Error && e.message === 'not_found' ? 'Médicament introuvable dans le catalogue' : 'Échec du signalement', 'alert'),
    });
  }

  // --- Sorties vers service / unité (circuit fermé) ---
  submitDispense(qtyInput: string, service: string, unit: string, patientRef: string): void {
    const s = this.dispenseModal();
    if (!s) return;
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
