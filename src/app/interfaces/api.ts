/* ============================================================
   Contrats d'API du backend Laravel (XamSaMed / Sanctum).
   ============================================================ */

export type BackendRole =
  | 'patient' | 'pharmacy_user' | 'hospital_user' | 'distributor_user' | 'admin';

/** Type de structure en base (structures.type). */
export type StructureType = 'pharmacy' | 'hospital' | 'distributor' | 'pna' | 'pra';

/** Secteur (§3.3) : public = PNA, PRA, hôpitaux publics ; privé = distributeurs, officines, cliniques. */
export type Sector = 'public' | 'private';

/** Offre commerciale (§10) — le module Vente & Comptabilité est réservé à « pro ». */
export type Plan = 'starter' | 'pro' | 'institutionnel';

/** Structure rattachée à l'utilisateur (renvoyée par /login et /me). */
export interface ApiUserStructure {
  id: number;
  name: string;
  type: StructureType;
  sector?: Sector | null;
  plan?: Plan | null;
  code?: string | null;
  city: string | null;
  region: string | null;
  address?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  /** Coordonnées de la structure : servent de point de référence pour « la plus proche ». */
  latitude?: number | string | null;
  longitude?: number | string | null;
}

export interface ApiUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: BackendRole;
  structure_id: number | null;
  /** Le périmètre distributeur (PNA / PRA / privé) se lit ici, en base. */
  structure?: ApiUserStructure | null;
  profile_meta?: Record<string, unknown> | null;
  email_verified_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** POST /login */
export interface LoginResponse {
  user: ApiUser;
  token: string;
}

/** Canal OTP (§13) : email actif ; SMS / WhatsApp selon la configuration Twilio du serveur. */
export type OtpChannel = 'email' | 'sms' | 'whatsapp';

/** POST /login/otp/request */
export interface OtpRequestResponse {
  status: string;
  channel: OtpChannel;
  message: string;
  expires_in: number;
  channels: Record<OtpChannel, boolean>;
  debug_code?: string;
}

/* ---- GET /distributor/alerts (réponse actuellement mockée côté backend) ---- */
export interface PharmacyReport {
  pharmacy_id: number;
  pharmacy_name: string;
  reported_at: string;
}
export interface ShortageAlert {
  medicine_id: number;
  name: string;
  is_controlled?: boolean;
  pharmacies: PharmacyReport[];
  severity: 'high' | 'medium' | 'low' | string;
}
export interface DistributorAlertsResponse {
  status: string;
  data: ShortageAlert[];
}

/* ---- Référentiel & domaine (réponses API) ---- */
export interface ApiMedicine {
  id: number;
  name: string;
  dci?: string | null;
  brand: string | null;
  form: string | null;
  dosage: string | null;
  is_controlled: boolean;
  requires_prescription?: boolean;
  /** pharmaceutical | hospital | both — séparation officine ↔ hôpital. */
  category?: string;
}

export interface GlobalSearchResult {
  type: 'medicine' | 'pharmacy' | string;
  id: number;
  label: string;
  name?: string;
  dosage?: string | null;
  form?: string | null;
  city?: string | null;
}
export interface ApiAvailabilityRow {
  structure_id: number;
  pharmacy_name: string;
  pharmacy?: string;
  city: string | null;
  phone: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  status: string;
  available: number;
  label: string;
  distance_label?: string | null;
  /** Renseigné quand l'appel fournit une position GPS (tri PostGIS côté API). */
  distance_metres?: number | string | null;
}
export interface ApiStructure {
  id: number;
  name: string;
  type: string;
  sector?: Sector | null;
  plan?: Plan | null;
  city: string | null;
  region?: string | null;
  address: string | null;
  phone: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  hours: string | null;
}
export interface ApiOrder {
  id: number;
  medicine: string | null;
  medicine_id: number;
  pharmacy: string | null;
  structure_id: number;
  qty: number;
  status: string;
  created_at: string | null;
}
export interface ApiStockRow {
  id: number;
  medicine_id: number;
  medicine?: string | null;
  medicine_name?: string | null;
  form: string | null;
  dosage: string | null;
  is_controlled: boolean;
  quantity: number;
  reserved: number;
  available: number;
  threshold?: number;
  threshold_qty?: number;
  status: string;
  requires_prescription?: boolean;
  category?: string;
  batch_number?: string | null;
  expiry_date?: string | null;
  /** Code couleur péremption : ok (> 3 mois) | warn (< 3 mois) | crit (< 1 mois) | expired | none. */
  expiry_level?: ExpiryLevel;
  days_to_expiry?: number | null;
}
export type ExpiryLevel = 'none' | 'ok' | 'warn' | 'crit' | 'expired';
export interface ApiDemande {
  id: number;
  medicine: string | null;
  medicine_id: number;
  from: string | null;
  patient?: string | null;
  type: string;
  qty: number;
  urgency: string;
  status: string;
  created_at: string | null;
}
export interface ApiRegionalDemandPharmacy {
  id: number;
  name: string;
  type?: string;
  address: string | null;
  phone: string | null;
  status: string;
  available: number;
}
export interface ApiRegionalDemand {
  zone: string;
  medicine_id: number;
  medicine: string;
  is_controlled?: boolean;
  officines_count: number;
  estimated_need: number;
  tension: string;
  pharmacies: ApiRegionalDemandPharmacy[];
}

