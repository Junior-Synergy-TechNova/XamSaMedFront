# Livraison front — sprints 4 à 6 (15 novembre 2026)

Tâches front d'Alioune dans la feuille de route PAS, fusionnées dans `develop` le 15 novembre 2026 (PR #8 et #9).
Testé dans le navigateur contre le backend `develop` en local (Docker), sauf les points listés en fin de document.

## En bref

| Tâche (sprint) | État | Où le voir |
|---|---|---|
| Interface armoire familiale (S4) | ✅ Fait | Patient → **Armoire familiale** |
| Interface alertes conservation thermique (S4) | ✅ Patient · ⏳ Pharmacien (attend le back) | Patient → Armoire familiale ; Pharmacien → Stock → **Conservation thermique** |
| Carte zones inondées + score accessibilité (S5) | ✅ Carte · ⏳ Score (attend le back) | Patient → **Routes inondées** ; Patient → Rechercher → résultats |
| Module vente interface pharmacien (S5) | ✅ Fait (existait, complété) | Pharmacien → Comptoir → **Ventes & comptabilité** |
| Interface gestion ordonnances (S6) | ✅ Fait (existait, complété) | Pharmacien → Comptoir → **Ordonnances** ; Patient → Rechercher |
| DCI dans « Ajouter une référence » | ✅ Fait | Pharmacien → Stock → Gestion de stock → Ajouter une référence |

⏳ = l'écran est prêt mais le backend ne fournit pas encore les données : voir [Ce qui manque côté backend](#ce-qui-manque-côté-backend).

## Ce qui a été fait

### Armoire familiale (patient)

Fichiers : `pages/dashboards/patient-cabinet/`, `services/cabinet/`.

