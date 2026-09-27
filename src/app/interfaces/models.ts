/* ============================================================
   XamSaMed — Types & interfaces du domaine
   (extraits de mock-data.ts pour centraliser les contrats)
   ============================================================ */

export type RoleId = 'patient' | 'pharma' | 'distrib' | 'hopital' | 'sante';
export type StockState = 'ok' | 'low' | 'crit' | 'out';
export type DispoState = 'ok' | 'low' | 'out';
export type ZoneLevel = 'crit' | 'haute' | 'moyenne' | 'basse';
export type NotifKind = 'ok' | 'alert' | 'info';

export interface Med { id: string; nom: string; dci: string; forme: string; crit: boolean; cat: string; }
export interface Pharmacy { id: string; nom: string; ville: string; dist: string; tel: string; horaires: string; lat: number; lng: number; }
export interface Dispo { p: string; q: string; s: DispoState; }
export interface StockItem { id: string; q: number; seuil: number; s: StockState; }
export interface Demande { id: string; med: string; de: string; type: string; qte: string; urgence: string; quand: string; statut: string; }
export interface DemandePharmacy { id: number; nom: string; adresse: string; tel: string; available: number; status: string; }
export interface DemandeReg { id: string; zone: string; medId: number; med: string; controlled: boolean; need: number; tension: ZoneLevel; officines: number; pharmacies: DemandePharmacy[]; }
export interface ZoneInfo { nom: string; x: number; y: number; niveau: ZoneLevel; ruptures: number; }
export interface Tension { nom: string; pct: number; variation: number; score: number; controlled: boolean; ruptures: number; }
export interface AlerteHop {
  id: string; medId?: number | null; med: string; service: string; unit?: string | null;
  niveau: ZoneLevel;
  /** tension (stock critique non nul) | rupture (stock à zéro). */
  severity: 'tension' | 'rupture';
  controlled: boolean;
  reste: string; quand: string; requestedTo?: number[];
}
export interface Role { id: RoleId; label: string; icon: string; desc: string; }
export interface NavItem {
  id: string; label: string; icon: string; badge?: number;
  /** Restreint l'entrée à certains types de structure (ex. « pra » pour les réceptions PNA). */
  types?: readonly string[];
  /** Restreint l'entrée à un secteur (ex. « Commandes PRA » : hôpitaux publics). */
  sector?: 'public' | 'private';
}
export interface Notif { icon: string; s: NotifKind; t: string; d: string; target?: string; id?: number; read?: boolean; }
export interface Feature { role: string; icon: string; color: 'green' | 'blue'; items: [string, string, string][]; }

/* ---- Vues mappées depuis l'API (consommées par les dashboards) ---- */
/**
 * Point de disponibilité d'un médicament. `lat`/`lng` sont conservés bruts pour
 * pouvoir recalculer la distance depuis n'importe quel point de référence
 * (patient ou officine qui oriente) ; `distKm` est la distance retenue (km,
 * null si coordonnées inconnues) et `dist` son libellé affiché.
 */
export interface AvailabilityRow { structureId: number; pharmacy: string; city: string; phone: string; lat: number | null; lng: number | null; distKm: number | null; dist: string; s: DispoState; label: string; available: number; }
export interface ResaRow { orderId: number; medName: string; pharmacyName: string; statut: string; quand: string; s: DispoState; status: string; }
export type ExpiryLevel = 'none' | 'ok' | 'warn' | 'crit' | 'expired';
export interface StockRow {
  stockId: number; medId: number; name: string; sub: string; q: number; reserved: number; seuil: number; s: StockState;
  controlled: boolean; requiresRx: boolean;
  batch: string | null; expiry: string | null; expiryLevel: ExpiryLevel; daysToExpiry: number | null;
}
export interface DemandeRow { id: number; medId: number | null; medName: string; from: string; type: string; qty: number; urgency: string; status: string; quand: string; }
export interface CritMedRow { medId: number; name: string; available: number; s: StockState; }

export type DeliveryStatus = 'Planifiée' | 'En transit' | 'Livrée' | 'Annulée';
export interface DeliveryRow { id: string; zone: string; destination: string; med: string; controlled: boolean; qty: number; date: string; status: DeliveryStatus; slip: string | null; }

/** Périmètre d'un compte distributeur, déduit de structures.type. */
export type SupplierKind = 'PNA' | 'PRA' | 'PRIVATE';
