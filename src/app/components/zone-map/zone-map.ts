import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ZoneInfo, ZoneLevel } from '../../interfaces/models';
import { GeoMap, GeoMarker, GeoTone } from '../geo-map/geo-map';

const TONE: Record<ZoneLevel, GeoTone> = { crit: 'red', haute: 'amber', moyenne: 'green', basse: 'blue' };
const LABEL: Record<ZoneLevel, string> = { crit: 'Critique', haute: 'Tension haute', moyenne: 'Modérée', basse: 'Faible' };
/** Halo de base par niveau (px), grossi selon le nombre de ruptures. */
const HALO: Record<ZoneLevel, number> = { crit: 26, haute: 21, moyenne: 16, basse: 12 };

/* Carte des zones (tensions d'approvisionnement) — distributeur / PRA / PNA + santé publique.
   Vraie carte (Leaflet / OpenStreetMap) placée sur les coordonnées des structures de chaque ville. */
@Component({
  selector: 'pf-zone-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GeoMap],
  templateUrl: './zone-map.html',
  styleUrl: './zone-map.css',
})
export class ZoneMap {
  readonly zones = input<ZoneInfo[]>([]);
  readonly selected = input<string | null>(null);
  readonly sel = output<string>();

  readonly markers = computed<GeoMarker[]>(() => this.zones().flatMap(z => z.point ? [{
    id: z.nom,
    point: z.point,
    tone: TONE[z.niveau],
    size: HALO[z.niveau] + Math.min(12, z.ruptures * 2),
    label: `${z.nom} — ${LABEL[z.niveau]} · ${z.ruptures} ${z.ruptures > 1 ? 'ruptures' : 'rupture'}`
      + (z.tensions && z.tensions > z.ruptures ? `, ${z.tensions - z.ruptures} sous seuil` : ''),
  }] : []));

  /** Zones dont aucune structure n'est géolocalisée : listées sous la carte plutôt que placées au hasard. */
  readonly unplaced = computed(() => this.zones().filter(z => !z.point).map(z => z.nom));
}
