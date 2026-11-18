import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { GeoMap, GeoMarker } from '../../../components/geo-map/geo-map';
import { PharmacyPoint, REF, StructureService, haversineKm, kmLabel } from '../../../services/structures/structures';
import { GeoService } from '../../../services/geo/geo';
import { PlatformState } from '../../../services/platform/platform';

/** Nombre d'officines mises en avant comme « les plus proches ». */
export const NEAREST = 3;

interface NearPharmacy extends PharmacyPoint { key: string; km: number; dist: string; nearest: boolean }

/* Pharmacies à proximité : vraie carte (Leaflet / OSM) + liste triée par distance réelle. */
@Component({
  selector: 'app-patient-pharmacies',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card, PageHead, GeoMap],
  templateUrl: './patient-pharmacies.html',
  styleUrl: './patient-pharmacies.css',
})
export class PatientPharmacies {
  private readonly structures = inject(StructureService);
  private readonly platform = inject(PlatformState);
  readonly geo = inject(GeoService);
  readonly nearestCount = NEAREST;

  private readonly points = signal<PharmacyPoint[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly sel = signal<string | null>(null);

  /** Distances depuis la position partagée, sinon depuis Dakar Plateau. */
  readonly origin = computed(() => this.geo.position() ?? REF);
  readonly mine = computed(() => this.geo.position() !== null);

  readonly pharmacies = computed<NearPharmacy[]>(() => {
    const from = this.origin();
    return this.points()
      .map(p => { const km = haversineKm(from, p.point); return { ...p, key: String(p.id), km, dist: kmLabel(km), nearest: false }; })
      .sort((a, b) => a.km - b.km)
      .map((p, i) => i < NEAREST ? { ...p, nearest: true } : p);
  });

  readonly markers = computed<GeoMarker[]>(() => this.pharmacies().map(p => ({
    id: p.key,
    point: p.point,
    tone: p.nearest ? 'green' : 'gray',
    label: `${p.name} · ${p.dist}`,
  })));

  /** La carte s'ouvre sur les plus proches et la position, pas sur tout le pays. */
  readonly nearestIds = computed(() => this.pharmacies().filter(p => p.nearest).map(p => p.key));

  constructor() { this.load(); }

  load(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.structures.pharmacyPoints().subscribe({
      next: p => { this.points.set(p); this.loading.set(false); },
      error: () => { this.loadError.set(true); this.loading.set(false); },
    });
  }

  useMyPosition(): void {
    this.geo.locate().then(
      () => this.sel.set(null),
      reason => this.platform.notify(GeoService.failureMessage(reason), 'alert'),
    );
  }

  toggle(key: string): void {
    this.sel.set(this.sel() === key ? null : key);
  }

  /** Itinéraire dans l'application de cartographie du téléphone. */
  directions(p: PharmacyPoint): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${p.point.lat},${p.point.lng}`;
  }

  tel(phone: string): string { return 'tel:' + phone.replace(/\s+/g, ''); }
}
