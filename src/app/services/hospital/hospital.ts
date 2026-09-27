import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ApiCriticalMedicine, ApiDispensation, ApiDispensationByService, ApiHospitalAlert, ApiHospitalDashboard, ApiHospitalStockRow,
  ApiInstitutionalOrder, ApiRestockRequest, HospitalSeverity,
} from '../../interfaces/api';
import { SendResult } from '../pharmacy/pharmacy';
import { AlerteHop, CritMedRow, StockState } from '../../interfaces/models';
import { formatWhen } from '../orders/orders';
import { asZoneLevel } from '../distributor/distributor';

/** Espace hôpital : alertes internes (tension / rupture), stock & sorties par service, médicaments critiques. */
@Injectable({ providedIn: 'root' })
export class HospitalService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /hospital/alerts */
  alerts(): Observable<AlerteHop[]> {
    return this.http.get<{ data: ApiHospitalAlert[] }>(`${this.base}/hospital/alerts`).pipe(
      map(r => r.data.map(toAlerteHop)),
      catchError(() => of([])),
    );
  }

  /** POST /hospital/alerts/{alert}/resolve */
  resolveAlert(id: number): Observable<unknown> {
    return this.http.post(`${this.base}/hospital/alerts/${id}/resolve`, {});
  }

  /**
   * POST /hospital/alerts — signalement à 2 niveaux : « rupture » (stock à zéro)
   * ou « tension » (critique non nul). Tous les partenaires connectés sont notifiés.
   */
  createAlert(payload: { medicine_id: number; service: string; unit?: string; severity: HospitalSeverity; remaining_quantity: number }): Observable<{ notified_partners: number }> {
    return this.http.post<{ notified_partners: number }>(`${this.base}/hospital/alerts`, payload);
  }

  /** GET /hospital/stock — stock de la pharmacie interne. */
  stock(): Observable<ApiHospitalStockRow[]> {
    return this.http.get<{ data: ApiHospitalStockRow[] }>(`${this.base}/hospital/stock`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /hospital/stock/{stock}/dispense — sortie vers un service / une unité (circuit fermé). */
  dispense(stockId: number, payload: { quantity: number; service: string; unit?: string; patient_ref?: string }): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/hospital/stock/${stockId}/dispense`, payload);
  }

  /** GET /hospital/dispensations — journal des sorties + agrégat par service. */
  dispensations(days = 30): Observable<{ data: ApiDispensation[]; by_service: ApiDispensationByService[] }> {
    return this.http.get<{ data: ApiDispensation[]; by_service: ApiDispensationByService[] }>(`${this.base}/hospital/dispensations`, { params: { days } }).pipe(
      catchError(() => of({ data: [], by_service: [] })),
    );
  }

  /**
   * POST /hospital/alerts/{alert}/restock — demande de réapprovisionnement
   * ciblée : une alerte par fournisseur choisi (privés / PRA).
   */
  requestRestock(alertId: number, distributorIds: number[], quantity?: number, message?: string): Observable<SendResult> {
    return this.http.post<SendResult>(`${this.base}/hospital/alerts/${alertId}/restock`, {
      distributor_ids: distributorIds, quantity, message,
    });
  }

  /** GET /hospital/restock-requests — suivi des demandes envoyées aux fournisseurs. */
  restockRequests(): Observable<ApiRestockRequest[]> {
    return this.http.get<{ data: ApiRestockRequest[] }>(`${this.base}/hospital/restock-requests`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** GET /hospital/critical-medicines */
  criticalMedicines(): Observable<CritMedRow[]> {
    return this.http.get<{ data: ApiCriticalMedicine[] }>(`${this.base}/hospital/critical-medicines`).pipe(
      map(r => r.data.map(toCritMed)),
      catchError(() => of([])),
    );
  }

  /** GET /hospital/alerts/history — historique des alertes (actives + résolues). */
  alertHistory(): Observable<AlerteHop[]> {
    return this.http.get<{ data: ApiHospitalAlert[] }>(`${this.base}/hospital/alerts/history`).pipe(
      map(r => r.data.map(toAlerteHop)),
      catchError(() => of([])),
    );
  }

  /** GET /hospital/dashboard — indicateurs du tableau de bord. */
  dashboard(): Observable<ApiHospitalDashboard> {
    return this.http.get<{ data: ApiHospitalDashboard }>(`${this.base}/hospital/dashboard`).pipe(
      map(r => r.data ?? {}),
      catchError(() => of({})),
    );
  }

  /** GET /hospital/pra-orders — commandes institutionnelles passées à la PRA. */
  praOrders(): Observable<ApiInstitutionalOrder[]> {
    return this.http.get<{ data: ApiInstitutionalOrder[] }>(`${this.base}/hospital/pra-orders`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /hospital/pra-orders — passer une commande à la PRA régionale. */
  createPraOrder(payload: { medicine_id: number; quantity: number; urgency: string; service?: string; notes?: string }): Observable<unknown> {
    return this.http.post(`${this.base}/hospital/pra-orders`, payload);
  }
}

function toAlerteHop(a: ApiHospitalAlert): AlerteHop {
  const severity: HospitalSeverity = a.severity ?? (a.remaining_quantity === 0 ? 'rupture' : 'tension');
  return {
    id: String(a.id),
    medId: a.medicine_id ?? null,
    med: a.medicine ?? '—',
    service: a.service ?? '—',
    unit: a.unit ?? null,
    niveau: severity === 'rupture' ? 'crit' : asZoneLevel(a.level),
    severity,
    controlled: a.is_controlled ?? false,
    reste: a.remaining ?? '—',
    quand: formatWhen(a.created_at),
    requestedTo: a.restock_requested_to ?? [],
  };
}

function toCritMed(m: ApiCriticalMedicine): CritMedRow {
  const s: StockState = m.status === 'out_of_stock' ? 'out' : m.status === 'low' ? 'low' : 'ok';
  return { medId: m.medicine_id, name: m.medicine ?? '—', available: m.available, s };
}
