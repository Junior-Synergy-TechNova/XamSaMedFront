# Livraison front — sprints 4 à 6 (15 novembre 2026)

Tâches front d'Alioune dans la feuille de route PAS, fusionnées dans `develop` le 15 novembre 2026 (PR #8 et #9).
Testé dans le navigateur contre le backend `develop` en local (Docker), sauf les points listés en fin de document.

**Mise à jour du 16 novembre 2026** (PR #11 et #12) : conservation thermique pharmacien branchée sur le backend, mots de passe retirés de l'interface, couleurs de l'historique et des cartes. Voir [Mise à jour du 16 novembre](#mise-à-jour-du-16-novembre).

**En ligne depuis le 16 novembre 2026** : https://xamsamed-wheat.vercel.app (Vercel), branché sur l'API Railway. Voir [En ligne](#en-ligne).

## En bref

| Tâche (sprint) | État | Où le voir |
|---|---|---|
| Interface armoire familiale (S4) | ✅ Fait | Patient → **Armoire familiale** |
| Interface alertes conservation thermique (S4) | ✅ Fait (patient et pharmacien) | Patient → Armoire familiale ; Pharmacien → Stock → **Conservation thermique** |
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
- Branché sur `GET /pharmacy/thermal-status` (backend PR #102, dans `develop`). La météo est rafraîchie au plus toutes les 30 minutes par officine.
- Toutes les règles ont aujourd'hui `source = « à valider »`, en attendant la validation d'un pharmacien : l'écran l'affiche « — » avec le badge « À valider ».
- Pas de ligne « Météo de HH:MM » propre à l'écran : le bouton « Actualiser » du tableau de bord pharmacien relit aussi la météo.

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
| 1 | ~~`GET /pharmacy/thermal-status` n'existe pas~~ | ✅ Fait (PR backend #102, 16 novembre) | — |
| 2 | **Score d'accessibilité pas dans `develop`** (branche `feat/score-accessibilite`) | Résultats de recherche triés par disponibilité puis distance, sans raisons | Myriam : fusionner la branche dans `develop` |
| 3 | **Clé OpenWeatherMap** : nécessaire en local seulement (déjà configurée en ligne) | Sans clé : « Météo indisponible pour le moment » (armoire et pharmacie) | Mettre `OPENWEATHERMAP_API_KEY` dans le `.env` local du backend ; une clé neuve peut mettre jusqu'à 2 h à s'activer |
| 4 | **Position des officines** | Sans latitude / longitude, l'écran pharmacien affiche « Position de l'officine manquante » (422) | Admin : renseigner les coordonnées des structures |
| 5 | **Seuils de conservation à valider** | Badge « À valider » sur tous les seuils (`source = « à valider »`) | Fatou : validation demandée à un pharmacien |
| 6 | **Expiration des réservations** | Déjà gérée en ligne par le planificateur ; en local, une ordonnance peut rester « Prête au retrait » après son délai | En local seulement : lancer `reservations:cancel-expired` |

### Contrat de `GET /pharmacy/thermal-status` (implémenté)

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

## Mise à jour du 16 novembre

### Sécurité (PR #11)
- Page de connexion : le champ mot de passe n'est plus pré-rempli et la liste des comptes de démo n'affiche plus de mot de passe.
- Aucun mot de passe dans la doc ni dans les tests.

### Cartes et lectures (PR #11)
- Vraies cartes Leaflet + OpenStreetMap partout (`components/geo-map/`) : « Carte du réseau » pharmacien et hôpital (`components/network-map/`), « Zones critiques », « Pharmacies à proximité ».
- Une seule lecture partagée entre la cloche et le tableau de bord (`services/shared-read/`).
- Les erreurs de lecture s'affichent (« Réessayer », bandeaux orange) au lieu de listes vides.

### Couleurs (PR #12)
- **Historique pharmacien** : une couleur par type de mouvement.

  | Type | Couleur |
  |---|---|
  | Vente hors plateforme | violet |
  | Vente comptoir avec facture | cyan |
  | Commande patient | bleu nuit |
  | Réapprovisionnement, livraison confirmée, stock initial | vert |
  | Ajustement inventaire | orange |
  | Réservation | bleu ciel |
  | Livraison expédiée, sortie vers service | rose |
  | Périmé, endommagé, tension détectée | rouge |
  | Réservation annulée, référence supprimée | gris |

  Le rouge reste réservé aux pertes et aux alertes.
- **Cartes** : votre structure en bleu vif (plus grosse), fournisseurs en violet, officines en vert / orange / rouge selon le stock (gris ardoise sans médicament choisi), marqueur sélectionné cerclé de noir.

### Prix de référence des médicaments
PR #14 (front) et XamSaMed#103 (back), fusionnées dans `develop` et en ligne le 16 novembre.

- **Base** : nouvelle colonne `medicines.price` (prix public de référence en FCFA). La migration `2026_11_16_100000_add_price_to_medicines_table` donne un prix indicatif aux médicaments de démo ; à corriger depuis le catalogue si on a les prix officiels.
- **Santé publique → Catalogue** : champ obligatoire « Prix de référence (FCFA) * » à l'ajout et à la modification d'une fiche (« 1 500 » ou « 1500,50 » acceptés), nouvelle colonne « Prix de référence » (puce « À renseigner » si vide).
- **Pharmacien → Ventes & comptabilité → Nouvelle vente** :
  - le prix unitaire HT est repris automatiquement du catalogue ; le champ est en lecture seule, à titre indicatif ;
  - le serveur applique toujours le prix du catalogue, quel que soit le prix envoyé ;
  - si la fiche n'a pas de prix, le champ redevient obligatoire pour cette vente (sinon refus `price_required`) ;
  - la TVA s'ajoute au prix HT, le total TTC reste affiché en bas du panier ;
  - après « Ajouter », le formulaire revient à « Choisir un médicament… », quantité 1, pour enchaîner sur un autre médicament ;
  - mise en page « caisse » : saisie, client, paiement, TVA et ordonnance à gauche ; à droite un ticket **Panier** de hauteur fixe (la liste défile à l'intérieur au lieu d'allonger la page), avec −/+ pour la quantité de chaque ligne (borné au disponible), × pour retirer, et les totaux HT / TVA / TTC + « Valider » toujours visibles en bas ; « Chiffre d'affaires » et « Top ventes » passent côte à côte en dessous.

## À vérifier à la main

Non couvert par les tests automatiques ni par le test dans le navigateur :

- **Signaler / confirmer une inondation** : demande l'autorisation de position du navigateur, à tester sur place avec un téléphone.
- **Suggestions DCI** : en tapant une DCI (« lispro »), la liste de Chrome doit proposer « Insuline Humalog ».
- **« Non renseignée au catalogue »** (DCI) : impossible à voir avec les données actuelles, tous les médicaments ont une DCI.
- **Couleurs des réservations, livraisons expédiées et pertes** dans l'historique : absentes des données de démo, pas vues à l'écran.
- **Prix de référence en ligne** : vu dans le navigateur en local (libellés, totaux, panier qui défile), sans valider de vente. À refaire sur le site en ligne : ajout d'une fiche avec prix au catalogue, puis une vente de plusieurs médicaments (prix repris, total TTC, reçu PDF).
- **Tuiles OpenStreetMap** : avant une vraie mise en production, vérifier que leurs conditions d'usage couvrent notre trafic, ou passer par un fournisseur de tuiles.

## En ligne

| Partie | Adresse |
|---|---|
| Site web (Vercel, projet `xamsamed`) | https://xamsamed-wheat.vercel.app |
| API (Railway, branche `develop`) | https://xamsamed-production.up.railway.app/api |

On se connecte avec les mêmes comptes que l'API (mots de passe transmis séparément, jamais dans la doc).

**Mettre à jour le site** : le projet Vercel n'est **pas relié au dépôt GitHub**, une fusion dans `develop` ne redéploie donc rien. Pour publier :

1. Partir de `develop` à jour, sans modifications locales (une copie propre : `git worktree add ../front-deploy origin/develop`).
2. Dans cette copie seulement, mettre `apiUrl: 'https://xamsamed-production.up.railway.app/api'` dans `src/environments/environment.ts`. **Ne jamais le commiter** : le dépôt garde `http://localhost/api` (Docker de l'équipe).
3. `ng build` (Node 24), puis copier `dist/xamsamed/browser/` dans un dossier de déploiement.
4. Y ajouter un `vercel.json` qui renvoie toutes les adresses vers l'application, sinon un lien direct comme `/app?s=ventes` donne une erreur 404 :
   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```
5. Depuis ce dossier : `npx vercel link --project xamsamed`, supprimer le `.env.local` créé par la commande, puis `npx vercel deploy --prod`. Sans `--prod`, on obtient une préversion à part.

Si l'API change d'adresse, refaire ces étapes avec la nouvelle adresse.

## Lancer en local

1. Backend (dépôt `XamSaMed`, branche `develop`) : `docker compose up -d`, puis `docker compose exec app php artisan migrate`.
   - Si le conteneur `xamsamed-app` redémarre en boucle avec une classe introuvable : le volume `vendor_data` est en retard sur `composer.json`. Lancer `docker compose run --rm --no-deps app composer install`.
   - Règles de conservation thermique : `docker compose exec app php artisan db:seed --class='Database\Seeders\MedicineStorageRuleSeeder'`.
   - Météo : `OPENWEATHERMAP_API_KEY` dans le `.env` du backend, puis `docker compose restart app`.
   - Signalements d'inondation de démo : `docker compose exec app php artisan db:seed --class='Database\Seeders\FloodReportSeeder'`.
2. Front (dossier `xamsamed/`, Node 24) : `npm start`, puis http://localhost:4200.
3. Comptes de démo (mot de passe : à demander à Fatou ou Alioune) : `patient@xamsamed.test`, `pharma@xamsamed.test` (offre Pro).

## Tests

`ng test` : 58 tests (Vitest) dans 17 fichiers au 16 novembre (dont le formulaire de vente et le prix exigé au catalogue). Les premiers de ce lot : `patient-cabinet.spec.ts`, `pharma-thermal.spec.ts`, `patient-floods.spec.ts`, `services/pharmacy/pharmacy.spec.ts` et `pages/dashboards/patient/patient.spec.ts` ; puis auth, guards, connexion, shell, tableaux de bord (distributeur, pharmacien, hôpital, santé publique), résultats patient et `shared-read`.

Backend : `PharmacyThermalStatusTest` (6 tests) passe sur `develop` ; `SaleCatalogPriceTest` (2 tests, prix du catalogue imposé à la vente) passe sur la branche `feat/prix-catalogue-medicaments`.
