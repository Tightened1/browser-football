import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { controlsText, padPrompts } from '../input/pad';
import { controlsSummary, settings } from '../settings';
import type { MatchScene } from './MatchScene';
import { button, Focus, label, UI_COLORS } from './ui';

const CX = GAME_WIDTH / 2;

/**
 * The pause menu, drawn over the match. Offline the match is frozen while it is open. Online it is not: the other
 * player is still playing in real time, and letting either side freeze the match would let one player stall the
 * other, so the menu simply covers the screen (and your own input is ignored) while the match carries on.
 */
export class PauseScene extends Phaser.Scene {
  private online = false;

  constructor() {
    super('PauseScene');
  }

  init(data: { online?: boolean } = {}): void {
    this.online = !!data.online;
  }

  create(): void {
    const match = this.scene.get('MatchScene') as MatchScene;
    this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6).setInteractive();
    this.add.rectangle(CX, GAME_HEIGHT / 2, 640, 440, 0x14361c, 0.97).setStrokeStyle(4, 0xffffff, 0.8);
    label(this, CX, GAME_HEIGHT / 2 - 165, 54, UI_COLORS.text, true).setText(this.online ? 'MENU' : 'PAUSED').setStroke('#000000', 6);
    label(this, CX, GAME_HEIGHT / 2 - 112, 19, this.online ? UI_COLORS.warn : UI_COLORS.muted)
      .setText(this.online ? "The match is still running — your friend is still playing" : 'The match is paused')
      .setWordWrapWidth(580);

    const notice = match.padNoticeText();
    if (notice) label(this, CX, GAME_HEIGHT / 2 - 82, 18, UI_COLORS.bad, true).setText(notice);

    const resume = button(this, CX, GAME_HEIGHT / 2 - 40, 'Resume', () => match.closePause(), { width: 320 });
    const quit = button(this, CX, GAME_HEIGHT / 2 + 40, 'Quit to menu', () => match.quit(), { width: 320, secondary: true });
    new Focus(this, [{ button: resume }, { button: quit }]);

    label(this, CX, GAME_HEIGHT / 2 + 120, 15, UI_COLORS.muted).setText(controlsText(controlsSummary(settings.bindings))).setWordWrapWidth(600);
    label(this, CX, GAME_HEIGHT / 2 + 180, 16, UI_COLORS.muted).setText(
      this.online ? 'Quitting ends the match for both players' : padPrompts() ? 'Menu or B: resume' : 'Esc: resume',
    );
  }
}
