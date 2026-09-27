import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ApiDemande, ApiGroupedAlert, ApiPrescription, ApiRestockRequest, ApiSale, ApiSalesStats, ApiStockMovement, ApiStockRow, NewSaleLine,
} from '../../interfaces/api';
import { DemandeRow, StockRow, StockState } from '../../interfaces/models';
import { formatWhen } from '../orders/orders';

/** Espace pharmacien : stock, demandes ciblées. */
@Injectable({ providedIn: 'root' })
export class PharmacyService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /pharmacy/stock — toutes les références (filtrage statut / contrôlé / péremption côté vue). */
  stock(): Observable<StockRow[]> {
    const params = new HttpParams().set('per_page', '500');
    return this.http.get<{ data: ApiStockRow[] }>(`${this.base}/pharmacy/stock`, { params }).pipe(
      map(r => r.data.map(toStockRow)),
      catchError(() => of([])),
    );
  }

  /** POST /pharmacy/stock/{stock}/restock */
  restock(stockId: number, quantity: number): Observable<unknown> {
    return this.http.post(`${this.base}/pharmacy/stock/${stockId}/restock`, { quantity_received: quantity });
  }

  /** GET /pharmacy/demandes */
  demandes(): Observable<DemandeRow[]> {
    return this.http.get<{ data: ApiDemande[] }>(`${this.base}/pharmacy/demandes`).pipe(
      map(r => r.data.map(toDemandeRow)),
      catchError(() => of([])),
    );
  }

  /** POST /pharmacy/demandes/{order}/accept */
  acceptDemande(id: number): Observable<unknown> {
    return this.http.post(`${this.base}/pharmacy/demandes/${id}/accept`, {});
  }

  /** POST /pharmacy/demandes/{order}/orient */
  orientDemande(id: number, toStructureId: number): Observable<unknown> {
    return this.http.post(`${this.base}/pharmacy/demandes/${id}/orient`, { target_structure_id: toStructureId });
  }

  /** POST /pharmacy/demandes/{order}/collect — finalise un retrait (confirmed → collected). */
  collectDemande(id: number): Observable<unknown> {
    return this.http.post(`${this.base}/pharmacy/demandes/${id}/collect`, {});
  }

  /** GET /pharmacy/prescriptions — ordonnances numériques reçues. */
  prescriptions(): Observable<ApiPrescription[]> {
    return this.http.get<{ data: ApiPrescription[] }>(`${this.base}/pharmacy/prescriptions`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /pharmacy/prescriptions/{order}/process — convertit l'ordonnance en commande réelle. */
  processPrescription(id: number, medicineId: number, qty: number, price?: number, note?: string): Observable<unknown> {
    return this.http.post(`${this.base}/pharmacy/prescriptions/${id}/process`, { medicine_id: medicineId, qty, price, note });
  }

  /** POST /pharmacy/prescriptions/{order}/reject */
  rejectPrescription(id: number, reason?: string): Observable<unknown> {
    return this.http.post(`${this.base}/pharmacy/prescriptions/${id}/reject`, { reason });
  }

  /** GET /pharmacy/prescriptions/{order}/download — fichier ordonnance (blob). */
  downloadPrescription(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/pharmacy/prescriptions/${id}/download`, { responseType: 'blob' });
  }

  /** GET /pharmacy/grouped-alerts — alertes groupées en attente de réponse. */
  groupedAlerts(): Observable<ApiGroupedAlert[]> {
    return this.http.get<{ data: ApiGroupedAlert[] }>(`${this.base}/pharmacy/grouped-alerts`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /pharmacy/grouped-alerts/{response}/respond — répondre OUI/NON. */
  respondGroupedAlert(responseId: number, available: boolean, quantity?: number): Observable<unknown> {
    return this.http.post(`${this.base}/pharmacy/grouped-alerts/${responseId}/respond`, {
      available,
      available_quantity: available ? (quantity ?? null) : null,
    });
  }

  /** GET /pharmacy/movements — journal complet de l'officine (qui / quoi / quand / pourquoi). */
  movements(): Observable<ApiStockMovement[]> {
    const params = new HttpParams().set('per_page', '200');
    return this.http.get<{ data: ApiStockMovement[] }>(`${this.base}/pharmacy/movements`, { params }).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /pharmacy/stock/{stock}/expire — retrait d'un lot périmé (toute la quantité non réservée par défaut). */
  expire(stockId: number, quantity?: number, reason?: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/pharmacy/stock/${stockId}/expire`, { quantity, reason });
  }

  // ── Module Vente & Comptabilité (offre Pro) ──────────────────

  /** GET /pharmacy/sales?from=&to= */
  sales(from?: string, to?: string): Observable<ApiSale[]> {
    let params = new HttpParams().set('per_page', '100');
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get<{ data: ApiSale[] }>(`${this.base}/pharmacy/sales`, { params }).pipe(map(r => r.data ?? []));
  }

  /** POST /pharmacy/sales — vente complète (lignes, TVA, ordonnance) → reçu numéroté. */
  createSale(payload: { items: NewSaleLine[]; vat_rate: number; customer_name?: string; prescription_ref?: string; payment_method: string }): Observable<{ message: string; data: ApiSale }> {
    return this.http.post<{ message: string; data: ApiSale }>(`${this.base}/pharmacy/sales`, payload);
  }

  /** GET /pharmacy/sales/stats — CA jour / semaine / mois, série 30 j, top ventes. */
  salesStats(): Observable<ApiSalesStats> {
    return this.http.get<{ data: ApiSalesStats }>(`${this.base}/pharmacy/sales/stats`).pipe(map(r => r.data));
  }

  /** GET /pharmacy/sales/{id}/receipt — reçu PDF. */
  receipt(id: number): Observable<Blob> {
    return this.http.get(`${this.base}/pharmacy/sales/${id}/receipt`, { responseType: 'blob' });
  }

  /** GET /pharmacy/sales/export — export comptable CSV. */
  exportSales(from?: string, to?: string): Observable<Blob> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http.get(`${this.base}/pharmacy/sales/export`, { params, responseType: 'blob' });
  }

  /** GET /pharmacy/stock/{stock}/movements — historique réel des mouvements. */
  stockMovements(stockId: number): Observable<ApiStockMovement[]> {
    return this.http.get<{ data: ApiStockMovement[]; medicine?: string }>(`${this.base}/pharmacy/stock/${stockId}/movements`).pipe(
      map(r => (r.data ?? []).map(movement => ({ ...movement, medicine: r.medicine ?? movement.medicine }))),
      catchError(() => of([])),
    );
  }

  /** GET /pharmacy/alerts — alertes de seuil. */
  alerts(): Observable<ApiStockRow[]> {
    return this.http.get<{ data: ApiStockRow[] }>(`${this.base}/pharmacy/alerts`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /**
   * POST /pharmacy/alerts/distributor — demande de réapprovisionnement ciblée :
   * une alerte par fournisseur choisi (cf. StructureService.suppliers pour
   * savoir qui dispose du médicament).
   */
  alertDistributor(stockId: number, distributorIds: number[], quantity?: number, message?: string): Observable<SendResult> {
    return this.http.post<SendResult>(`${this.base}/pharmacy/alerts/distributor`, {
      stock_id: stockId, distributor_ids: distributorIds, quantity, message,
    });
  }

  /** GET /pharmacy/restock-requests — suivi des demandes envoyées aux fournisseurs. */
  restockRequests(): Observable<ApiRestockRequest[]> {
    return this.http.get<{ data: ApiRestockRequest[] }>(`${this.base}/pharmacy/restock-requests`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** GET /pharmacy/dashboard — indicateurs tableau de bord. */
  dashboard(): Observable<Record<string, unknown>> {
    return this.http.get<{ data: Record<string, unknown> }>(`${this.base}/pharmacy/dashboard`).pipe(
      map(r => r.data ?? {}),
      catchError(() => of({})),
    );
  }

  /** POST /pharmacy/stock/{stock}/external-sale — vente externe (PHA-010). */
  externalSale(stockId: number, qty: number, note: string): Observable<unknown> {
    return this.http.post(`${this.base}/pharmacy/stock/${stockId}/external-sale`, { quantity_sold: qty, reason: note });
  }

  /** POST /pharmacy/stock/{stock}/inventory — ajustement d'inventaire (PHA-011). */
  inventoryAdjustment(stockId: number, newQty: number, reason: string): Observable<unknown> {
    return this.http.post(`${this.base}/pharmacy/stock/${stockId}/inventory`, { real_quantity: newQty, reason });
  }

  /** POST /pharmacy/stock — ajouter une référence (lot + date de péremption optionnels). */
  addStock(medicineId: number, quantity: number, threshold: number, batch?: string, expiry?: string): Observable<unknown> {
    return this.http.post(`${this.base}/pharmacy/stock`, {
      medicine_id: medicineId, quantity, threshold_qty: threshold,
      batch_number: batch || undefined, expiry_date: expiry || undefined,
    });
  }

  /** PUT /pharmacy/stock/{stock} — modifier seuil, lot ou péremption. */
  updateStock(stockId: number, data: { threshold_qty?: number; batch_number?: string | null; expiry_date?: string | null }): Observable<unknown> {
    return this.http.put(`${this.base}/pharmacy/stock/${stockId}`, data);
  }

  /** DELETE /pharmacy/stock/{stock} — supprimer un stock. */
  deleteStock(stockId: number): Observable<unknown> {
    return this.http.delete(`${this.base}/pharmacy/stock/${stockId}`);
  }
}

/** Réponse des envois de demandes ciblées (une entrée par fournisseur). */
export interface SendResult { status: string; message: string; data: { id: number; distributor: string }[]; }

function toStockState(status: string): StockState {
  return status === 'out_of_stock' ? 'out' : status === 'low' ? 'low' : 'ok';
}

export function toStockRow(s: ApiStockRow): StockRow {
  const sub = [s.form, s.dosage].filter(Boolean).join(' · ') || (s.is_controlled ? 'Médicament contrôlé' : '—');
  return {
    stockId: s.id,
    medId: s.medicine_id,
    name: s.medicine_name ?? s.medicine ?? '—',
    sub,
    q: s.available,
    reserved: s.reserved,
    seuil: s.threshold_qty ?? s.threshold ?? 0,
    s: toStockState(s.status),
    controlled: s.is_controlled,
    requiresRx: s.requires_prescription ?? s.is_controlled,
    batch: s.batch_number ?? null,
    expiry: s.expiry_date ?? null,
    expiryLevel: s.expiry_level ?? 'none',
    daysToExpiry: s.days_to_expiry ?? null,
  };
}

function toDemandeRow(d: ApiDemande): DemandeRow {
  return {
    id: d.id,
    medId: d.medicine_id ?? null,
    medName: d.medicine ?? '—',
    from: d.patient ?? d.from ?? '—',
    type: d.type,
    qty: d.qty,
    urgency: d.urgency,
    status: d.status,
    quand: formatWhen(d.created_at),
  };
}
