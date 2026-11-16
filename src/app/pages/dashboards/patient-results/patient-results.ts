import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { Tag } from '../../../components/tag/tag';
import { EquivalentSet, MedicineService } from '../../../services/medicines/medicines';
import { GeoService } from '../../../services/geo/geo';
import { PlatformState } from '../../../services/platform/platform';
import { AvailabilityRow, Med } from '../../../interfaces/models';
import { ApiGroupedSearchEquivalent } from '../../../interfaces/api';

const ORDER: Record<string, number> = { ok: 0, low: 1, out: 2 };

/**
 * Disponibilité d'abord (en stock, puis stock faible, puis rupture), et à
 * statut égal la plus proche en premier : la bannière « Pharmacie la plus
 * proche disponible » désigne donc réellement l'officine la plus proche.
 */
function byAvailabilityThenDistance(a: AvailabilityRow, b: AvailabilityRow): number {
  const s = (ORDER[a.s] ?? 9) - (ORDER[b.s] ?? 9);
  return s !== 0 ? s : (a.distKm ?? Infinity) - (b.distKm ?? Infinity);
}

/**
 * Classement par score d'accessibilité (§15.4) : l'API a déjà trié par score ;
 * on garde cet ordre et on renvoie seulement les ruptures en fin de liste.
 */
function byScore(a: AvailabilityRow, b: AvailabilityRow): number {
  return Number(a.s === 'out') - Number(b.s === 'out') || (b.score ?? -1) - (a.score ?? -1);
}

/** Raison qui signale un accès gêné (inondation) : mise en avant dans la liste. */
export function isFloodReason(reason: string): boolean { return reason.startsWith('Inondation'); }

/* Résultats de recherche patient : points de disponibilité (API réelle). */
@Component({
  selector: 'app-patient-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card, Tag],
  templateUrl: './patient-results.html',
  styleUrl: './patient-results.css',
})
export class PatientResults {
  private readonly meds = inject(MedicineService);
  private readonly platform = inject(PlatformState);
  protected readonly geo = inject(GeoService);

  readonly med = input.required<Med>();
  readonly back = output<void>();
  readonly reserve = output<number>(); // émet l'id de structure (officine)
  readonly groupedSearch = output<void>(); // demande de recherche groupée (aucune dispo)
  readonly pick = output<Med>(); // ouvre un équivalent thérapeutique proposé

  readonly rows = signal<AvailabilityRow[]>([]);
  readonly loading = signal(true);
  /** Disponibilités non lues : « Réessayer » au lieu de « aucune disponibilité » (qui pousserait à tort vers la recherche groupée). */
  readonly loadError = signal(false);
  private readonly retryTick = signal(0);
  /**
   * Proposés quand le médicament est indisponible partout (§6.1, §9) : équivalents
   * de même DCI d'un côté, alternatives d'une autre molécule (à valider) de l'autre.
   */
  readonly equivSet = signal<EquivalentSet | null>(null);
  readonly equivalents = computed(() => this.equivSet()?.equivalents ?? []);
  readonly alternatives = computed(() => this.equivSet()?.alternatives ?? []);

  /** Position utilisée par le classement : gps, domicile enregistré, ou aucune (pas de score). */
  readonly positionSource = signal<'gps' | 'home' | null>(null);
  /** L'API a renvoyé des scores : la liste est classée par accessibilité, pas seulement par distance. */
  readonly ranked = computed(() => this.rows().some(r => r.score !== null));
  readonly isFloodReason = isFloodReason;

  readonly best = computed(() => this.rows().find(r => r.s !== 'out'));
  readonly availableCount = computed(() => this.rows().filter(r => r.s !== 'out').length);

  constructor() {
    // Rechargement à chaque changement de médicament ; switchMap annule la
    // requête précédente si l'utilisateur change de résultat rapidement.
    // La position partagée relance aussi le classement.
    const query = computed(() => ({ med: this.med(), at: this.geo.position(), tick: this.retryTick() }));
    toObservable(query).pipe(
      tap(() => { this.loading.set(true); this.loadError.set(false); }),
      tap(() => this.equivSet.set(null)),
      switchMap(({ med: m, at }) => this.meds.rankedAvailability(Number(m.id), at).pipe(
        tap(r => this.positionSource.set(r.positionSource)),
        map(r => [...r.rows].sort(r.rows.some(x => x.score !== null) ? byScore : byAvailabilityThenDistance)),
        tap(rows => { this.rows.set(rows); this.loading.set(false); }),
        // Indisponibilité totale : on propose les équivalents classés.
        switchMap(rows => rows.some(r => r.s !== 'out') ? of(null) : this.meds.equivalentSet(Number(m.id), at)),
        catchError(() => { this.rows.set([]); this.loading.set(false); this.loadError.set(true); return of(null); }),
      )),
      takeUntilDestroyed(),
    ).subscribe(set => this.equivSet.set(set));
  }

  open(e: ApiGroupedSearchEquivalent): void {
    this.pick.emit({
      id: String(e.id),
      nom: e.dosage ? `${e.name ?? ''} ${e.dosage}` : (e.name ?? ''),
      dci: e.dci ?? e.name ?? '',
      forme: e.form ?? '',
      crit: false,
      cat: e.same_dci === false ? 'Alternative à valider' : 'Équivalent thérapeutique',
    });
  }
  retry(): void { this.retryTick.update(n => n + 1); }

  /** Partager sa position : le classement est recalculé depuis l'endroit où l'on est. */
  useMyPosition(): void {
    this.geo.locate().catch(reason => this.platform.notify(GeoService.failureMessage(reason), 'alert'));
  }

  /** Ligne secondaire d'un équivalent : note du catalogue (souvent absente), officines, distance. */
  equivLine(e: ApiGroupedSearchEquivalent): string {
    const parts = [e.note?.trim() || [e.dci, e.form].filter(Boolean).join(' · ')];
    parts.push(this.plural(e.available_pharmacies ?? 0, 'pharmacie', 'pharmacies'));
    if (e.nearest_km !== null && e.nearest_km !== undefined) parts.push(`à ${e.nearest_km} km`);
    return parts.filter(Boolean).join(' · ');
  }

  plural(n: number, one: string, many: string): string { return `${n} ${n > 1 ? many : one}`; }
}
