import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { catchError, combineLatest, forkJoin, map, of, switchMap } from 'rxjs';
import { Icon } from '../icon/icon';
import { Card } from '../card/card';
import { FieldLabel } from '../../directives/field-label/field-label';
import { GeoMap, GeoMarker, GeoTone } from '../geo-map/geo-map';
import { ApiSupplier } from '../../interfaces/api';
import { AvailabilityRow } from '../../interfaces/models';
import { GeoPoint, PharmacyPoint, StructureService, haversineKm, kmLabel, toPoint } from '../../services/structures/structures';
import { MedicineService } from '../../services/medicines/medicines';

/** Médicament proposé dans le sélecteur (lignes du stock de la structure). */
export interface MapMedicine { id: number; label: string; state: 'out' | 'crit' | 'low' | 'ok' }
/** « Demander » sur un fournisseur : l'hôte ouvre son formulaire de demande, ce fournisseur pré-coché. */
export interface MapRequest { medicineId: number; supplierId: number }

const STATE_LABEL: Record<MapMedicine['state'], string> = { out: 'rupture', crit: 'critique', low: 'stock bas', ok: '' };
/** Officines avec stock listées / cadrées. */
const NEAREST = 6;
/** Rayon de cadrage automatique autour de la structure (km). */
const FIT_KM = 30;

interface SupplierPin { key: string; s: ApiSupplier; point: GeoPoint | null; km: number | null; dist: string }
interface PharmacyPin { key: string; id: number; name: string; city: string; point: GeoPoint; km: number | null; dist: string; available: number | null; tone: GeoTone }

/**
 * Carte du réseau d'une officine ou d'un hôpital : sa position, ses fournisseurs
 * autorisés (règles §3.3, lues dans GET /distributors) et les officines, colorés
 * selon le stock du médicament choisi (GET /medicines/{id}/availability).
 * Sert à choisir à qui demander un réapprovisionnement et où orienter un patient.
 */
@Component({
  selector: 'pf-network-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card, FieldLabel, GeoMap],
  templateUrl: './network-map.html',
  styleUrl: './network-map.css',
})
export class NetworkMap {
  private readonly structures = inject(StructureService);
  private readonly medicinesApi = inject(MedicineService);

  readonly medicines = input<readonly MapMedicine[]>([]);
  /** Position de la structure connectée (null = non géolocalisée). */
  readonly origin = input<GeoPoint | null>(null);
  readonly originName = input('Votre structure');
  /** Exclut la structure connectée de la liste des officines. */
  readonly selfId = input<number | null>(null);
  /** Fournisseurs ayant déjà une demande en attente, par médicament (« Demandé » au lieu de « Demander »). */
  readonly asked = input<ReadonlyMap<number, ReadonlySet<number>>>(new Map());
  readonly request = output<MapRequest>();

  /** null = pas encore choisi (on prend la première rupture), 0 = tout le réseau. */
  private readonly picked = signal<number | null>(null);
  readonly sel = signal<string | null>(null);
  private readonly retryTick = signal(0);

  readonly options = computed(() => {
    const rank = { out: 0, crit: 1, low: 2, ok: 3 } as const;
    return [...this.medicines()]
      .sort((a, b) => rank[a.state] - rank[b.state] || a.label.localeCompare(b.label))
      .map(m => ({ ...m, text: STATE_LABEL[m.state] ? `${m.label} — ${STATE_LABEL[m.state]}` : m.label }));
  });
  readonly medId = computed(() => {
    const p = this.picked();
    if (p !== null) return p;
    const first = this.options()[0];
    return first && first.state !== 'ok' ? first.id : 0;
  });
  readonly medLabel = computed(() => this.options().find(m => m.id === this.medId())?.label ?? '');

  readonly loading = signal(true);
  readonly error = signal(false);
  private readonly pharmacyPoints = signal<PharmacyPoint[]>([]);
  private readonly suppliersRaw = signal<ApiSupplier[]>([]);
  private readonly availability = signal<AvailabilityRow[]>([]);
  readonly rule = signal<string | null>(null);

  readonly suppliers = computed<SupplierPin[]>(() => {
    const from = this.origin();
    return this.suppliersRaw().map(s => {
      const point = toPoint(s.latitude, s.longitude);
      const km = from && point ? haversineKm(from, point) : null;
      return { key: 's' + s.id, s, point, km, dist: kmLabel(km) };
    });
  });

