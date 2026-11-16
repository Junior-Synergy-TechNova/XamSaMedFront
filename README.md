# XamSaMedFront

Frontend web de **XamSaMed** (design NOVAmedacces) : site vitrine public + plateforme à 5 espaces (patient, pharmacie, distributeur / PRA / PNA, hôpital, santé publique), branchée sur l'API Laravel.

Application **Angular 22** (standalone, zoneless, signals) stylée en **Tailwind CSS v4**. Nécessite **Node ≥ 22.22.3 ou ≥ 24.15**.

## Serveur de développement

```bash
npm install
npm start
```

Ouvrir `http://localhost:4200/`. L'URL de l'API est définie dans `src/environments/` (`apiUrl: 'http://localhost/api'`, setup Docker de l'équipe).

## Génération de code

```bash
ng generate component component-name
```

Chaque composant garde ses trois fichiers séparés dans son dossier (`name.ts`, `name.html`, `name.css`).

## Build

```bash
npm run build
```

Les fichiers de production sont générés dans `dist/`.

## En ligne

Site : https://xamsamed-wheat.vercel.app (Vercel), API : https://xamsamed-production.up.railway.app/api (Railway). Déploiement automatique : chaque fusion dans `develop` met le site à jour, chaque PR a sa préversion. L'adresse de l'API vient de la variable Vercel `API_URL` (jamais commitée) — détails dans `docs/livraison-front-sprints-4-6.md`, section « En ligne ».

## Tests unitaires

Les tests tournent avec **Vitest** :

```bash
npm test
```

## Ressources

[Angular CLI Overview and Command Reference](https://angular.dev/tools/cli)
