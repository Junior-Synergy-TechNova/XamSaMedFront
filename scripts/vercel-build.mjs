// Build Vercel : injecte l'adresse de l'API (variable Vercel API_URL) dans
// src/environments/environment.ts le temps du build, puis lance `ng build`.
// Le dépôt garde `http://localhost/api` (Docker de l'équipe) : l'adresse de
// production n'est jamais commitée.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const file = 'src/environments/environment.ts';
const apiUrl = process.env.API_URL?.trim();

if (!apiUrl) {
  if (process.env.VERCEL) {
    console.error('API_URL manquante : définissez-la dans les variables du projet Vercel (ex. https://xamsamed-production.up.railway.app/api).');
    process.exit(1);
  }
} else {
  const source = readFileSync(file, 'utf8');
  const updated = source.replace(/apiUrl:\s*'[^']*'/, `apiUrl: '${apiUrl.replace(/'/g, '')}'`);
  if (updated === source && !source.includes(`apiUrl: '${apiUrl}'`)) {
    console.error(`apiUrl introuvable dans ${file}.`);
    process.exit(1);
  }
  writeFileSync(file, updated);
  console.log(`apiUrl = ${apiUrl}`);
}

execSync('npx ng build', { stdio: 'inherit' });
