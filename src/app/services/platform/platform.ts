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

  /** Affiche un toast (auto-disparition après 3,4 s). */
  notify(msg: string, kind: NotifKind = 'ok'): void {
    const toast: Toast = { id: Date.now() + Math.random(), msg, kind };
    this.toasts.update(list => [...list, toast]);
    setTimeout(() => this.toasts.update(list => list.filter(t => t.id !== toast.id)), 3400);
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
