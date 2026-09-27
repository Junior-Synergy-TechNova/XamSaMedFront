import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiIncomingDelivery } from '../../interfaces/api';

/**
 * Réception d'approvisionnement entrant (officine, hôpital, PRA) et
 * bordereau de livraison PDF (expéditeur ou destinataire).
 */
@Injectable({ providedIn: 'root' })
export class DeliveryReceiptService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /deliveries/incoming — livraisons attendues et reçues (30 j). */
  incoming(): Observable<ApiIncomingDelivery[]> {
    return this.http.get<{ data: ApiIncomingDelivery[] }>(`${this.base}/deliveries/incoming`).pipe(
      map(r => r.data ?? []),
      catchError(() => of([])),
    );
  }

  /** POST /deliveries/{id}/receive — le destinataire confirme la réception (stock crédité). */
  receive(id: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/deliveries/${id}/receive`, {});
  }

  /** GET /deliveries/{id}/slip — bordereau de livraison (PDF). */
  slip(id: number | string): Observable<Blob> {
    return this.http.get(`${this.base}/deliveries/${id}/slip`, { responseType: 'blob' });
  }
}