/* ---- Chaîne d'approvisionnement ---- */

/** GET /distributors?medicine_id= — fournisseurs autorisés (règles §3.3) avec leur stock du médicament. */
export interface ApiSupplier {
  id: number;
  name: string;
  type: 'distributor' | 'pra' | string;
  sector?: Sector | null;
  kind: string;
  city: string | null;
  region: string | null;
  phone: string | null;
  is_partner: boolean;
  available: number | null;
  has_stock: boolean | null;
  stock_status: string | null;
}

/** GET /pharmacy/restock-requests & /hospital/restock-requests — suivi d'une demande envoyée. */
export interface ApiRestockRequest {
  id: number;
  source_alert_id?: number | null;
  medicine_id: number | null;
  medicine: string | null;
  service?: string | null;
  distributor_id: number | null;
  distributor: string;
  quantity: number | null;
  status: 'pending' | 'resolved' | 'rejected' | string;
  delivery_id: number | null;
  delivery_date: string | null;
  rejection_reason: string | null;
  created_at: string | null;
}

/** GET /distributor/requests — demande reçue par un fournisseur. */
export interface ApiIncomingRequest {
  id: number;
  kind: 'pharmacy' | 'hospital';
  structure_id: number | null;
  structure: string | null;
  medicine_id: number | null;
  medicine: string | null;
  available: number | string | null;
  threshold: number | null;
  quantity_requested: number | null;
  service: string | null;
  message: string | null;
  is_controlled?: boolean;
  targeted: boolean;
  status: string;
  delivery_id: number | null;
  delivery_date: string | null;
  rejection_reason: string | null;
  created_at: string | null;
}

/** GET /distributor/destinations?medicine_id= — structure livrable + état de son stock. */
export interface ApiDestination {
  id: number;
  name: string;
  type: StructureType;
  kind?: string;
  city: string | null;
  region: string | null;
  phone: string | null;
  available: number | null;
  status: string | null;
  threshold: number | null;
  suggested_qty: number | null;
}

/** Commande institutionnelle (hôpital → PRA ou PRA → PNA). */
export interface ApiInstitutionalOrder {
  id: number;
  origin_type?: 'hospital_to_pra' | 'pra_to_pna' | string;
  hospital?: string | null;
  hospital_id?: number | null;
  pra?: string | null;
  pra_id?: number | null;
  pra_region?: string | null;
  pna?: string | null;
  medicine: string | null;
  medicine_id?: number | null;
  quantity: number;
  urgency: 'normal' | 'urgent' | 'critical' | string;
  service?: string | null;
  notes?: string | null;
  status: string;
  delivery_id?: number | null;
  delivery_date?: string | null;
  rejection_reason?: string | null;
  ordered_at: string | null;
}
export interface ApiZone {
  name: string;
  ruptures: number;
  tensions?: number;
  level: string;
}
/** Deux niveaux d'urgence hospitaliers (§6.4) : tension (stock critique non nul) / rupture (zéro). */
export type HospitalSeverity = 'tension' | 'rupture';

export interface ApiHospitalAlert {
  id: number;
  medicine_id?: number | null;
  medicine: string | null;
  service: string | null;
  unit?: string | null;
  severity?: HospitalSeverity;
  is_controlled?: boolean;
  level: string;
  remaining: string | null;
  remaining_quantity?: number | null;
  restock_requested_to?: number[];
  status: string;
  created_at: string | null;
}
export interface ApiCriticalMedicine {
  medicine_id: number;
  stock_id?: number | null;
  medicine: string | null;
  available: number;
  threshold?: number;
  status: string;
  severity?: HospitalSeverity | null;
  last_issue?: { quantity: number; service: string | null; unit: string | null; at: string } | null;
}

/** GET /hospital/stock — ligne de stock de la pharmacie hospitalière. */
export interface ApiHospitalStockRow extends ApiStockRow {
  severity: HospitalSeverity | null;
}

