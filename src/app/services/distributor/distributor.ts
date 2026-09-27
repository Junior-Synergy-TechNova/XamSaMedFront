import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ApiDelivery, ApiDestination, ApiForecast, ApiIncomingRequest, ApiInstitutionalOrder, ApiPnaDashboard, ApiRegionalDemand, ApiShortageReport,
  ApiZone, DistributorAlertsResponse, ShortageAlert,
} from '../../interfaces/api';
import { DemandeReg, ZoneInfo, ZoneLevel, DeliveryRow, DeliveryStatus } from '../../interfaces/models';

/** Coordonnées (% sur la carte) des principales villes du Sénégal. */
const CITY_GEO: Record<string, { x: number; y: number }> = {
  'Dakar': { x: 28, y: 36 }, 'Pikine': { x: 33, y: 33 }, 'Rufisque': { x: 37, y: 41 },
  'Thiès': { x: 47, y: 47 }, 'Saint-Louis': { x: 40, y: 16 }, 'Louga': { x: 49, y: 28 },
  'Kaolack': { x: 55, y: 62 }, 'Ziguinchor': { x: 30, y: 86 }, 'Tambacounda': { x: 78, y: 56 },
};

export function asZoneLevel(level: string): ZoneLevel {
  return level === 'crit' || level === 'haute' || level === 'moyenne' || level === 'basse' ? level : 'moyenne';
}

/** Construit un ZoneInfo (avec coords carte) à partir d'un nom de ville. */
export function toZoneInfo(name: string, level: string, ruptures: number): ZoneInfo {
  const g = CITY_GEO[name] ?? { x: 50, y: 50 };
  return { nom: name, x: g.x, y: g.y, niveau: asZoneLevel(level), ruptures };
}

/** Indicateurs du tableau de bord distributeur (GET /distributor/dashboard). */
export interface DistributorDashboard {
  planned: number;
  in_transit: number;
  delivered: number;
  critical_zones: number;
  pending_alerts: number;
  pending_requests: number;
  /** Tensions portant sur des médicaments contrôlés (priorisés). */
  controlled_alerts: number;
  /** Ruptures confirmées par des alertes groupées patients, non traitées. */
  shortage_reports: number;
  partners: number;
  structure: { id: number; name: string; type: string; sector?: string; city: string | null; region: string | null } | null;
  /** Périmètre de livraison (règles §3.3), lisible. */
  scope: string;
}

/**
 * Endpoints distributeur / PNA / PRA — données réelles.
 * Le périmètre (national pour la PNA, régional pour une PRA) est appliqué par
 * le backend d'après structures.type / region : rien n'est filtré ici.
 */
