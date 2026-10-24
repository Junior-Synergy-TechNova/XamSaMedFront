import { Injectable, signal } from '@angular/core';
import { RoleId, NotifKind } from '../../interfaces/models';

export interface Toast { id: number; msg: string; kind: NotifKind; }

/** Déclenche le téléchargement d'un fichier reçu de l'API (PDF, CSV…). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const STORAGE_KEY = 'nova-role';
/** Section active de la sidebar, mémorisée par rôle pour survivre au rechargement. */
const SECTION_KEY = 'nova-section';

/* ============================================================
   XamSaMed — État plateforme (rôle courant) + bus de toasts
   ============================================================ */
@Injectable({ providedIn: 'root' })
export class PlatformState {
  readonly role = signal<RoleId | null>(this.restore());
  readonly toasts = signal<Toast[]>([]);
  /** Nombre d'éléments à traiter par entrée de navigation, publié par l'espace actif (mêmes chiffres que ses pages).
      Absent → la sidebar retombe sur le nombre de notifications non lues. */
  readonly navCounts = signal<Record<string, number> | null>(null);
  private readonly toastTimers = new Map<number, { handle: ReturnType<typeof setTimeout> | undefined; remaining: number; startedAt: number }>();

  setRole(role: RoleId): void {
    this.role.set(role);
    try { localStorage.setItem(STORAGE_KEY, role); } catch { /* ignore */ }
  }

  clearRole(): void {
    this.role.set(null);
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(SECTION_KEY); } catch { /* ignore */ }
  }

  /** Mémorise la section courante du rôle (clé `role:section`). */
  saveSection(role: RoleId, section: string): void {
    try { localStorage.setItem(SECTION_KEY, `${role}:${section}`); } catch { /* ignore */ }
  }

  /** Section mémorisée pour ce rôle, ou null si absente / d'un autre rôle. */
  restoreSection(role: RoleId): string | null {
    try {
      const v = localStorage.getItem(SECTION_KEY);
      if (!v) return null;
      const [r, section] = v.split(':');
      return r === role && section ? section : null;
    } catch {
      return null;
    }
  }

  /** Affiche un toast. Une erreur reste 9 s (le temps de la lire), le reste 4,5 s ;
      le compte à rebours est suspendu tant que la souris ou le focus est dessus. */
  notify(msg: string, kind: NotifKind = 'ok'): void {
    const toast: Toast = { id: Date.now() + Math.random(), msg, kind };
    this.toasts.update(list => [...list, toast]);
    this.toastTimers.set(toast.id, { handle: undefined, remaining: kind === 'alert' ? 9000 : 4500, startedAt: 0 });
    this.resumeToast(toast.id);
  }

  dismissToast(id: number): void {
    const timer = this.toastTimers.get(id);
    if (timer) clearTimeout(timer.handle);
    this.toastTimers.delete(id);
    this.toasts.update(list => list.filter(t => t.id !== id));
  }

  pauseToast(id: number): void {
    const timer = this.toastTimers.get(id);
    if (!timer || timer.handle === undefined) return;
    clearTimeout(timer.handle);
    timer.handle = undefined;
    timer.remaining -= Date.now() - timer.startedAt;
  }

  resumeToast(id: number): void {
    const timer = this.toastTimers.get(id);
    if (!timer || timer.handle !== undefined) return;
    timer.startedAt = Date.now();
    timer.handle = setTimeout(() => this.dismissToast(id), Math.max(timer.remaining, 1500));
  }

  private restore(): RoleId | null {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v as RoleId | null;
    } catch {
      return null;
    }
  }
}