/** GET /hospital/dispensations — sortie tracée vers un service / une unité. */
export interface ApiDispensation {
  id: number;
  medicine: string | null;
  medicine_id: number | null;
  quantity: number;
  service: string | null;
  unit: string | null;
  patient_ref: string | null;
  new_quantity: number;
  user: string | null;
  reason: string | null;
  created_at: string | null;
}
export interface ApiDispensationByService { service: string; quantity: number; count: number; units: string[]; }
export interface ApiOverview {
  ruptures: number;
  low: number;
  zones_tracked: number;
  medicines_in_tension: number;
  alerts_today?: number;
  controlled_ruptures?: number;
}
export interface ApiTension {
  medicine_id: number;
  medicine: string | null;
  is_controlled?: boolean;
  pct: number;
  shortage: number;
  ruptures?: number;
  total: number;
  /** Écart (points de %) avec la situation d'il y a 7 jours — reconstitué depuis stock_movements. */
  variation: number;
  /** Score de tension nationale (0–100). */
  score: number;
}

/** GET /public-health/trends */
export interface ApiTrendPoint { date: string; ruptures: number; low: number; alerts?: number; }
export interface ApiTrends {
  current: { ruptures: number; low: number; date: string };
  last_7_days: ApiTrendPoint[];
  last_30_days: ApiTrendPoint[];
  delta_7: { ruptures: number; low: number };
  delta_30: { ruptures: number; low: number };
}

/** GET /public-health/controlled — suivi spécial des médicaments contrôlés. */
export interface ApiControlledMedicine {
  medicine_id: number;
  medicine: string;
  form: string | null;
  dosage: string | null;
  structures: number;
  available_units: number;
  ruptures: number;
  tensions: number;
  hospitals_in_rupture: string[];
  cities: string[];
  issued_30d: number;
  level: string;
}

/* ---- Pharmacie : ordonnances, mouvements, alertes groupées ---- */

/** GET /pharmacy/prescriptions — ordonnance numérique reçue (commande `prescription`). */
export interface ApiPrescription {
  id: number;
  patient: string | null;
  phone: string | null;
  notes: string | null;
  status: string;
  submitted_at: string | null;
  download_url?: string;
}

/** GET /pharmacy/stock/{stock}/movements — ligne de traçabilité. */
export interface ApiStockMovement {
  id: number;
  type: string;
  type_label?: string;
  medicine_id?: number | null;
  quantity: number;
  old_quantity: number;
  new_quantity: number;
  direction: 'entrée' | 'sortie' | string;
  user: string | null;
  reason: string | null;
  created_at: string | null;
  /** Renseigné par le service à partir de l'en-tête de la réponse. */
  medicine?: string | null;
}

/** GET /pharmacy/grouped-alerts — recherche groupée en attente de réponse. */
export interface ApiGroupedAlert {
  response_id: number;
  search_id: number;
  medicine_id: number;
  medicine: string;
  dosage: string | null;
  form: string | null;
  created_at: string | null;
}

/* ---- Patient : recherche groupée ---- */

/** POST /grouped-search — accusé de lancement. */
export interface ApiGroupedSearch {
  search_id: number;
  medicine: string;
  target_count: number;
  check_url?: string;
}
export interface ApiGroupedSearchPharmacy {
  structure_id: number;
  name: string;
  address: string | null;
  phone: string | null;
  quantity?: number | null;
}
/** Équivalent thérapeutique classé (§9) : pertinence + disponibilité réelle. */
export interface ApiGroupedSearchEquivalent {
  id: number;
  name: string | null;
  dosage: string | null;
  form: string | null;
  score?: number;
  reasons?: string[];
  note?: string;
  available_pharmacies?: number;
  nearest_km?: number | null;
}
/** GET /grouped-search/{id}/status */
export interface ApiGroupedSearchStatus {
  search_id: number;
  medicine_id: number;
  status: string;
  target_count: number;
  response_count: number;
  pending_count: number;
  available: ApiGroupedSearchPharmacy[];
  equivalents?: ApiGroupedSearchEquivalent[];
  preventive_alert?: string | null;
}

/* ---- Hôpital : partenaires & tableau de bord ---- */

/** GET /hospital/partners — partenariat (sortant ou entrant). */
export interface ApiPartner {
  id: number;
  partner_id: number | null;
  partner: string | null;
  type: string | null;
  kind?: string | null;
  sector?: Sector | null;
  city: string | null;
  phone: string | null;
  status: 'pending' | 'active' | 'rejected' | string;
  incoming: boolean;
  can_respond: boolean;
  connected_at: string | null;
}
export interface ApiPartnerCandidate { id: number; name: string; type: string; kind?: string; sector?: Sector | null; city?: string | null; code?: string | null; }
export interface ApiHospitalDashboard { [key: string]: number | string | null | undefined; }

/* ---- Distributeur / PNA ---- */