@Injectable({ providedIn: 'root' })
export class DistributorService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  dashboard(): Observable<Partial<DistributorDashboard>> {
    return this.http.get<{ data: DistributorDashboard }>(`${this.base}/distributor/dashboard`).pipe(
      map(r => r.data ?? {}),
      catchError(() => of({})),
    );
  }

  /** GET /distributor/alerts — ruptures signalées par les officines. */
  alerts(): Observable<ShortageAlert[]> {
    return this.http.get<DistributorAlertsResponse>(`${this.base}/distributor/alerts`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** GET /distributor/regional-demands — agrégation par zone + médicament (avec les officines concernées). */
  regionalDemands(): Observable<DemandeReg[]> {
    return this.http.get<{ data: ApiRegionalDemand[] }>(`${this.base}/distributor/regional-demands`).pipe(
      map(r => (r.data ?? []).map(toDemandeReg)),
      catchError(() => of([])),
    );
  }

  /** GET /distributor/zones — villes avec ruptures + niveau de tension. */
  zones(): Observable<ZoneInfo[]> {
    return this.http.get<{ data: ApiZone[] }>(`${this.base}/distributor/zones`).pipe(
      map(r => (r.data ?? []).map(z => toZoneInfo(z.name, z.level, z.ruptures))),
      catchError(() => of([])),
    );
  }

  /** GET /distributor/previsions — prévisions basées sur les données réelles. */
  previsions(): Observable<ApiForecast[]> {
    return this.http.get<{ data: ApiForecast[] }>(`${this.base}/distributor/previsions`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  // --- DEMANDES DE RÉAPPROVISIONNEMENT REÇUES (officines & hôpitaux) ---

  /** GET /distributor/requests — demandes adressées à ce fournisseur. */
  requests(): Observable<ApiIncomingRequest[]> {
    return this.http.get<{ data: ApiIncomingRequest[] }>(`${this.base}/distributor/requests`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /distributor/requests/{alert}/fulfill — traite la demande en planifiant une livraison. */
  fulfillRequest(id: number, deliveryDate: string, quantity?: number, notes?: string): Observable<unknown> {
    return this.http.post(`${this.base}/distributor/requests/${id}/fulfill`, { delivery_date: deliveryDate, quantity, notes });
  }

  /** POST /distributor/requests/{alert}/reject */
  rejectRequest(id: number, reason: string): Observable<unknown> {
    return this.http.post(`${this.base}/distributor/requests/${id}/reject`, { reason });
  }

  // --- RUPTURES CONFIRMÉES PAR ALERTE GROUPÉE ---

  /** GET /distributor/shortage-reports */
  shortageReports(): Observable<ApiShortageReport[]> {
    return this.http.get<{ data: ApiShortageReport[] }>(`${this.base}/distributor/shortage-reports`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /distributor/shortage-reports/{id}/notify-available — informe le périmètre + les patients. */
  notifyAvailable(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/distributor/shortage-reports/${id}/notify-available`, {});
  }

  // --- LIVRAISONS ---

  /** GET /distributor/destinations?medicine_id= — structures livrables (selon le type du fournisseur) + état de stock. */
  destinations(medicineId?: number | null): Observable<ApiDestination[]> {
    let params = new HttpParams();
    if (medicineId) params = params.set('medicine_id', String(medicineId));
    return this.http.get<{ data: ApiDestination[] }>(`${this.base}/distributor/destinations`, { params }).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** GET /distributor/deliveries?city=&medicine= (filtres serveur ; le statut est filtré côté vue). */
  deliveries(filters: { city?: string; medicine?: string } = {}): Observable<DeliveryRow[]> {
    let params = new HttpParams().set('per_page', '200');
    if (filters.city) params = params.set('city', filters.city);
    if (filters.medicine) params = params.set('medicine', filters.medicine);
    return this.http.get<{ data: ApiDelivery[] }>(`${this.base}/distributor/deliveries`, { params }).pipe(
      map(r => (r.data ?? []).map(toDeliveryRow)),
      catchError(() => of([])),
    );
  }

  /** POST /distributor/deliveries — destination explicite (structure), médicament du catalogue. */
  createDelivery(structureId: number, medicineId: number, qty: number, date: string, notes?: string, requestId?: number): Observable<unknown> {
    return this.http.post(`${this.base}/distributor/deliveries`, {
      structure_id: structureId, medicine_id: medicineId, quantity: qty, delivery_date: date, notes, request_id: requestId,
    });
  }

  /** PUT /distributor/deliveries/{id} */
  updateDelivery(id: string, qty: number, date: string): Observable<unknown> {
    return this.http.put(`${this.base}/distributor/deliveries/${id}`, { quantity: qty, delivery_date: date });
  }

  /** POST /distributor/deliveries/{id}/start */
  startDelivery(id: string): Observable<unknown> {
    return this.http.post(`${this.base}/distributor/deliveries/${id}/start`, {});
  }

  changeDeliveryStatus(id: string, status: DeliveryStatus): Observable<unknown> {
    if (status === 'En transit') return this.startDelivery(id);
    if (status === 'Livrée') return this.http.post(`${this.base}/distributor/deliveries/${id}/complete`, {});
    return this.http.delete(`${this.base}/distributor/deliveries/${id}`);
  }

  // --- FLUX INSTITUTIONNEL (secteur public) ---

  /** GET /pra/orders — commandes des hôpitaux reçues par cette PRA. */
  praOrders(): Observable<ApiInstitutionalOrder[]> {
    return this.http.get<{ data: ApiInstitutionalOrder[] }>(`${this.base}/pra/orders`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /pra/orders/{alert}/fulfill — traiter une commande hôpital (planifie une livraison). */
  praFulfill(alertId: number, deliveryDate: string, notes?: string): Observable<unknown> {
    return this.http.post(`${this.base}/pra/orders/${alertId}/fulfill`, { delivery_date: deliveryDate, notes });
  }

  /** POST /pra/orders/{alert}/reject */
  praReject(alertId: number, reason: string): Observable<unknown> {
    return this.http.post(`${this.base}/pra/orders/${alertId}/reject`, { reason });
  }

  /** GET /pra/pna-orders — commandes de cette PRA vers la PNA. */
  praPnaOrders(): Observable<ApiInstitutionalOrder[]> {
    return this.http.get<{ data: ApiInstitutionalOrder[] }>(`${this.base}/pra/pna-orders`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /pra/pna-orders — la PRA commande à la PNA. */
  createPnaOrder(payload: { medicine_id: number; quantity: number; urgency: string; notes?: string }): Observable<unknown> {
    return this.http.post(`${this.base}/pra/pna-orders`, payload);
  }

  /** GET /pna/dashboard — supervision nationale. */
  pnaDashboard(): Observable<ApiPnaDashboard> {
    return this.http.get<{ data: ApiPnaDashboard }>(`${this.base}/pna/dashboard`).pipe(
      map(r => r.data ?? {}),
      catchError(() => of({})),
    );
  }

  /** GET /pna/orders — vue nationale de toutes les commandes institutionnelles. */
  pnaOrders(): Observable<ApiInstitutionalOrder[]> {
    return this.http.get<{ data: ApiInstitutionalOrder[] }>(`${this.base}/pna/orders`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** GET /pna/requests — commandes des PRA adressées à la PNA. */
  pnaRequests(): Observable<ApiInstitutionalOrder[]> {
    return this.http.get<{ data: ApiInstitutionalOrder[] }>(`${this.base}/pna/requests`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /pna/requests/{alert}/fulfill — la PNA planifie la livraison vers la PRA. */
  pnaFulfill(alertId: number, deliveryDate: string, notes?: string): Observable<unknown> {
    return this.http.post(`${this.base}/pna/requests/${alertId}/fulfill`, { delivery_date: deliveryDate, notes });
  }

  /** POST /pna/requests/{alert}/reject */
  pnaReject(alertId: number, reason: string): Observable<unknown> {
    return this.http.post(`${this.base}/pna/requests/${alertId}/reject`, { reason });
  }
}

function toDemandeReg(d: ApiRegionalDemand): DemandeReg {
  return {
    id: `${d.zone}-${d.medicine_id}`,
    zone: d.zone,
    medId: d.medicine_id,
    med: d.medicine,
    controlled: d.is_controlled ?? false,
    need: Math.max(0, d.estimated_need),
    tension: asZoneLevel(d.tension),
    officines: d.officines_count,
    pharmacies: (d.pharmacies ?? []).map(p => ({
      id: p.id, nom: p.name, adresse: p.address ?? '', tel: p.phone ?? '', available: p.available, status: p.status,
    })),
  };
}

function toDeliveryRow(d: ApiDelivery & { status_label?: string }): DeliveryRow {
  return {
    id: String(d.id),
    zone: d.city ?? '—',
    destination: d.destination ?? '—',
    med: d.medicine ?? '—',
    controlled: d.is_controlled ?? false,
    qty: Number(d.quantity ?? 0),
    date: d.delivery_date ? String(d.delivery_date).slice(0, 10) : '',
    status: (d.status_label ?? d.status ?? 'Planifiée') as DeliveryStatus,
    slip: d.slip_number ?? null,
  };
}
