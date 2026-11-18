import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap, tap } from 'rxjs';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Stat } from '../../../components/stat/stat';
import { Tag } from '../../../components/tag/tag';
import { FLOOD_ZONE_RADIUS_M, FloodMap, isDemoFlood } from '../../../components/flood-map/flood-map';
import { ModalA11y } from '../../../directives/modal-a11y/modal-a11y';
import { ScrollActive } from '../../../directives/scroll-active/scroll-active';
import { PlatformState } from '../../../services/platform/platform';
import { FloodService } from '../../../services/floods/floods';
import { GeoService } from '../../../services/geo/geo';
import { GeoPoint, PharmacyPoint, REF, StructureService, haversineKm, kmLabel } from '../../../services/structures/structures';
import { ApiErrorBody, ApiFloodReport, FloodSeverity } from '../../../interfaces/api';

const RADII: readonly { m: number; label: string }[] = [
  { m: 2000, label: '2 km' }, { m: 5000, label: '5 km' }, { m: 10000, label: '10 km' },
];

export const SEVERITIES: readonly { id: FloodSeverity; label: string; hint: string }[] = [
  { id: 'difficult', label: 'Praticable avec difficulté', hint: 'On passe à pied ou en voiture, lentement.' },
  { id: 'very_difficult', label: 'Très difficile', hint: 'Eau haute : seuls les véhicules hauts passent.' },
  { id: 'impassable', label: 'Impraticable', hint: 'Personne ne passe.' },
];

/** Officine dont l'accès est gêné : inondation confirmée à moins de 500 m. */
interface AffectedPharmacy { pharmacy: PharmacyPoint; floodM: number; severity: string; }

/* ============================================================
   PATIENT — Routes inondées : carte, signalement, confirmation
   (GET/POST /flood-reports, POST /flood-reports/{id}/confirm)
   ============================================================ */
@Component({
  selector: 'app-patient-floods',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card, PageHead, Stat, Tag, FloodMap, ModalA11y, ScrollActive, DatePipe],
  templateUrl: './patient-floods.html',
  styleUrl: './patient-floods.css',
})
export class PatientFloods {
  private readonly floods = inject(FloodService);
  private readonly structures = inject(StructureService);
  private readonly platform = inject(PlatformState);
  protected readonly geo = inject(GeoService);

  readonly radii = RADII;
  readonly severities = SEVERITIES;
  readonly zoneRadius = FLOOD_ZONE_RADIUS_M;

  /** Centre de la recherche : position partagée par l'utilisateur, sinon Dakar Plateau. */
  readonly center = signal<GeoPoint>(this.geo.position() ?? REF);
  readonly centerIsMine = signal(this.geo.position() !== null);
  readonly radius = signal(5000);