/**
 * GET /distributor/previsions — prévision de rupture à 14 jours par médicament,
 * calculée sur les stocks, seuils, sorties (30 j) et livraisons réelles.
 */
export interface ApiForecast {
  medicine_id: number;
  medicine: string;
  form: string | null;
  dosage: string | null;
  is_controlled: boolean;
  /** Part (%) des structures référençant le médicament qui sont ou seront sous seuil d'ici 14 j. */
  probability: number;
  risk_level: string;
  /** Structures livrables qui référencent le médicament. */
  tracked_count: number;
  /** Structures à risque (rupture + sous seuil + projetées sous seuil). */
  affected_count: number;
  out_of_stock: number;
  low_stock: number;
  /** Au-dessus du seuil aujourd'hui mais passeront dessous d'ici 14 j (selon les sorties). */
  projected_shortages: number;
  /** Sorties cumulées (u./jour) sur les 30 derniers jours. */
  daily_demand: number;
  /** Couverture moyenne (jours) des structures ayant des sorties ; null sans consommation. */
  avg_days_of_cover: number | null;
  /** Unités à livrer pour maintenir toutes les structures au-dessus du seuil pendant 14 j. */
  estimated_need: number;
  /** Délai moyen création → livraison des plans livrés ; null sans historique. */
  avg_delay_days: number | null;
  delay_sample: number;
}

/** GET /pna/dashboard */
export interface ApiPnaDashboard {
  total_pra?: number;
  total_hospitals?: number;
  pending_orders?: number;
  critical_orders?: number;
  deliveries_in_transit?: number;
  deliveries_planned?: number;
  pra_requests_pending?: number;
  pra_load?: { pra: string; pending: number }[];
}

/** GET /distributor/deliveries — livraison brute. */
export interface ApiDelivery {
  id: number | string;
  structure?: string | null;
  destination?: string | null;
  destination_type?: string | null;
  zone?: string | null;
  city?: string | null;
  medicine?: string | null;
  is_controlled?: boolean;
  quantity?: number;
  delivery_date?: string | null;
  status: string;
  slip_number?: string | null;
  received_by_recipient?: boolean;
}

/** GET /deliveries/incoming — approvisionnement entrant (côté destinataire). */
export interface ApiIncomingDelivery {
  id: number;
  supplier: string | null;
  supplier_type: string | null;
  medicine_id: number;
  medicine: string | null;
  is_controlled: boolean;
  quantity: number;
  delivery_date: string | null;
  status: 'planned' | 'in_transit' | 'delivered' | string;
  slip_number: string | null;
  delivered_at: string | null;
  notes: string | null;
}

/** GET /distributor/shortage-reports — ruptures confirmées par alerte groupée patient. */
export interface ApiShortageReport {
  id: number;
  medicine_id: number;
  medicine: string;
  searches: number;
  message: string | null;
  own_available: number | null;
  created_at: string | null;
}

/* ---- Module Vente & Comptabilité (offre Pro) ---- */
export interface ApiSaleItem { medicine_id: number; medicine: string | null; quantity: number; unit_price: number; line_total: number; }
export interface ApiSale {
  id: number;
  receipt_number: string;
  customer_name: string | null;
  prescription_ref: string | null;
  payment_method: string | null;
  payment_label: string;
  vat_rate: number;
  total_ht: number;
  total_vat: number;
  total_ttc: number;
  seller: string | null;
  items: ApiSaleItem[];
  created_at: string;
}
export interface ApiSalesStats {
  today: { revenue: number; count: number };
  week: { revenue: number; count: number };
  month: { revenue: number; count: number };
  daily: { date: string; revenue: number }[];
  top: { medicine_id: number; medicine: string | null; quantity: number; revenue: number }[];
  currency: string;
}
export interface NewSaleLine { stock_id: number; quantity: number; unit_price: number; }

/* ---- Santé publique : rapports & administration ---- */

/** GET /public-health/reports */
export interface ApiReport {
  id: number;
  type: string;
  period: string;
  payload?: { region?: string | null; medicine_id?: number | null } | null;
  status: 'completed' | 'generating' | 'failed' | string;
  file_path: string | null;
  generated_at: string | null;
}

/** GET /admin/users */
export interface ApiAdminUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: BackendRole | string;
  structure_id: number | null;
  structure?: { id: number; name: string; type: string } | null;
}

/** GET /notifications — notification persistée. */
export interface ApiNotification {
  id: number;
  read: boolean;
  payload?: { icon?: string; tone?: string; title?: string; desc?: string; target?: string } | null;
  created_at?: string | null;
}

/** Réponse d'erreur Laravel (validation / métier). */
export interface ApiErrorBody { message?: string; code?: string; errors?: Record<string, string[]>; }
