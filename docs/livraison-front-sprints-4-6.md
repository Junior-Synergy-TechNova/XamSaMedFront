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
- **Alertes vocales** : depuis le 18 novembre, boutons « Écouter » et « Alerte chaleur », comme sur l'app (voir « Mise à jour du 18 novembre »).

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
- **D'où partent les distances** (16 novembre) : les résultats disent si elles sont calculées depuis la position actuelle ou depuis le **domicile enregistré** ; dans ce second cas le bouton « Utiliser ma position actuelle » reste proposé. Sans aucune position, aucune distance n'est affichée (plus de distance calculée depuis un point fixe de Dakar) et la bannière dit « Pharmacie disponible ». Les officines de démo avaient en plus des coordonnées en double (deux pharmacies à « 0 m ») : corrigé côté backend par la migration `2026_11_16_200000_fix_demo_structure_coordinates`.
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

## Mise à jour du 17 novembre

Tout ce qui suit était encore en local et n'apparaissait pas sur le site en ligne : Vercel ne construit que ce qui est poussé sur GitHub.

### Animations
Toutes désactivées si l'utilisateur a demandé « réduire les animations » dans son système (`prefers-reduced-motion`).

- **Site vitrine** : apparition des sections au défilement (directive `directives/reveal/`, classes `.fade-up`, `.fade-left`, `.fade-right`, `.zoom-in` ; la page doit importer `Reveal`), entrée du haut de page en cascade, chiffres clés qui comptent jusqu'à leur valeur, menu qui suit la section affichée, barre de progression de lecture, bouton « retour en haut ».
- **Connexion** : entrée en cascade, fondu au changement de mode, le formulaire « tremble » sur une erreur.
- **Plateforme** :
  - les chiffres des indicateurs comptent jusqu'à leur valeur (depuis l'ancienne valeur après une actualisation) ;
  - les fenêtres s'ouvrent (fond flouté, fenêtre qui monte) et **se ferment** en animation. Toute nouvelle fenêtre doit garder `animate.leave="pf-modal-out"` sur `.pf-modal-overlay` ;
  - fondu du contenu au changement de section, menus, cloche et badges animés ;
  - lignes de tableaux et de listes qui entrent en léger décalé : seules les nouvelles lignes s'animent, d'où l'obligation de garder `track` sur un id ;
  - barres de progression et histogrammes qui se remplissent ;
  - cartes : marqueurs qui apparaissent en décalé quand la liste de points change, halo qui « respire » sur les ruptures et inondations confirmées, anneau autour de « vous êtes ici ».

### Couleurs par catégorie
Une couleur = une catégorie, appliquée partout pareil ; le rouge reste réservé aux alertes et aux pertes.

| Catégorie | Couleur |
|---|---|
| Patient | bleu |
| Officine | turquoise |
| Hôpital | bleu ciel |
| Distributeur privé | violet (comme sur les cartes) |
| PNA / PRA | rose |

- **État d'une réservation ou d'une demande**, même code chez le patient, le pharmacien et dans la cloche : en préparation / en attente = bleu ciel, prête = vert, retirée = turquoise, orientée = violet, refusée / annulée = rose, délai dépassé = gris.
- **Urgence d'une demande** (pharmacien) : critique = rouge, élevée = orange, normale = bleu.
- **Livraisons entrantes** : planifiée = bleu, en transit = turquoise, reçue = vert ; le fournisseur prend sa couleur de catégorie.
- **Cloche** : chaque notification prend la couleur de son type d'événement (`notifTone` dans `services/notifications/`), puisque le backend n'envoie que `ok` / `alert` / `info`. Les réservations déjà retirées n'y apparaissent plus.
- **Partenaires** et **profils** : couleur de la catégorie de la structure.

