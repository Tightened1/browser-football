import Phaser from 'phaser';
import { AI_VS_AI, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { normalizeRoomCode } from '../net/roomCode';
import { GAME_VERSION } from '../net/protocol';
import { loadSession } from '../net/session';
import { NAME_MAX_LENGTH } from '../config';
import { settings, updateSettings } from '../settings';
import { sanitizeName } from '../social';
import { button, drawBackdrop, Focus, label, UI_COLORS, UI_FONT } from './ui';
import type { TeamPickData } from './TeamPickScene';

const CX = GAME_WIDTH / 2;

/** URL options are acted on once per page load, so "back to menu" doesn't re-trigger them. */
let urlHandled = false;

/** Title screen: play offline vs the AI, host or join an online game, settings, how to play. Keyboard or mouse. */
export class MenuScene extends Phaser.Scene {
  private message!: Phaser.GameObjects.Text;

  constructor() {
    super('MenuScene');
  }

  create(data: { message?: string } = {}): void {
    drawBackdrop(this, GAME_WIDTH, GAME_HEIGHT);

    label(this, CX, 130, 76, UI_COLORS.text, true).setText('BROWSER FOOTBALL').setStroke('#000000', 8);
    label(this, CX, 195, 24, UI_COLORS.muted).setText('5-a-side arcade football · play the AI or a friend online');

    // T21: your name, shown to a friend online (saved as you type).
    label(this, CX - 175, 252, 20, UI_COLORS.muted).setText('Your name').setOrigin(1, 0.5);
    const dom = this.add.dom(CX + 5, 252).createFromHTML(
      `<input type="text" maxlength="${NAME_MAX_LENGTH * 2}" placeholder="Player" autocomplete="off" spellcheck="false" aria-label="Your name"
        style="width:300px;padding:6px 10px;font:bold 20px ${UI_FONT};border:2px solid #ffffff;border-radius:6px;background:#0d2412;color:#ffffff;outline:none;text-align:center">`,
    );
    const nameInput = (dom.node as HTMLElement).querySelector('input')!;
    nameInput.value = settings.playerName;

    const wide = { width: 380 };
    const play = button(this, CX, 322, 'Play vs AI', () => this.pickTeam({ mode: 'offline' }), wide);
    const host = button(this, CX, 392, 'Host online', () => this.pickTeam({ mode: 'host' }), wide);
    const join = button(this, CX, 462, 'Join online', () => this.scene.start('JoinScene'), wide);
    const settingsBtn = button(this, CX - 100, 540, 'Settings', () => this.scene.start('SettingsScene'), { width: 190, secondary: true });
    const how = button(this, CX + 100, 540, 'How to play', () => this.scene.start('HowToPlayScene'), { width: 190, secondary: true });
    const test = button(this, CX, 610, 'Test my connection', () => this.scene.start('DiagnosticsScene'), { size: 20, width: 260, secondary: true });
    // ↑ on the top button goes up to the name box (registered before Focus, so it sees ↑ while the button still has focus).
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.code === 'ArrowUp' && focus.current?.button === play) nameInput.focus();
    });
    const focus = new Focus(this, [{ button: play }, { button: host }, { button: join }, { button: settingsBtn }, { button: how }, { button: test }]);
    // The text box keeps the keyboard until Enter / ↓ / Esc hands it back to the buttons (as on the join screen).
    const saveName = (): void => {
      const name = sanitizeName(nameInput.value);
      nameInput.value = name;
      updateSettings({ playerName: name });
    };
    nameInput.addEventListener('input', () => updateSettings({ playerName: sanitizeName(nameInput.value) }));
    nameInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the game's own keyboard handling must not see what is typed here
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'Escape') {
        e.preventDefault();
        saveName();
        nameInput.blur();
        focus.suspend(false);
      }
    });
    nameInput.addEventListener('blur', () => {
      saveName();
      focus.suspend(false);
    });
    nameInput.addEventListener('focus', () => focus.suspend(true));

    this.message = label(this, CX, 665, 22, UI_COLORS.warn).setWordWrapWidth(900);
    if (data.message) this.message.setText(data.message);

    label(this, CX, GAME_HEIGHT - 70, 18, UI_COLORS.muted).setText('↑ ↓ ← → to move · Enter to choose · or just click');
    label(this, CX, GAME_HEIGHT - 40, 15, '#7f9488').setText(`v${GAME_VERSION}`);

    this.handleUrlOnce();
  }

  /** ?room=CODE (an invite link) goes to the team picker and then joins that room; ?aivsai goes straight into a match. */
  private handleUrlOnce(): void {
    if (urlHandled) return;
    urlHandled = true;
    const q = new URLSearchParams(window.location.search);
    const room = q.get('room');
    if (room !== null) {
      const code = normalizeRoomCode(room);
      // T21: a page refreshed in a lobby or match rejoins the room by itself (no team picker).
      const session = code ? loadSession(code) : null;
      if (code && session) this.scene.start('LobbyScene', { mode: 'join', code, look: { ...settings.look }, resumeToken: session.token, rejoin: true });
      else if (code) this.pickTeam({ mode: 'join', code });
      else this.message.setText(`The invite link's room code "${room}" doesn't look right. Check it and try again.`);
      return;
    }
    if (AI_VS_AI || q.has('aivsai')) this.scene.start('MatchScene', {});
  }

  private pickTeam(data: TeamPickData): void {
    this.scene.start('TeamPickScene', data);
  }
}
