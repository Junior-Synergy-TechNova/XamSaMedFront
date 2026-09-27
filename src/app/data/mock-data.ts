/* ============================================================
   XamSaMed — Configuration d'interface (profils, navigation, site vitrine).
   Toutes les données métier viennent de l'API Laravel.
   Les types/interfaces vivent dans ../interfaces/models.
   ============================================================ */

import { RoleId, Role, NavItem, Feature } from '../interfaces/models';

// Ré-export pour compatibilité : `import { RoleId } from './mock-data'` reste valide.
export type {
  RoleId, StockState, DispoState, ZoneLevel, NotifKind,
  Med, Pharmacy, Dispo, StockItem, Demande, DemandeReg,
  ZoneInfo, Tension, AlerteHop, Role, NavItem, Notif, Feature,
} from '../interfaces/models';

/* ---- Profils (tuiles de connexion + libellés du shell) ---- */
export const ROLES: Role[] = [
  { id: 'patient', label: 'Patient / Accompagnant', icon: 'user', desc: 'Rechercher, localiser et réserver un médicament' },
  { id: 'pharma', label: 'Pharmacien', icon: 'pill', desc: 'Stock, péremptions, ventes, alertes et demandes patients' },
  { id: 'distrib', label: 'Distributeur / PNA / PRA', icon: 'truck', desc: 'Demandes, livraisons avec bordereau, prévisions et zones en tension' },
  { id: 'hopital', label: 'Hôpital / Chef de service', icon: 'hospital', desc: 'Alertes tension / rupture, sorties par service, médicaments critiques' },
  { id: 'sante', label: 'Ministère de la Santé / Admin', icon: 'chart', desc: 'Tableau de bord national, rapports et supervision' },
];

export const roleById = (id: RoleId): Role => ROLES.find(r => r.id === id) ?? ROLES[0];

/* ---- Navigation par rôle ---- */
export const NAV: Record<RoleId, NavItem[]> = {
  patient: [
    { id: 'search', label: 'Rechercher', icon: 'search' },
    { id: 'resa', label: 'Mes réservations', icon: 'cart', badge: 0 },
    { id: 'phar', label: 'Pharmacies', icon: 'pin' },
    { id: 'profil', label: 'Mon profil', icon: 'user' },
  ],
  pharma: [
    { id: 'home', label: 'Tableau de bord', icon: 'grid' },
    { id: 'stock', label: 'Gestion de stock', icon: 'box' },
    { id: 'alert', label: 'Alertes de seuil', icon: 'alert', badge: 2 },
    { id: 'dem', label: 'Demandes ciblées', icon: 'mail', badge: 2 },
    { id: 'ordo', label: 'Ordonnances', icon: 'doc' },
    { id: 'grouped', label: 'Alertes groupées', icon: 'layers' },
    { id: 'ventes', label: 'Ventes & comptabilité', icon: 'cart' },
    { id: 'recep', label: 'Réceptions', icon: 'truck' },
    { id: 'res', label: 'Réseau', icon: 'link' },
    { id: 'history', label: 'Historique', icon: 'clock' },
    { id: 'profil', label: 'Officine', icon: 'pill' },
  ],
  distrib: [
    { id: 'home', label: 'Tableau de bord', icon: 'grid' },
    { id: 'reg', label: 'Demandes régionales', icon: 'layers', badge: 4 },
    { id: 'inst', label: 'Institutionnel', icon: 'hospital', types: ['pna', 'pra'] },
    { id: 'livraisons', label: 'Livraisons', icon: 'truck' },
    { id: 'recep', label: 'Réceptions PNA', icon: 'box', types: ['pra'] },
    { id: 'zones', label: 'Zones critiques', icon: 'pin' },
    { id: 'prev', label: 'Prévisions', icon: 'trend' },
    { id: 'res', label: 'Réseau partenaires', icon: 'link' },
  ],
  hopital: [
    { id: 'home', label: 'Tableau de bord', icon: 'grid' },
    { id: 'alert', label: 'Alertes internes', icon: 'alert', badge: 3 },
    { id: 'stock', label: 'Stock & sorties', icon: 'box' },
    { id: 'recep', label: 'Réceptions', icon: 'truck' },
    { id: 'pra', label: 'Commandes PRA', icon: 'send', sector: 'public' },
    { id: 'history', label: 'Historique', icon: 'clock' },
    { id: 'res', label: 'Réseau partenaires', icon: 'link' },
    { id: 'crit', label: 'Médicaments critiques', icon: 'shield' },
  ],
  sante: [
    { id: 'home', label: 'Vue nationale', icon: 'chart' },
    { id: 'zones', label: 'Zones en tension', icon: 'pin' },
    { id: 'tension', label: 'Médicaments en tension', icon: 'trend' },
    { id: 'ctrl', label: 'Médicaments contrôlés', icon: 'shield' },
    { id: 'catalogue', label: 'Catalogue', icon: 'pill' },
    { id: 'rapport', label: 'Rapports', icon: 'doc' },
    { id: 'users', label: 'Utilisateurs', icon: 'user' },
    { id: 'structures', label: 'Structures', icon: 'hospital' },
  ],
};

/* ---- Fonctionnalités par cible (site vitrine) ---- */
export const FEATURES: Feature[] = [
  {
    role: 'Patients / Accompagnants', icon: 'user', color: 'green', items: [
      ['search', 'Recherche de médicament', 'Trouvez un traitement par nom ou DCI en quelques secondes.'],
      ['list', 'Points de disponibilité', 'Liste claire des officines qui disposent du médicament.'],
      ['pin', 'Pharmacie la plus proche', "Affichage de l'officine la plus proche qui l'a réellement en stock."],
      ['cart', 'Réservation ou commande', 'Réservez votre médicament et retirez-le sans attente.'],
    ],
  },
  {
    role: 'Pharmaciens', icon: 'pill', color: 'blue', items: [
      ['box', 'Tableau de bord de stock', "Suivez vos quantités et seuils en un coup d'œil."],
      ['alert', 'Alerte de seuil critique', 'Soyez prévenu automatiquement avant la rupture.'],
      ['mail', 'Demandes ciblées', 'Recevez des demandes précises — sans partage global de vos stocks.'],
      ['link', 'Orientation officine', "En cas de rupture, orientez le patient vers une autre pharmacie."],
    ],
  },
  {
    role: 'Distributeurs / Grossistes', icon: 'truck', color: 'blue', items: [
      ['grid', 'Demandes régionales', "Pilotez toutes les demandes d'une zone depuis une seule interface."],
      ['bell', 'Alertes automatiques', "Recevez les signaux de tension dès qu'ils émergent."],
      ['pin', 'Zones critiques', 'Visualisez les territoires en rupture sur une carte.'],
      ['trend', 'Prévisions logistiques', 'Anticipez les besoins et planifiez les réapprovisionnements.'],
    ],
  },
  {
    role: 'Hôpitaux & chefs de service', icon: 'hospital', color: 'blue', items: [
      ['alert', "Système d'alerte interne", 'Déclenchez et recevez des alertes au niveau du service.'],
      ['link', 'Connexion pharmacies/distributeurs', 'Reliez votre établissement à un réseau de partenaires.'],
      ['send', 'Signalement rapide', 'Remontez une rupture en quelques secondes.'],
      ['shield', 'Médicaments critiques', 'Suivi renforcé des produits sensibles (ex. morphine).'],
    ],
  },
];
