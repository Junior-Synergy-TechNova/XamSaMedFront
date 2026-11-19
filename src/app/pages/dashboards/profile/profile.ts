import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Icon } from '../../../components/icon/icon';
import { Card } from '../../../components/card/card';
import { PageHead } from '../../../components/page-head/page-head';
import { Qr } from '../../../components/qr/qr';
import { PasswordModal } from '../../../components/password-modal/password-modal';
import { VoiceLangPicker } from '../../../components/voice-lang/voice-lang';
import { roleById } from '../../../data/mock-data';
import { RoleId } from '../../../interfaces/models';
import { AuthService } from '../../../services/auth/auth';
import { PlatformState } from '../../../services/platform/platform';

import { ModalA11y } from '../../../directives/modal-a11y/modal-a11y';
import { FieldLabel } from '../../../directives/field-label/field-label';
/* Profil générique (patient / officine) — fiche + QR d'accès + édition */
@Component({
  selector: 'app-simple-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalA11y, FieldLabel, Icon, Card, PageHead, Qr, PasswordModal, VoiceLangPicker],
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

}
