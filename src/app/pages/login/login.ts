import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Icon } from '../../components/icon/icon';
import { Logo } from '../../components/logo/logo';
import { AuthService } from '../../services/auth/auth';
import { ROLES, roleById } from '../../data/mock-data';
import { RoleId } from '../../interfaces/models';
import { OtpChannel } from '../../interfaces/api';



/* ---------------- Login / authentification (Sanctum) ---------------- */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Logo],
  templateUrl: './login.html',
  styleUrl: './login.css',
})


export class LoginScreen {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly roles = ROLES;
  readonly points: readonly [string, string][] = [
    ['shield', 'Données de santé chiffrées'],
    ['refresh', 'Disponibilité en temps réel'],
    ['qr', 'Accès rapide par QR code'],
  ];

  // Emails de démonstration par profil (le rôle réel vient du backend).
  private readonly demoEmail: Record<RoleId, string> = {
    patient: 'patient@xamsamed.test',
    pharma: 'pharma@xamsamed.test',
    distrib: 'distrib@xamsamed.test',
    hopital: 'hopital@xamsamed.test',
    sante: 'admin@xamsamed.test',
  };

  readonly role = signal<RoleId>('pharma');
  readonly email = signal<string>(this.demoEmail['pharma']);
  readonly password = signal<string>('password123');
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  // Affichage en clair du mot de passe (évite les fautes de frappe à l'aveugle).
  readonly showPwd = signal(false);
  readonly showNewPwd = signal(false);

  // Flux « mot de passe oublié » et connexion par code à usage unique (OTP)
  readonly mode = signal<'login' | 'forgot' | 'reset' | 'otp' | 'otp-code'>('login');
  readonly otpChannel = signal<OtpChannel>('email');
  readonly otpIdentifier = signal('');
  readonly otpCode = signal('');
  /** Canaux activés côté serveur (SMS / WhatsApp dépendent de la configuration Twilio). */
  readonly otpChannels = signal<Record<OtpChannel, boolean>>({ email: true, sms: false, whatsapp: false });
  readonly info = signal<string | null>(null);
  readonly resetCode = signal('');
  readonly newPassword = signal('');

  readonly current = computed(() => roleById(this.role()));

  pick(id: RoleId): void {
    this.role.set(id);
    this.email.set(this.demoEmail[id]);
    this.error.set(null);
  }
  setEmail(e: Event): void { this.email.set((e.target as HTMLInputElement).value); }
  setPassword(e: Event): void { this.password.set((e.target as HTMLInputElement).value); }

  login(): void {
    if (this.loading()) return;
    const email = this.email().trim();
    if (!email || !this.password()) {
      this.error.set('Renseignez votre identifiant et votre mot de passe.');
      return;
    }
    this.error.set(null);
    this.loading.set(true);
    this.auth.login(email, this.password()).subscribe({
      next: () => { this.loading.set(false); this.router.navigateByUrl('/app'); },
      error: (err: HttpErrorResponse) => { this.loading.set(false); this.error.set(this.errorMessage(err)); },
    });
  }

  back(): void { this.router.navigateByUrl('/'); }
  firstWord(s: string): string { return s.split(' ')[0]; }

  // --- Mot de passe oublié ---
  setResetCode(e: Event): void { this.resetCode.set((e.target as HTMLInputElement).value); }
  setNewPassword(e: Event): void { this.newPassword.set((e.target as HTMLInputElement).value); }
  gotoForgot(): void { this.mode.set('forgot'); this.error.set(null); this.info.set(null); this.hidePwd(); }
  gotoLogin(): void { this.mode.set('login'); this.error.set(null); this.info.set(null); this.hidePwd(); }
  gotoOtp(): void {
    this.mode.set('otp'); this.error.set(null); this.info.set(null);
    if (!this.otpIdentifier()) this.otpIdentifier.set(this.email());
  }

  // --- Connexion par code à usage unique (email / SMS / WhatsApp) ---
  setOtpIdentifier(e: Event): void { this.otpIdentifier.set((e.target as HTMLInputElement).value); }
  setOtpCode(e: Event): void { this.otpCode.set((e.target as HTMLInputElement).value); }
  setOtpChannel(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.otpChannel.set(v === 'sms' || v === 'whatsapp' ? v : 'email');
  }

  requestOtp(): void {
    if (this.loading()) return;
    const identifier = this.otpIdentifier().trim();
    if (!identifier) { this.error.set('Renseignez votre email ou votre numéro de téléphone.'); return; }
    this.error.set(null); this.info.set(null); this.loading.set(true);
    this.auth.requestOtp(identifier, this.otpChannel()).subscribe({
      next: res => {
        this.loading.set(false);
        this.otpChannels.set(res.channels);
        this.mode.set('otp-code');
        this.info.set(res.debug_code ? `Code de démonstration : ${res.debug_code}` : res.message);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        const channels = (err.error as { channels?: Record<OtpChannel, boolean> } | null)?.channels;
        if (channels) this.otpChannels.set(channels);
        this.error.set(this.errorMessage(err));
      },
    });
  }

  verifyOtp(): void {
    if (this.loading()) return;
    const code = this.otpCode().trim();
    if (!/^\d{6}$/.test(code)) { this.error.set('Le code comporte 6 chiffres.'); return; }
    this.error.set(null); this.loading.set(true);
    this.auth.verifyOtp(this.otpIdentifier().trim(), code).subscribe({
      next: () => { this.loading.set(false); this.otpCode.set(''); this.router.navigateByUrl('/app'); },
      error: (err: HttpErrorResponse) => { this.loading.set(false); this.error.set(this.errorMessage(err)); },
    });
  }
  private hidePwd(): void { this.showPwd.set(false); this.showNewPwd.set(false); }

  requestReset(): void {
    if (this.loading()) return;
    const email = this.email().trim();
    if (!email) { this.error.set('Renseignez votre email.'); return; }
    this.error.set(null); this.info.set(null); this.loading.set(true);
    this.auth.forgotPassword(email).subscribe({
      next: res => {
        this.loading.set(false);
        this.mode.set('reset');
        this.info.set(res?.debug_code ? `Code de démonstration : ${res.debug_code}` : (res?.message ?? 'Code envoyé.'));
      },
      error: () => { this.loading.set(false); this.error.set('Échec de la demande. Réessayez.'); },
    });
  }

  doReset(): void {
    if (this.loading()) return;
    const email = this.email().trim();
    if (!this.resetCode().trim() || this.newPassword().length < 6) {
      this.error.set('Code requis et nouveau mot de passe d\'au moins 6 caractères.');
      return;
    }
    this.error.set(null); this.loading.set(true);
    this.auth.resetPassword(email, this.resetCode().trim(), this.newPassword()).subscribe({
      next: () => {
        this.loading.set(false);
        this.password.set(this.newPassword());
        this.resetCode.set(''); this.newPassword.set('');
        this.mode.set('login');
        this.info.set('Mot de passe réinitialisé. Vous pouvez vous connecter.');
      },
      error: (err: HttpErrorResponse) => { this.loading.set(false); this.error.set(this.errorMessage(err)); },
    });
  }

  private errorMessage(err: HttpErrorResponse): string {
    if (err.status === 401) return 'Identifiants invalides.';
    if (err.status === 0) return 'Serveur injoignable — démarrez le backend (php artisan serve sur :8000).';
    const msg = (err.error as { message?: string } | null)?.message;
    return msg ?? 'Une erreur est survenue. Réessayez.';
  }
}
