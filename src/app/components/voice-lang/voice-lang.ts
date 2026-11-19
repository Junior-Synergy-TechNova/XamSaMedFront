import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Icon } from '../icon/icon';
import { AuthService } from '../../services/auth/auth';
import { PlatformState } from '../../services/platform/platform';
import { VOICE_LANGS } from '../../services/voice-alerts/voice-alerts';
import { VoiceLang } from '../../interfaces/api';

/**
 * Langue des alertes vocales de l'armoire (patient) : `select` compact (armoire, profil)
 * ou `list` de choix (menu du compte). Enregistrée dans le profil, commune avec l'app.
 */
@Component({
  selector: 'pf-voice-lang',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './voice-lang.html',
  styleUrl: './voice-lang.css',
})
export class VoiceLangPicker {
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformState);

  readonly variant = input<'select' | 'list'>('select');
  readonly langs = VOICE_LANGS;
  readonly current = computed<VoiceLang>(() => this.auth.user()?.preferred_language ?? 'fr');
  readonly saving = signal<VoiceLang | null>(null);

  onSelect(e: Event): void { this.choose((e.target as HTMLSelectElement).value as VoiceLang); }

  choose(lang: VoiceLang): void {
    if (lang === this.current() || this.saving()) return;
    this.saving.set(lang);
    this.auth.setVoiceLanguage(lang).subscribe({
      next: l => {
        this.saving.set(null);
        this.platform.notify(`Alertes vocales en ${(VOICE_LANGS.find(x => x.id === l)?.label ?? l).toLocaleLowerCase('fr')}.`);
      },
      error: () => {
        this.saving.set(null);
        this.platform.notify('La langue n\'a pas pu être enregistrée. Réessayez.', 'alert');
      },
    });
  }
}
