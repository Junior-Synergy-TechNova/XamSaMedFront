import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Icon } from '../icon/icon';
import { ModalA11y } from '../../directives/modal-a11y/modal-a11y';
import { FieldLabel } from '../../directives/field-label/field-label';
import { AuthService } from '../../services/auth/auth';
import { PlatformState } from '../../services/platform/platform';
import { ApiErrorBody } from '../../interfaces/api';

/** « Changer le mot de passe » (PUT /me/password) : ouvert depuis le menu du compte ou la page profil. */
@Component({
  selector: 'pf-password-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ModalA11y, FieldLabel],
  templateUrl: './password-modal.html',
  styleUrl: './password-modal.css',
})
export class PasswordModal {
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformState);

  readonly closed = output<void>();

  // Affichage en clair de chaque champ (masqués à chaque ouverture : le composant est recréé).
  readonly showCur = signal(false);
  readonly showNew = signal(false);
  readonly showConf = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  submit(current: string, password: string, confirm: string): void {
    if (this.saving()) return;
    if (!current || !password) { this.error.set('Renseignez les deux mots de passe.'); return; }
    if (password !== confirm) { this.error.set('Les mots de passe ne correspondent pas.'); return; }
    if (password.length < 6) { this.error.set('Le mot de passe doit faire au moins 6 caractères.'); return; }
    this.error.set(null);
    this.saving.set(true);
    this.auth.updatePassword(current, password).subscribe({
      next: () => { this.saving.set(false); this.platform.notify('Mot de passe modifié.'); this.closed.emit(); },
      error: (e: unknown) => {
        this.saving.set(false);
        const body = e instanceof HttpErrorResponse ? (e.error as ApiErrorBody | null) : null;
        this.error.set(e instanceof HttpErrorResponse && e.status === 0
          ? 'Connexion impossible. Réessayez.'
          : body?.message ?? 'Mot de passe actuel incorrect.');
      },
    });
  }
}