### Distances dans la recherche patient
- La page dit d'où partent les distances. Si c'est le **domicile enregistré**, elle propose « Utiliser ma position actuelle ».
- Sans aucune position, plus aucune distance n'est affichée : elle aurait été calculée depuis un point fixe de Dakar.
- Backend (#105, en ligne) : chaque structure de démo a des coordonnées réelles. Avant, la Pharmacie Centrale et la Pharmacie de l'Indépendance étaient sur le même point, d'où les « 0 m ».

## Mise à jour du 18 novembre

### Assistant IA (patient)

Fichiers : `pages/dashboards/patient-assistant/`, `services/assistant/`. Entrée « Assistant » dans le menu patient (`/app?s=assistant`).

- **Question écrite** : Entrée envoie (500 caractères au plus), suggestions de départ, fil de conversation.
- **Question dictée** :
  - une jauge montre le niveau du micro pendant que le patient parle, calculée dans le navigateur ;
  - au bouton « Terminer », le texte compris arrive dans la zone de saisie : le patient le relit, le corrige ou réenregistre, puis l'envoie.
- **Urgence** (`urgence: true`) : réponse en rouge avec les boutons d'appel SAMU 1515 et pompiers 18.
- **Erreurs** : elles restent dans le fil.
  - IA indisponible, trop de questions ou réseau coupé : bouton « Réessayer », qui renvoie la même question.
  - IA non configurée sur le serveur : message qui renvoie vers la recherche, sans nouvel essai.
- **Position** : celle du navigateur si le patient l'a partagée (bouton « Utiliser ma position »), sinon le serveur prend son domicile enregistré.
- **Conversation** :
  - « Nouvelle conversation » efface aussi la conversation côté serveur ;
  - le fil survit à un changement de section, pas à un rechargement ;
  - un autre compte connecté repart d'un fil vide.
- **Endpoints** : `POST /ai/chat` (avec `client: "web"`), `POST /ai/transcribe`, `DELETE /ai/chat/{session_id}`.
- **Backend** (PR #114, `feat/assistant-web`) : `client: "web"` fait citer à l'assistant les écrans du site au lieu de ceux de l'app. `POST /ai/transcribe` renvoie le texte seul.
- **Avant la fusion de #114** : le site marche aussi.
  - Sans `/ai/transcribe` (404), la dictée repasse par `POST /ai/voice`, qui transcrit et répond d'un coup.
  - Sans `client`, l'assistant cite les écrans de l'app.

### Alertes vocales de l'armoire familiale

Fichiers : `services/voice-alerts/`, `public/audio/`.

- **Sur chaque médicament** :
  - « Écouter » pour la péremption (à 30 jours ou moins) : `GET /cabinet/{id}/voice-alert` ;
  - « Alerte chaleur » quand le médicament est exposé : `GET /cabinet/{id}/voice-alert/thermal`.
- **Lecture** : le serveur ne renvoie que des identifiants de segments. Le site joue les fichiers l'un après l'autre.
- **Sous-titres** : sous la ligne, la phrase en cours est en gras. Le nom exact du médicament est toujours écrit, car « insuline » couvre plusieurs insulines.
- **Repli** : mêmes règles que l'app (`docs/mobile.md` § 14 côté backend).
  - Nom du médicament ou durée absent dans la langue : ce segment en français.
  - Autre phrase absente : tout le message en français.
  - Absent aussi en français : le texte seul, sans audio.
- **Langue** : sélecteur « Alertes vocales » en haut de la page (Français, Wolof, Pulaar, Sérère).
  - Il enregistre la langue avec `PATCH /profile/location { preferred_language }`.
  - La langue vaut aussi pour l'app mobile.
- **Fichiers audio** : `public/audio/` est une copie du dossier `assets/audio/` du dépôt `XamSaMed-app-mobile`, branche `develop`, au 18 novembre.
  - Contenu : 6,4 Mo, 133 enregistrements en français, wolof et pulaar, plus `manifest.json`.
  - **Quand l'équipe ajoute des enregistrements, recopier ce dossier.**

## À vérifier à la main

Non couvert par les tests automatiques ni par le test dans le navigateur :

- **Signaler / confirmer une inondation** : demande l'autorisation de position du navigateur, à tester sur place avec un téléphone.
- **Suggestions DCI** : en tapant une DCI (« lispro »), la liste de Chrome doit proposer « Insuline Humalog ».
- **« Non renseignée au catalogue »** (DCI) : impossible à voir avec les données actuelles, tous les médicaments ont une DCI.
- **Couleurs des réservations, livraisons expédiées et pertes** dans l'historique : absentes des données de démo, pas vues à l'écran.
- **Prix de référence en ligne** : vu dans le navigateur en local (libellés, totaux, panier qui défile), sans valider de vente. À refaire sur le site en ligne : ajout d'une fiche avec prix au catalogue, puis une vente de plusieurs médicaments (prix repris, total TTC, reçu PDF).
- **Animations** : sur le site en ligne, vérifier la page d'accueil (défilement), l'ouverture / fermeture d'une fenêtre et un téléphone avec « réduire les animations » activé (tout doit être immobile).
- **Dictée dans l'assistant** : vérifiée par les tests seulement. À essayer avec un vrai micro, sur ordinateur et sur téléphone (autorisation du micro, jauge, texte compris, envoi).
- **Alertes vocales en wolof et en pulaar** : seul le français a été écouté. Choisir la langue, puis vérifier les replis en français (par exemple le paracétamol en wolof).
- **Tuiles OpenStreetMap** : avant une vraie mise en production, vérifier que leurs conditions d'usage couvrent notre trafic, ou passer par un fournisseur de tuiles.

## En ligne

| Partie | Adresse |
|---|---|
| Site web (Vercel, projet `xamsamed`) | https://xamsamed-wheat.vercel.app |
| API (Railway, branche **`main`** du backend) | https://xamsamed-production.up.railway.app/api |

On se connecte avec les mêmes comptes que l'API (mots de passe transmis séparément, jamais dans la doc).

**Backend** : Railway déploie la branche **`main`** du dépôt `XamSaMed`, pas `develop`. Une fonctionnalité fusionnée dans `develop` n'est en ligne qu'après une PR « develop → main » (ex. #106). Railway **ne lance pas les migrations** : après chaque mise en ligne qui en ajoute, le propriétaire du projet Railway lance `php artisan migrate --force` dans le shell du service. Fait pour le prix des médicaments et les coordonnées des structures (vérifié sur l'API en ligne le 17 novembre).

**Mise à jour automatique** : le projet Vercel `xamsamed` est relié au dépôt GitHub.

- Chaque fusion dans **`develop`** redéploie le site principal en quelques minutes.
- Chaque autre branche et chaque PR reçoit sa **préversion** (lien posté par Vercel sur la PR).
- Le build Vercel lance `node scripts/vercel-build.mjs` (voir `vercel.json`) : il met l'adresse de l'API, lue dans la variable Vercel **`API_URL`**, dans `src/environments/environment.ts` **le temps du build seulement**, puis lance `ng build`. Le dépôt garde `http://localhost/api` ; ne jamais y commiter l'adresse de production.
- Sans `API_URL`, le build Vercel s'arrête au lieu de publier un site branché sur `localhost`.
- `vercel.json` renvoie toutes les adresses vers l'application, pour que les liens directs (`/app?s=ventes`) marchent.

Si l'API change d'adresse : modifier `API_URL` dans les réglages du projet Vercel (Settings → Environment Variables), puis redéployer.

## Lancer en local

1. Backend (dépôt `XamSaMed`, branche `develop`) : `docker compose up -d`, puis `docker compose exec app php artisan migrate`.
   - Si le conteneur `xamsamed-app` redémarre en boucle avec une classe introuvable : le volume `vendor_data` est en retard sur `composer.json`. Lancer `docker compose run --rm --no-deps app composer install`.
   - Règles de conservation thermique : `docker compose exec app php artisan db:seed --class='Database\Seeders\MedicineStorageRuleSeeder'`.
   - Météo : `OPENWEATHERMAP_API_KEY` dans le `.env` du backend, puis `docker compose restart app`.
   - Signalements d'inondation de démo : `docker compose exec app php artisan db:seed --class='Database\Seeders\FloodReportSeeder'`.
2. Front (dossier `xamsamed/`, Node 24) : `npm start`, puis http://localhost:4200.
3. Comptes de démo (mot de passe : à demander à Fatou ou Alioune) : `patient@xamsamed.test`, `pharma@xamsamed.test` (offre Pro).

## Tests

`ng test` : 73 tests (Vitest) dans 19 fichiers au 18 novembre, dont `patient-assistant.spec.ts` (6 : envoi, urgence, réessai, dictée relue, repli sur `/ai/voice`, changement de compte) et `services/voice-alerts/voice-alerts.spec.ts` (4 : règles de repli de l'audio). Au 16 novembre : 61 tests dans 17 fichiers (dont le formulaire de vente, le prix exigé au catalogue et l'origine des distances dans les résultats patient). Les premiers de ce lot : `patient-cabinet.spec.ts`, `pharma-thermal.spec.ts`, `patient-floods.spec.ts`, `services/pharmacy/pharmacy.spec.ts` et `pages/dashboards/patient/patient.spec.ts` ; puis auth, guards, connexion, shell, tableaux de bord (distributeur, pharmacien, hôpital, santé publique), résultats patient et `shared-read`.

Backend : `PharmacyThermalStatusTest` (6 tests) passe sur `develop` ; `SaleCatalogPriceTest` (2 tests, prix du catalogue imposé à la vente) passe sur la branche `feat/prix-catalogue-medicaments`.
