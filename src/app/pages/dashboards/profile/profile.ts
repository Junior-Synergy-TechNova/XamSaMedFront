import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Qr } from '../../../components/qr/qr';
import { roleById } from '../../../data/mock-data';
import { RoleId } from '../../../interfaces/models';
import { AuthService } from '../../../services/auth/auth';
import { PlatformState } from '../../../services/platform/platform';

/* Profil générique (patient / officine) — fiche + QR d'accès + édition */
@Component({
  selector: 'app-simple-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Card, PageHead, Qr],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class SimpleProfile {
  readonly role = input.required<RoleId>();
  readonly title = input('');
  readonly name = input('');
  readonly sub = input('');
  readonly fields = input<readonly [string, string][]>([]);
  readonly roleIcon = computed(() => roleById(this.role()).icon);

  protected readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformState);

  readonly editModal = signal(false);
  readonly pwdModal = signal(false);
  // Affichage en clair de chaque champ du formulaire mot de passe.
  readonly showCur = signal(false);
  readonly showNew = signal(false);
  readonly showConf = signal(false);

  // À chaque ouverture, les champs repartent masqués.
  openPwdModal(): void {
    this.showCur.set(false); this.showNew.set(false); this.showConf.set(false);
    this.pwdModal.set(true);
  }

  submitProfile(name: string, phone: string, email: string): void {
    const payload: { name?: string; phone?: string; email?: string } = {};
    if (name.trim()) payload.name = name.trim();
    if (phone.trim()) payload.phone = phone.trim();
    if (email.trim()) payload.email = email.trim();
    this.auth.updateProfile(payload).subscribe({
      next: () => { this.platform.notify('Profil mis à jour', 'ok'); this.editModal.set(false); },
      error: () => this.platform.notify('Échec de la mise à jour (email déjà utilisé ?)', 'alert'),
    });
  }

  submitPassword(current: string, password: string, confirm: string): void {
    if (!current || !password) { this.platform.notify('Renseignez les deux mots de passe', 'alert'); return; }
    if (password !== confirm) { this.platform.notify('Les mots de passe ne correspondent pas', 'alert'); return; }
    if (password.length < 6) { this.platform.notify('Le mot de passe doit faire au moins 6 caractères', 'alert'); return; }
    this.auth.updatePassword(current, password).subscribe({
      next: () => { this.platform.notify('Mot de passe modifié', 'ok'); this.pwdModal.set(false); },
      error: () => this.platform.notify('Mot de passe actuel incorrect', 'alert'),
    });
  }
}