- Médicaments gardés à la maison, pour soi ou pour un proche : ajouter, modifier, marquer « ouvert aujourd'hui », retirer.
- Péremption en couleur avec les seuils du domicile : orange à moins de 30 jours, rouge à moins de 7 jours ou périmé.
- Filtres par personne (Moi, chaque proche) et par état (bientôt périmés, périmés, chaleur).
- Gestion des proches (ajout, modification, retrait refusé tant qu'il leur reste des médicaments).
- **Alertes thermiques** : bandeau en haut de page.
  - Domicile pas encore localisé : bouton « Localiser mon domicile » (position du navigateur, ou choix d'une ville si la position est refusée).
  - Trop chaud : bandeau rouge avec les médicaments exposés et la conduite à tenir.
  - Rien d'exposé : bandeau vert avec la température.
  - Météo indisponible : bandeau orange.
- Endpoints : `GET/POST/PUT/DELETE /cabinet`, `POST /cabinet/{id}/open`, `/cabinet/members`, `GET /cabinet/thermal-status`, `PATCH /profile/location`.
- Les notifications `thermal_alert` du backend ouvrent directement cette page.
- **Pas de bouton « Écouter » sur le web** : `/cabinet/{id}/voice-alert` ne renvoie que des identifiants de segments audio, joués par l'application mobile qui embarque les fichiers (`docs/mobile.md` côté backend).

### Conservation thermique (pharmacien)

Fichiers : `pages/dashboards/pharma-thermal/`, `PharmacyService.thermalStatus()`.

- Température de la zone de l'officine comparée au maximum supporté par chaque médicament en stock.
- Bandeau (trop chaud / conforme / météo indisponible), indicateurs, tableau trié par urgence (écart, « proche du seuil » à moins de 2 °C, source du seuil, badge « À valider »), section chaîne du froid (2–8 °C) avec les consignes en cas de coupure.
- **L'endpoint n'existe pas encore** : l'écran affiche « Surveillance pas encore disponible » (voir plus bas).

### Routes inondées + score d'accessibilité (patient)

Fichiers : `pages/dashboards/patient-floods/`, `components/flood-map/`, `services/floods/`, `services/geo/`, `pages/dashboards/patient-results/`.

- **Carte** (Leaflet + fond OpenStreetMap) : signalements colorés par gravité, pointillés tant qu'ils ne sont pas confirmés, zone de 500 m autour des inondations confirmées, pharmacies (en gris si une inondation confirmée gêne leur accès), position du patient.
- Recherche autour de la position du patient (ou de Dakar Plateau), rayon de 2, 5 ou 10 km.
- **Signaler** : c'est la position actuelle du téléphone qui est envoyée ; si un signalement existe déjà à moins de 200 m, le patient est prévenu qu'il l'a confirmé.
- **Je confirme** : la position est relue à l'instant (le backend exige d'être à moins de 200 m). Les refus du backend (trop loin, déjà confirmé, trop de signalements dans l'heure) s'affichent tels quels.
- Liste des pharmacies dont l'accès est gêné.
- **Score d'accessibilité** dans les résultats de recherche : pharmacies classées par accessibilité, bannière « Pharmacie la plus accessible », raisons du classement en pastilles (« Stock mis à jour il y a 2 h », « À 0,8 km », « Inondation signalée à proximité » en orange). Le score chiffré n'est jamais affiché, comme le demande la doc du backend.
- Endpoints : `GET/POST /flood-reports`, `POST /flood-reports/{id}/confirm`, `GET /pharmacies`, `GET /medicines/{id}/availability?sort=score&qty=1[&lat&lng]`.
- Nouvelle dépendance : **leaflet 1.9.4**, chargée seulement sur la page des inondations (fichier à part, environ 37 kB compressés).

### Module vente (pharmacien)

Le module existait déjà (offre Pro). Ajouts :

- Période du journal choisie (« Du » / « Au », raccourcis Aujourd'hui, Ce mois-ci, Mois dernier) ; l'export CSV porte sur la période affichée.
- Pagination : 50 ventes à la fois, bouton « Afficher les ventes plus anciennes ».
- Mode de paiement « Autre ».
- Erreurs de lecture : écran « Réessayer » pour le journal, bandeau orange pour les indicateurs (au lieu d'afficher « Aucune vente »).

### Gestion des ordonnances

L'interface existait déjà (ordonnances avec plusieurs médicaments, chacun réservé, orienté ou remplacé par un équivalent). Ajouts :

- **Pharmacien** : encadré « même photo déjà envoyée N fois » (`photo_deja_envoyee`) avec le rappel de vérifier l'original au retrait ; filtres par état avec compteurs (Toutes, À traiter, Prêtes au retrait, Terminées) ; pagination (50 par page, le front ne lisait que les 20 premières).
- **Patient** : réserver un médicament sur ordonnance ouvre l'envoi d'ordonnance, pharmacie déjà choisie (au lieu de « Échec de la réservation ») ; les autres refus affichent le motif du backend ; l'envoi vérifie les 5 Mo et affiche le message du backend (« Présentez l'ordonnance originale au retrait »).

### DCI dans « Ajouter une référence » (pharmacien)

- Champ « DCI (catalogue national) » en lecture seule à côté du médicament, rempli dès que le médicament est reconnu (libellé exact ou nom unique ; jamais deviné pour un nom ambigu).
- Les suggestions de la liste affichent la DCI de chaque médicament.

## Ce qui manque côté backend

Ces points bloquent ou limitent des écrans déjà prêts. Le front n'a rien à changer une fois qu'ils sont faits, sauf mention contraire.

| # | Manque | Effet aujourd'hui | Qui / quoi faire |
|---|---|---|---|
| 1 | **`GET /pharmacy/thermal-status` n'existe pas** | Pharmacien → Conservation thermique affiche « Surveillance pas encore disponible » (404) | Fatou : implémenter l'endpoint selon le contrat ci-dessous |
| 2 | **Score d'accessibilité pas dans `develop`** (branche `feat/score-accessibilite`) | Résultats de recherche triés par disponibilité puis distance, sans raisons | Myriam : fusionner la branche dans `develop` |
| 3 | **Clé OpenWeatherMap** absente en local | Armoire et pharmacie : « Météo indisponible pour le moment » | Renseigner `services.openweathermap.api_key` dans le `.env` du backend |
| 4 | **Position des officines** | Sans latitude / longitude, l'écran pharmacien affichera « Position de l'officine manquante » (422) une fois l'endpoint fait | Admin : renseigner les coordonnées des structures |
| 5 | **Seuils de conservation à valider** | Badge « À valider » sur les seuils non validés par un pharmacien | Équipe : faire valider `medicine_storage_rules` |
| 6 | **Expiration des réservations** non planifiée en local | Une ordonnance peut rester « Prête au retrait » après son délai | Lancer le planificateur Laravel (`reservations:cancel-expired`) |

### Contrat attendu pour `GET /pharmacy/thermal-status`

Rôle `pharmacy_user`. Type côté front : `ApiPharmacyThermalStatus` dans `src/app/interfaces/api.ts`.

```json
{
  "current_temp_c": 34.2,
  "checked_at": "2026-11-15T14:00:00Z",
  "location": { "lat": 14.69, "lng": -17.44 },
  "items_at_risk": 2,
  "data": [{
    "stock_id": 12, "medicine_id": 3, "medicine": "Amoxicilline",
    "dosage": "500 mg", "form": "gélule", "quantity": 40,
    "storage": "room", "max_temp_c": 25, "min_temp_c": null,
    "at_risk": true, "source": "notice", "validated": false
  }]
}
```

- `current_temp_c` : `ThermalChecker::getCurrentTemp()` à la position de la structure ; `null` si la météo ne répond pas.
- `data` : une ligne par médicament en stock (quantité disponible > 0) qui a une règle dans `medicine_storage_rules`.
- `storage` : `"fridge"` si `requires_fridge`, sinon `"room"`.
- `at_risk` : `current_temp_c > max_temp_c`, seulement pour `"room"` ; toujours `false` pour `"fridge"`.
- `validated` : `validated_by` renseigné.
- 422 `{ "message": "..." }` si la structure n'a pas de coordonnées.

## À vérifier à la main

Non couvert par les tests automatiques ni par le test dans le navigateur :

- **Signaler / confirmer une inondation** : demande l'autorisation de position du navigateur, à tester sur place avec un téléphone.
- **Suggestions DCI** : en tapant une DCI (« lispro »), la liste de Chrome doit proposer « Insuline Humalog ».
- **« Non renseignée au catalogue »** (DCI) : impossible à voir avec les données actuelles, tous les médicaments ont une DCI.
- **Tuiles OpenStreetMap** : avant une vraie mise en production, vérifier que leurs conditions d'usage couvrent notre trafic, ou passer par un fournisseur de tuiles.

## Lancer en local

1. Backend (dépôt `XamSaMed`, branche `develop`) : `docker compose up -d`, puis `docker compose exec app php artisan migrate`.
   - Si le conteneur `xamsamed-app` redémarre en boucle avec une classe introuvable : le volume `vendor_data` est en retard sur `composer.json`. Lancer `docker compose run --rm --no-deps app composer install`.
   - Signalements d'inondation de démo : `docker compose exec app php artisan db:seed --class='Database\Seeders\FloodReportSeeder'`.
2. Front (dossier `xamsamed/`, Node 24) : `npm start`, puis http://localhost:4200.
3. Comptes de démo (mot de passe : à demander à Fatou ou Alioune) : `patient@xamsamed.test`, `pharma@xamsamed.test` (offre Pro).

## Tests

`ng test` : 13 tests (Vitest), dont les nouveaux `patient-cabinet.spec.ts`, `pharma-thermal.spec.ts`, `patient-floods.spec.ts`, `services/pharmacy/pharmacy.spec.ts` et `pages/dashboards/patient/patient.spec.ts`.
