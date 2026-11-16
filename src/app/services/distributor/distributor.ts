import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { SharedRead } from '../shared-read/shared-read';
import { environment } from '../../../environments/environment';
import { GeoPoint, toPoint } from '../structures/structures';
import {
  ApiDelivery, ApiDestination, ApiForecast, ApiIncomingRequest, ApiInstitutionalOrder, ApiPnaDashboard, ApiRegionalDemand, ApiShortageReport,
  ApiZone, DistributorAlertsResponse, ShortageAlert,
} from '../../interfaces/api';
import { DemandeReg, ZoneInfo, ZoneLevel, DeliveryRow, DeliveryStatus } from '../../interfaces/models';

/** Centre des principales villes du Sénégal, si l'API ne fournit pas de coordonnées. */
const CITY_GEO: Record<string, GeoPoint> = {
  'Dakar': { lat: 14.6928, lng: -17.4467 }, 'Pikine': { lat: 14.7547, lng: -17.3906 }, 'Guédiawaye': { lat: 14.7833, lng: -17.4 },
  'Rufisque': { lat: 14.7167, lng: -17.2667 }, 'Thiès': { lat: 14.7910, lng: -16.9359 }, 'Mbour': { lat: 14.4198, lng: -16.9693 },
  'Saint-Louis': { lat: 16.0326, lng: -16.4818 }, 'Louga': { lat: 15.6144, lng: -16.2286 }, 'Diourbel': { lat: 14.6550, lng: -16.2314 },
  'Touba': { lat: 14.8500, lng: -15.8833 }, 'Kaolack': { lat: 14.1652, lng: -16.0758 }, 'Fatick': { lat: 14.3390, lng: -16.4111 },
  'Kaffrine': { lat: 14.1059, lng: -15.5508 }, 'Ziguinchor': { lat: 12.5681, lng: -16.2719 }, 'Kolda': { lat: 12.8939, lng: -14.9411 },
  'Sédhiou': { lat: 12.7081, lng: -15.5569 }, 'Tambacounda': { lat: 13.7707, lng: -13.6673 }, 'Kédougou': { lat: 12.5605, lng: -12.1747 },
  'Matam': { lat: 15.6559, lng: -13.2554 },
};

export function asZoneLevel(level: string): ZoneLevel {
  return level === 'crit' || level === 'haute' || level === 'moyenne' || level === 'basse' ? level : 'moyenne';
}

/** ApiZone → ZoneInfo : coordonnées de l'API, sinon centre connu de la ville, sinon null (hors carte). */
export function toZoneInfo(z: ApiZone): ZoneInfo {
  return {
    nom: z.name,
    point: toPoint(z.latitude, z.longitude) ?? CITY_GEO[z.name] ?? null,
    niveau: asZoneLevel(z.level),
    ruptures: z.ruptures,
    tensions: z.tensions,
  };
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
 * Les lectures qui alimentent la file « À traiter » laissent passer leurs
 * erreurs : une liste vide trompeuse vaut moins qu'un « Réessayer ».
 */
@Injectable({ providedIn: 'root' })
export class DistributorService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  dashboard(): Observable<Partial<DistributorDashboard>> {
    return this.http.get<{ data: DistributorDashboard }>(`${this.base}/distributor/dashboard`).pipe(
      map(r => r.data ?? {}),
    );
  }

  /** GET /distributor/alerts — ruptures signalées par les officines. */
  alerts(): Observable<ShortageAlert[]> {
    return this.http.get<DistributorAlertsResponse>(`${this.base}/distributor/alerts`).pipe(
      map(r => r.data ?? []),
    );
  }

  /** GET /distributor/regional-demands — agrégation par zone + médicament (avec les officines concernées). */
  /** Partagé entre la cloche et le premier affichage (`maxAgeMs`, voir `SharedRead`). */
  regionalDemands(maxAgeMs = 0): Observable<DemandeReg[]> {
    return this.regionalRead.get(maxAgeMs);
  }
  private readonly regionalRead = new SharedRead<DemandeReg[]>(() =>
    this.http.get<{ data: ApiRegionalDemand[] }>(`${this.base}/distributor/regional-demands`).pipe(
      map(r => (r.data ?? []).map(toDemandeReg)),
    ));

  /** GET /distributor/zones — villes avec ruptures + niveau de tension. */
  zones(): Observable<ZoneInfo[]> {
    return this.http.get<{ data: ApiZone[] }>(`${this.base}/distributor/zones`).pipe(
      map(r => (r.data ?? []).map(toZoneInfo))
    );
  }

  /** GET /distributor/previsions — prévisions basées sur les données réelles. */
  previsions(): Observable<ApiForecast[]> {
    return this.http.get<{ data: ApiForecast[] }>(`${this.base}/distributor/previsions`).pipe(
      map(r => r.data ?? []),
    );
  }

  // --- DEMANDES DE RÉAPPROVISIONNEMENT REÇUES (officines & hôpitaux) ---

  /** GET /distributor/requests — demandes adressées à ce fournisseur. */
  requests(): Observable<ApiIncomingRequest[]> {
    return this.http.get<{ data: ApiIncomingRequest[] }>(`${this.base}/distributor/requests`).pipe(
      map(r => r.data ?? [])
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
      map(r => r.data ?? [])
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
    );
  }

  /** GET /distributor/deliveries?city=&medicine= (filtres serveur ; le statut est filtré côté vue). */
  deliveries(filters: { city?: string; medicine?: string } = {}): Observable<DeliveryRow[]> {
    let params = new HttpParams().set('per_page', '200');
    if (filters.city) params = params.set('city', filters.city);
    if (filters.medicine) params = params.set('medicine', filters.medicine);
    return this.http.get<{ data: ApiDelivery[] }>(`${this.base}/distributor/deliveries`, { params }).pipe(
      map(r => (r.data ?? []).map(toDeliveryRow))
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
      map(r => r.data ?? [])
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
    );
  }

  /** GET /pna/orders — vue nationale de toutes les commandes institutionnelles. */
  pnaOrders(): Observable<ApiInstitutionalOrder[]> {
    return this.http.get<{ data: ApiInstitutionalOrder[] }>(`${this.base}/pna/orders`).pipe(
      map(r => r.data ?? []),
    );
  }

  /** GET /pna/requests — commandes des PRA adressées à la PNA. */
  pnaRequests(): Observable<ApiInstitutionalOrder[]> {
    return this.http.get<{ data: ApiInstitutionalOrder[] }>(`${this.base}/pna/requests`).pipe(
      map(r => r.data ?? [])
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
