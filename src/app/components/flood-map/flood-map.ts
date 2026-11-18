import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, afterNextRender, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import type * as Leaflet from 'leaflet';
import { ApiFloodReport } from '../../interfaces/api';
import { GeoPoint, PharmacyPoint } from '../../services/structures/structures';

/** Rayon autour d'un signalement confirmé dans lequel une pharmacie est pénalisée (config/score.php). */
export const FLOOD_ZONE_RADIUS_M = 500;

/** Signalement de démonstration (source = demo) : affiché, jamais confirmable, ne pénalise aucune officine. */
export function isDemoFlood(r: ApiFloodReport): boolean { return r.source === 'demo'; }

/**
 * Carte des routes inondées (Leaflet + fond OpenStreetMap), chargée à la demande :
 * la bibliothèque n'entre dans le bundle que quand une page l'affiche.
 * Encapsulation désactivée : Leaflet crée son DOM hors du template Angular ;
 * toutes les classes sont préfixées `pf-fm-` pour ne rien toucher d'autre.
 */
@Component({
  selector: 'pf-flood-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './flood-map.html',
  styleUrl: './flood-map.css',
})
export class FloodMap {
  readonly center = input.required<GeoPoint>();
  readonly radiusM = input(2000);
  readonly reports = input<readonly ApiFloodReport[]>([]);
  readonly pharmacies = input<readonly PharmacyPoint[]>([]);
  /** Officines à moins de FLOOD_ZONE_RADIUS_M d'une inondation confirmée. */
  readonly floodedPharmacyIds = input<ReadonlySet<number>>(new Set());
  readonly me = input<GeoPoint | null>(null);
  readonly selected = input<number | null>(null);
  readonly selectReport = output<number>();

  private readonly box = viewChild.required<ElementRef<HTMLDivElement>>('box');
  private readonly lib = signal<typeof Leaflet | null>(null);
  readonly failed = signal(false);
  private map: Leaflet.Map | null = null;
  private layer: Leaflet.LayerGroup | null = null;
  private lastView = '';
  private lastSet = '';
  private resize: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => {
      import('leaflet').then(L => {
        const c = this.center();
        this.map = L.map(this.box().nativeElement, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
          .setView([c.lat, c.lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(this.map);
        this.layer = L.layerGroup().addTo(this.map);
        // Leaflet mesure son conteneur une seule fois : on le prévient de chaque changement de taille.
        if (typeof ResizeObserver !== 'undefined') {
          this.resize = new ResizeObserver(() => this.map?.invalidateSize());
          this.resize.observe(this.box().nativeElement);
        }
        this.lib.set(L);
      }).catch(() => this.failed.set(true));
    });

    // Redessine dès qu'une donnée change ; ne recadre que si le centre ou le rayon change.
    effect(() => {
      const L = this.lib();
      const center = this.center();
      const radius = this.radiusM();
      const reports = this.reports();
      const pharmacies = this.pharmacies();
      const flooded = this.floodedPharmacyIds();
      const me = this.me();
      const selected = this.selected();
      if (!L || !this.map || !this.layer) return;
      this.draw(L, center, radius, reports, pharmacies, flooded, me, selected);
    });

    inject(DestroyRef).onDestroy(() => { this.resize?.disconnect(); this.map?.remove(); this.map = null; });
  }

  private draw(
    L: typeof Leaflet, center: GeoPoint, radius: number, reports: readonly ApiFloodReport[],
    pharmacies: readonly PharmacyPoint[], flooded: ReadonlySet<number>, me: GeoPoint | null, selected: number | null,
  ): void {
    const layer = this.layer!;
    layer.clearLayers();
    // Nouvel ensemble (signalements / officines), pas une simple sélection : les points apparaissent en cascade.
    const setKey = reports.map(r => r.id + ':' + r.status).join('|') + '/' + pharmacies.map(p => p.id).join('|');
    const fresh = setKey !== this.lastSet;
    this.lastSet = setKey;
    let rank = 0;
    const pop = (el: Element | undefined) => {
      if (!fresh || !el) return;
      el.classList.add('pf-fm-pop');
      (el as SVGElement).style.animationDelay = Math.min(rank++, 24) * 25 + 'ms';
    };

    L.circle([center.lat, center.lng], { radius, className: 'pf-fm-area', interactive: false }).addTo(layer);

    // Zones pénalisantes autour des inondations confirmées (réelles), sous les points.
    for (const r of reports) {
      if (r.status !== 'confirmed' || isDemoFlood(r)) continue;
      pop(L.circle([r.latitude, r.longitude], { radius: FLOOD_ZONE_RADIUS_M, className: 'pf-fm-zone', interactive: false }).addTo(layer).getElement());
    }

    for (const p of pharmacies) {
      const hit = flooded.has(p.id);
      pop(L.circleMarker([p.point.lat, p.point.lng], { radius: 6, className: hit ? 'pf-fm-pharm pf-fm-pharm-hit' : 'pf-fm-pharm' })
        .bindTooltip(hit ? `${p.name} — accès gêné par une inondation` : p.name, { direction: 'top' })
        .addTo(layer).getElement());
    }

    for (const r of reports) {
      const cls = `pf-fm-flood pf-fm-${r.severity}${r.status === 'confirmed' ? '' : ' pf-fm-unconfirmed'}${r.id === selected ? ' pf-fm-selected' : ''}`;
      pop(L.circleMarker([r.latitude, r.longitude], { radius: r.id === selected ? 13 : 10, className: cls })
        .bindTooltip(`${r.severity_label} · ${r.status_label} (${r.confirmations}/${r.confirmations_required})${isDemoFlood(r) ? ' · Démonstration' : ''}`, { direction: 'top' })
        .on('click', () => this.selectReport.emit(r.id))
        .addTo(layer).getElement());
    }

    if (me) {
      L.circleMarker([me.lat, me.lng], { radius: 7, className: 'pf-fm-me-ring', interactive: false }).addTo(layer);
      L.circleMarker([me.lat, me.lng], { radius: 7, className: 'pf-fm-me', interactive: false }).addTo(layer);
    }

    const view = `${center.lat},${center.lng},${radius}`;
    if (view !== this.lastView) {
      this.lastView = view;
      // Cadrage calculé sans dépendre du rendu du cercle (indisponible tant que la carte n'a pas de taille).
      this.map!.fitBounds(L.latLng(center.lat, center.lng).toBounds(radius * 2), { padding: [12, 12] });
    }
  }
}