  /** Toutes les officines ; avec un médicament choisi, colorées selon leur stock. */
  readonly pharmacies = computed<PharmacyPin[]>(() => {
    const from = this.origin();
    const self = this.selfId();
    const med = this.medId();
    const stock = new Map(this.availability().map(r => [r.structureId, r]));
    return this.pharmacyPoints()
      .filter(p => p.id !== self)
      .map(p => {
        const row = stock.get(p.id);
        const km = from ? haversineKm(from, p.point) : null;
        const tone: GeoTone = !med ? 'gray' : !row || row.available <= 0 ? 'red' : row.s === 'low' ? 'amber' : 'green';
        return { key: 'p' + p.id, id: p.id, name: p.name, city: p.city, point: p.point, km, dist: kmLabel(km), available: med ? row?.available ?? 0 : null, tone };
      })
      .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  });

  /** Officines qui ont le médicament, les plus proches d'abord. */
  readonly withStock = computed(() => this.pharmacies().filter(p => (p.available ?? 0) > 0).slice(0, NEAREST));
  readonly suppliersWithStock = computed(() => this.suppliers().filter(s => s.s.has_stock).length);

  readonly markers = computed<GeoMarker[]>(() => {
    const med = this.medId();
    const out: GeoMarker[] = this.pharmacies().map(p => ({
      id: p.key, point: p.point, tone: p.tone,
      label: med ? `${p.name} · ${p.available ? p.available + ' disponibles' : 'pas de stock'}${p.km !== null ? ' · ' + p.dist : ''}` : `${p.name}${p.km !== null ? ' · ' + p.dist : ''}`,
    }));
    for (const s of this.suppliers()) {
      if (!s.point) continue;
      const stock = !med ? '' : s.s.has_stock ? ` · ${s.s.available} disponibles` : ' · pas de stock';
      out.push({ id: s.key, point: s.point, tone: 'violet', size: med && s.s.has_stock ? 16 : 0, label: `${s.s.name} (${s.s.kind})${stock}` });
    }
    return out;
  });

  /**
   * Cadrage : fournisseurs + officines utiles (avec stock, sinon les plus proches), limitées à
   * FIT_KM — une seule officine lointaine dézoomait la carte sur tout le pays (elle reste listée).
   */
  readonly fitIds = computed(() => {
    const near = (p: PharmacyPin) => p.km === null || p.km <= FIT_KM;
    const stocked = this.withStock().filter(near);
    const useful = this.medId() && stocked.length > 0 ? stocked : this.pharmacies().filter(near).slice(0, NEAREST);
    return [...this.suppliers().filter(s => s.point).map(s => s.key), ...useful.map(p => p.key)];
  });

  readonly unplacedSuppliers = computed(() => this.suppliers().filter(s => !s.point).map(s => s.s.name));

  constructor() {
    combineLatest([toObservable(this.medId), toObservable(this.retryTick)]).pipe(
      switchMap(([med]) => {
        this.loading.set(true);
        this.error.set(false);
        return forkJoin({
          points: this.pharmacyPoints().length ? of(this.pharmacyPoints()) : this.structures.pharmacyPoints(),
          sup: this.structures.suppliersWithRule(med || null),
          av: med ? this.medicinesApi.rankedAvailability(med, this.origin()).pipe(map(r => r.rows)) : of([] as AvailabilityRow[]),
        }).pipe(catchError(() => of(null)));
      }),
      takeUntilDestroyed(),
    ).subscribe(r => {
      this.loading.set(false);
      if (!r) { this.error.set(true); return; }
      this.pharmacyPoints.set(r.points);
      this.suppliersRaw.set(r.sup.data);
      this.rule.set(r.sup.rule);
      this.availability.set(r.av);
    });
  }

  isAsked(supplierId: number): boolean { return this.asked().get(this.medId())?.has(supplierId) ?? false; }

  ask(supplierId: number): void { this.request.emit({ medicineId: this.medId(), supplierId }); }

  pick(value: string): void {
    this.picked.set(Number(value));
    this.sel.set(null);
  }

  retry(): void { this.retryTick.update(n => n + 1); }

  toggle(key: string): void { this.sel.set(this.sel() === key ? null : key); }
}
