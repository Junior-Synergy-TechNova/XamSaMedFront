import { planVoice } from './voice-alerts';
import { AudioManifest } from '../../interfaces/api';

const seg = (...ids: string[]) => ids.map(id => ({ id, file: `${id}.mp3`, format: 'mp3' }));
const COMMON = ['OUV_01', 'POUR_MOI', 'MED_INTRO', 'PER_J7', 'CLO_01', 'CLO_03'];

const manifest: AudioManifest = {
  version: 1,
  fallback_lang: 'fr',
  languages: {
    fr: { segments: seg(...COMMON, 'PER_J0', 'MED_paracetamol', 'MED_insuline') },
    wo: { segments: seg(...COMMON, 'MED_insuline', 'MED_paracetamol'), unmapped_files: ['MED_paracetamol.mp3'] },
  },
};
const msg = (med: string, per = 'PER_J7') => ['OUV_01', 'POUR_MOI', 'MED_INTRO', med, per, 'CLO_01', 'CLO_03'];

describe('planVoice (règles de repli de l\'app mobile)', () => {
  it('joue tout dans la langue du patient quand tout existe', () => {
    const p = planVoice(manifest, 'wo', msg('MED_insuline'), 'Insuline Glargine');
    expect(p.lang).toBe('wo');
    expect(p.audio).toBe(true);
    expect(p.lines.every(l => l.src?.startsWith('audio/wo/'))).toBe(true);
    // L'écran montre le nom exact, pas « insuline ».
    expect(p.lines[3].text).toBe('Insuline Glargine');
  });

  it('règle 1 : un nom de médicament manquant (ou non mappé) est dit en français, le reste en wolof', () => {
    const p = planVoice(manifest, 'wo', msg('MED_paracetamol'), 'Paracétamol 500mg');
    expect(p.lang).toBe('wo');
    expect(p.lines[3].src).toBe('audio/fr/MED_paracetamol.mp3');
    expect(p.lines[0].src).toBe('audio/wo/OUV_01.mp3');
  });

  it('règle 2 : une phrase manquante fait jouer tout le message en français', () => {
    const p = planVoice(manifest, 'wo', msg('MED_insuline', 'PER_J0'), 'Insuline');
    expect(p.lang).toBe('fr');
    expect(p.lines.every(l => l.src?.startsWith('audio/fr/'))).toBe(true);
  });

  it('règle 3 : absent aussi en français → aucun audio, le texte seul', () => {
    const p = planVoice(manifest, 'srr', msg('MED_insuline', 'PER_J30'), 'Insuline');
    expect(p.audio).toBe(false);
    expect(p.lines.every(l => l.src === null)).toBe(true);
    expect(p.lines.map(l => l.text).join(' ')).toContain('expire dans un mois');
  });
});