  readonly reports = signal<ApiFloodReport[]>([]);
  readonly pharmacies = signal<PharmacyPoint[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly pharmaciesError = signal(false);
  readonly selected = signal<number | null>(null);

  readonly reportOpen = signal(false);
  readonly reportSeverity = signal<FloodSeverity>('very_difficult');
  readonly sending = signal(false);
  readonly confirming = signal<number | null>(null);
  /** Relance la lecture (Réessayer, après un signalement). */
  private readonly reloadTick = signal(0);

  constructor() {
    const query = computed(() => ({ center: this.center(), radius: this.radius(), tick: this.reloadTick() }));
    toObservable(query).pipe(
      tap(() => this.loading.set(this.reports().length === 0)),
      switchMap(q => this.floods.near(q.center, q.radius).pipe(
        tap(list => { this.reports.set(list); this.loadError.set(false); this.loading.set(false); }),
        catchError(() => { this.loadError.set(true); this.loading.set(false); return of(null); }),
      )),
      takeUntilDestroyed(),
    ).subscribe();

    this.structures.pharmacyPoints().subscribe({
      next: p => this.pharmacies.set(p),
      error: () => this.pharmaciesError.set(true),
    });
  }

  // ── Dérivés ───────────────────────────────────────────────────
  readonly confirmed = computed(() => this.reports().filter(r => r.status === 'confirmed'));
  /** Inondations qui pénalisent une officine : confirmées et réelles (une démo ne compte pas dans le score). */
  readonly penalizing = computed(() => this.confirmed().filter(r => !isDemoFlood(r)));

  readonly counts = computed(() => ({
    total: this.reports().length,
    confirmed: this.confirmed().length,
    impassable: this.reports().filter(r => r.severity === 'impassable').length,
    pharmacies: this.affected().length,
  }));

  /** Officines du rayon dont l'accès est gêné (même règle que le score d'accessibilité). */
  readonly affected = computed<AffectedPharmacy[]>(() => {
    const floods = this.penalizing();
    if (!floods.length) return [];
    const out: AffectedPharmacy[] = [];
    for (const p of this.pharmacies()) {
      let best: { m: number; r: ApiFloodReport } | null = null;
      for (const r of floods) {
        const m = haversineKm(p.point, { lat: r.latitude, lng: r.longitude }) * 1000;
        if (m <= FLOOD_ZONE_RADIUS_M && (!best || m < best.m)) best = { m, r };
      }
      if (best) out.push({ pharmacy: p, floodM: Math.round(best.m), severity: best.r.severity_label });
    }
    return out.sort((a, b) => a.floodM - b.floodM);
  });

  readonly affectedIds = computed<ReadonlySet<number>>(() => new Set(this.affected().map(a => a.pharmacy.id)));

  /** Officines dans le rayon affiché (la carte n'en dessine pas des centaines hors champ). */
  readonly visiblePharmacies = computed(() => {
    const c = this.center();
    const max = this.radius() / 1000;
    return this.pharmacies().filter(p => haversineKm(c, p.point) <= max);
  });

  // ── Libellés ──────────────────────────────────────────────────
  distance(r: ApiFloodReport): string { return r.distance_metres === undefined ? '' : kmLabel(r.distance_metres / 1000); }
  isDemo(r: ApiFloodReport): boolean { return isDemoFlood(r); }
  tone(r: ApiFloodReport): 'red' | 'amber' { return r.severity === 'impassable' ? 'red' : 'amber'; }
  plural(n: number, one: string, many: string): string { return `${n} ${n > 1 ? many : one}`; }

  private apiError(e: HttpErrorResponse, fallback: string): string {
    const body = e.error as ApiErrorBody | null;
    return body?.errors ? Object.values(body.errors)[0]?.[0] ?? body.message ?? fallback : body?.message ?? fallback;
  }

  // ── Actions ───────────────────────────────────────────────────
  setRadius(m: number): void { this.radius.set(m); }
  retry(): void { this.reloadTick.update(n => n + 1); }

  useMyPosition(): void {
    this.geo.locate().then(
      p => { this.center.set(p); this.centerIsMine.set(true); },
      reason => this.platform.notify(GeoService.failureMessage(reason), 'alert'),
    );
  }

  /** Signaler : la position actuelle du téléphone est l'endroit inondé. */
  sendReport(): void {
    if (this.sending()) return;
    this.sending.set(true);
    this.geo.locate(true).then(
      at => this.floods.report(at, this.reportSeverity()).subscribe({
        next: r => {
          this.sending.set(false);
          this.reportOpen.set(false);
          this.platform.notify(r.merged
            ? 'Merci, vous avez confirmé un signalement existant à cet endroit.'
            : `Signalement enregistré. Il sera confirmé quand ${r.confirmations_required} personnes l'auront vu.`, 'ok');
          this.center.set(at);
          this.centerIsMine.set(true);
          this.selected.set(r.id);
          this.retry();
        },
        error: (e: HttpErrorResponse) => { this.sending.set(false); this.platform.notify(this.apiError(e, 'Signalement non envoyé — réessayez.'), 'alert'); },
      }),
      reason => { this.sending.set(false); this.platform.notify(GeoService.failureMessage(reason), 'alert'); },
    );
  }

  /** Confirmer : il faut être sur place (moins de 200 m), la position est relue à l'instant. */
  confirm(r: ApiFloodReport): void {
    if (this.confirming() !== null || r.confirmed_by_me) return;
    this.confirming.set(r.id);
    this.geo.locate(true).then(
      at => this.floods.confirm(r.id, at).subscribe({
        next: updated => {
          this.confirming.set(null);
          // La liste garde sa distance (absente de la réponse de confirmation).
          this.reports.update(list => list.map(x => x.id === updated.id ? { ...updated, distance_metres: x.distance_metres, confirmed_by_me: true } : x));
          this.platform.notify(updated.status === 'confirmed' ? 'Merci : l\'inondation est maintenant confirmée.' : 'Merci pour votre confirmation.', 'ok');
        },
        error: (e: HttpErrorResponse) => { this.confirming.set(null); this.platform.notify(this.apiError(e, 'Confirmation non envoyée — réessayez.'), 'alert'); },
      }),
      reason => { this.confirming.set(null); this.platform.notify(GeoService.failureMessage(reason), 'alert'); },
    );
  }
}
