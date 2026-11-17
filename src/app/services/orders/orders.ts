import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { SharedRead } from '../shared-read/shared-read';
import { environment } from '../../../environments/environment';
import { ApiGroupedSearch, ApiGroupedSearchStatus, ApiOrder, ApiPrescriptionLine } from '../../interfaces/api';
import { DispoState, ResaLine, ResaRow } from '../../interfaces/models';

/** Réservations / commandes côté patient. */
@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  /** GET /orders → réservations du patient courant. */
  list(maxAgeMs = 0): Observable<ResaRow[]> {
    return this.listRead.get(maxAgeMs);
  }
  /** Partagé entre la cloche et le premier affichage (`maxAgeMs`, voir `SharedRead`). */
  private readonly listRead = new SharedRead<ResaRow[]>(() =>
    this.http.get<{ data: ApiOrder[] }>(`${this.base}/orders`).pipe(
      map(r => (r.data ?? []).map(toResa)),
    ));

  /** POST /orders → crée une réservation. */
  create(medicineId: number, structureId: number, qty = 1): Observable<unknown> {
    return this.http.post(`${this.base}/orders`, { medicine_id: medicineId, structure_id: structureId, qty });
  }

  /** DELETE /orders/{id} → annule une réservation. */
  cancel(orderId: number): Observable<unknown> {
    return this.http.delete(`${this.base}/orders/${orderId}`);
  }

  /** POST /orders/{id}/lines/{line}/accept-substitute | refuse-substitute → réponse du patient à un équivalent. */
  answerSubstitute(orderId: number, lineId: number, accept: boolean): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/orders/${orderId}/lines/${lineId}/${accept ? 'accept' : 'refuse'}-substitute`, {});
  }

  /** POST /orders/prescriptions → envoie une ordonnance numérique (multipart). */
  submitPrescription(structureId: number, file: File, notes: string): Observable<{ message?: string }> {
    const form = new FormData();
    form.append('structure_id', String(structureId));
    form.append('prescription_file', file);
    if (notes) form.append('notes', notes);
    // Pas de Content-Type manuel : Angular pose la frontière multipart lui-même.
    return this.http.post<{ message?: string }>(`${this.base}/orders/prescriptions`, form);
  }

  /** POST /grouped-search → lance une recherche groupée auprès des pharmacies de la zone. */
  startGroupedSearch(medicineId: number, lat?: number, lng?: number): Observable<ApiGroupedSearch | null> {
    const body: Record<string, unknown> = { medicine_id: medicineId };
    if (lat != null && lng != null) { body['latitude'] = lat; body['longitude'] = lng; }
    return this.http.post<{ data: ApiGroupedSearch | null }>(`${this.base}/grouped-search`, body).pipe(
      map(r => r.data ?? null),
    );
  }

  /** GET /grouped-search/{id}/status → état de la recherche groupée. */
  groupedSearchStatus(searchId: number): Observable<ApiGroupedSearchStatus | null> {
    return this.http.get<ApiGroupedSearchStatus>(`${this.base}/grouped-search/${searchId}/status`);
  }
}

/* Même code couleur que les demandes ciblées du pharmacien et la cloche :
   en préparation = bleu ciel, prête = vert, retirée = turquoise, orientée = violet,
   refusée / annulée = rose, expirée = gris. */
const STATUS: Record<string, { statut: string; s: DispoState; tone: string }> = {
  pending: { statut: 'En préparation', s: 'low', tone: 'sky' },
  confirmed: { statut: 'Prête au retrait', s: 'ok', tone: 'green' },
  collected: { statut: 'Retirée', s: 'ok', tone: 'teal' },
  oriented: { statut: 'Orientée vers une autre officine', s: 'low', tone: 'violet' },
  rejected: { statut: 'Refusée', s: 'out', tone: 'rose' },
  cancelled: { statut: 'Annulée', s: 'out', tone: 'rose' },
  expired: { statut: 'Délai de retrait dépassé', s: 'out', tone: 'gray' },
};

function toResa(o: ApiOrder): ResaRow {
  const m = STATUS[o.status] ?? { statut: o.status, s: 'low' as DispoState, tone: 'gray' };
  const lines = (o.lines ?? []).map(l => toResaLine(l, o.pharmacy));
  return {
    orderId: o.id,
    medName: lines.length > 1 ? `Ordonnance · ${lines.length} médicaments` : (lines[0]?.name ?? o.medicine ?? 'Ordonnance'),
    pharmacyName: o.pharmacy ?? '—',
    statut: m.statut,
    quand: formatWhen(o.created_at),
    s: m.s,
    tone: m.tone,
    status: o.status,
    lines: lines.length ? lines : undefined,
    expiresAt: o.expires_at ?? null,
  };
}

/** Ce que le patient doit comprendre d'une ligne : où la retirer, ou quoi décider. */
function toResaLine(l: ApiPrescriptionLine, pharmacy: string | null): ResaLine {
  const here = pharmacy ?? 'votre officine';
  const labels: Record<string, [string, DispoState, string]> = {
    reserved: [`Prêt chez ${here}`, 'ok', 'green'],
    legacy_debited: [`Prêt chez ${here}`, 'ok', 'green'],
    oriented: [`À retirer chez ${l.target ?? 'une autre officine'}`, 'low', 'violet'],
    substitute_proposed: ['Équivalent proposé : votre accord est nécessaire', 'low', 'amber'],
    substitute_accepted: [`Équivalent accepté — prêt chez ${here}`, 'ok', 'green'],
    substitute_refused: ['Équivalent refusé — demandez conseil à votre pharmacien', 'out', 'rose'],
    collected: ['Retiré', 'ok', 'teal'],
    expired: ['Délai de retrait dépassé', 'out', 'gray'],
    cancelled: ['Non délivré', 'out', 'rose'],
  };
  const [label, s, tone] = labels[l.status] ?? [l.status, 'low' as DispoState, 'gray'];
  return {
    id: l.id, name: l.medicine ?? 'Médicament', qty: l.qty, status: l.status, label, s, tone,
    prescribed: l.prescribed_medicine, target: l.target, targetAddress: l.target_address, targetPhone: l.target_phone,
    originalRequired: l.original_required,
  };
}

export function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) +
    ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
