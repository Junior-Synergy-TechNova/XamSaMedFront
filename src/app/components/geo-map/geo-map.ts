import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, afterNextRender, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import type * as Leaflet from 'leaflet';
import { GeoPoint, REF } from '../../services/structures/structures';

/** Couleur d'un point : mêmes teintes que les pastilles `pf-tag` / `pf-liic`. */
export type GeoTone = 'red' | 'amber' | 'green' | 'blue' | 'gray' | 'dark';

/** Point affiché sur la carte. `size` = rayon du halo en pixels (0 = pas de halo). */
export interface GeoMarker {
  id: string;
  point: GeoPoint;
  label: string;
  tone: GeoTone;
  size?: number;
}

/**
 * Carte générique (Leaflet + fond OpenStreetMap), chargée à la demande : la
 * bibliothèque n'entre dans le bundle que quand une page l'affiche.
 * Sert aux zones en tension (distributeur, santé publique) et aux pharmacies
 * proches (patient). Encapsulation désactivée : Leaflet crée son DOM hors du
 * template ; toutes les classes sont préfixées `pf-gm-`.
 */
@Component({
  selector: 'pf-geo-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './geo-map.html',
  styleUrl: './geo-map.css',
})
export class GeoMap {
  readonly markers = input<readonly GeoMarker[]>([]);
  readonly selected = input<string | null>(null);
  /** Position de l'utilisateur (point bleu), incluse dans le cadrage. */
  readonly me = input<GeoPoint | null>(null);
  /** Zoom maximal du cadrage automatique (évite de coller à un seul point). */
  readonly maxZoom = input(14);
  /** Ids des points à cadrer (null = tous). Ex. : seulement les officines les plus proches. */
  readonly fitIds = input<readonly string[] | null>(null);
  readonly label = input('Carte');
  readonly select = output<string>();

  private readonly box = viewChild.required<ElementRef<HTMLDivElement>>('box');
  private readonly lib = signal<typeof Leaflet | null>(null);
  readonly failed = signal(false);
  private map: Leaflet.Map | null = null;
  private layer: Leaflet.LayerGroup | null = null;
  private lastFrame = '';
  private lastSelected: string | null = null;
  private resize: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => {
      import('leaflet').then(L => {
        this.map = L.map(this.box().nativeElement, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
          .setView([REF.lat, REF.lng], 11);
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

    effect(() => {
      const L = this.lib();
      const markers = this.markers();
      const selected = this.selected();
      const me = this.me();
      const fitIds = this.fitIds();
      if (!L || !this.map || !this.layer) return;
      this.draw(L, markers, selected, me, fitIds);
    });

    inject(DestroyRef).onDestroy(() => { this.resize?.disconnect(); this.map?.remove(); this.map = null; });
  }

  private draw(L: typeof Leaflet, markers: readonly GeoMarker[], selected: string | null, me: GeoPoint | null, fitIds: readonly string[] | null): void {
    const layer = this.layer!;
    const map = this.map!;
    layer.clearLayers();

    // Halos d'abord, pour que les points restent cliquables au-dessus.
    for (const m of markers) {
      if (!m.size) continue;
      L.circleMarker([m.point.lat, m.point.lng], { radius: m.size, className: `pf-gm-halo pf-gm-${m.tone}`, interactive: false }).addTo(layer);
    }
    for (const m of markers) {
      const on = m.id === selected;
      L.circleMarker([m.point.lat, m.point.lng], { radius: on ? 10 : 7, className: `pf-gm-dot pf-gm-${m.tone}${on ? ' pf-gm-on' : ''}` })
        .bindTooltip(m.label, { direction: 'top', offset: [0, -6] })
        .on('click', () => this.select.emit(m.id))
        .addTo(layer);
    }
    if (me) L.circleMarker([me.lat, me.lng], { radius: 7, className: 'pf-gm-me', interactive: false }).bindTooltip('Votre position').addTo(layer);

    // Recadre seulement quand l'ensemble des points change (pas à chaque sélection).
    const framed = fitIds ? markers.filter(m => fitIds.includes(m.id)) : markers;
    const pts: [number, number][] = framed.map(m => [m.point.lat, m.point.lng]);
    if (me) pts.push([me.lat, me.lng]);
    const frame = pts.map(p => p.join(',')).join(';');
    if (frame !== this.lastFrame && pts.length > 0) {
      this.lastFrame = frame;
      map.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: this.maxZoom() });
    }

    // Une sélection faite depuis la liste amène le point à l'écran.
    if (selected !== this.lastSelected) {
      this.lastSelected = selected;
      const s = markers.find(m => m.id === selected);
      if (s && !map.getBounds().pad(-0.1).contains([s.point.lat, s.point.lng])) map.panTo([s.point.lat, s.point.lng]);
    }
  }
}
