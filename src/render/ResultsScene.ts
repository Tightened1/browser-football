import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { formatTime, possessionPercent } from '../matchStats';
import type { GoalRecord, MatchStats } from '../sim/types';
import type { MatchScene } from './MatchScene';
import { readableColor, teamStyle } from './teamStyle';
import { button, Focus, label, UI_COLORS, type Button } from './ui';

const CX = GAME_WIDTH / 2;
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** Full-time screen, drawn over the match: score, stats, goals with times, Rematch and Menu. */
export class ResultsScene extends Phaser.Scene {
  private match!: MatchScene;
  private rematchBtn!: Button;
  private note!: Phaser.GameObjects.Text;
  private statsLayer!: Phaser.GameObjects.Container;
  private drawnKey: string | null = null;
  private focus!: Focus;
  private score!: Phaser.GameObjects.Text;
  private verdict!: Phaser.GameObjects.Text;

  constructor() {
    super('ResultsScene');
  }

  create(): void {
    this.match = this.scene.get('MatchScene') as MatchScene;
    this.drawnKey = null;
    this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.78).setInteractive();
    this.add.rectangle(CX, GAME_HEIGHT / 2, 900, 700, 0x14361c, 0.97).setStrokeStyle(4, 0xffffff, 0.8);
    label(this, CX, 100, 54, UI_COLORS.text, true).setText('FULL TIME').setStroke('#000000', 6);
    this.score = label(this, CX, 175, 56, UI_COLORS.text, true).setStroke('#000000', 6);
    this.verdict = label(this, CX, 230, 26, UI_COLORS.warn, true);
    this.statsLayer = this.add.container(0, 0);

    const online = this.match.isOnline();
    this.rematchBtn = button(this, CX - 150, 700, 'Rematch', () => this.rematch(), { width: 230 });
    const menu = button(this, CX + 150, 700, 'Menu', () => this.match.quit(), { width: 230, secondary: true });
    this.note = label(this, CX, 752, 18, UI_COLORS.muted).setWordWrapWidth(800);
    if (online) this.note.setText('A rematch starts when both players ask for one');
    this.focus = new Focus(this, [{ button: this.rematchBtn }, { button: menu }]);
    this.input.keyboard?.on('keydown-ESC', () => this.match.quit());
  }

  private rematch(): void {
    const r = this.match.rematch();
    if (!r) {
      this.match.restartMatch();
      return;
    }
    this.match.setRematch(!r.mine); // click again to take it back
  }

  update(): void {
    const state = this.match.getState();
    this.score.setText(`${teamStyle(0).name} ${state.score[0]} – ${state.score[1]} ${teamStyle(1).name}`);
    const [a, b] = state.score;
    this.verdict.setText(a === b ? 'It ends in a draw' : `${teamStyle(a > b ? 0 : 1).name} win!`);

    const stats = this.match.stats();
    // The stats object is a fresh copy every tick, so compare what is in it.
    const key = stats ? JSON.stringify(stats) : '';
    if (key !== this.drawnKey) {
      this.drawnKey = key;
      this.drawStats(stats, state.halfLength);
    }

    const r = this.match.rematch();
    const ended = this.match.isEnded();
    if (r) {
      this.rematchBtn.setEnabled(!ended);
      this.rematchBtn.setLabel(r.mine ? 'Waiting… (click to cancel)' : r.theirs ? 'Accept rematch' : 'Rematch');
      this.note.setText(ended ? 'The other player has left, so there is no rematch' : r.theirs && !r.mine ? 'Your opponent wants a rematch!' : r.mine ? 'Waiting for your opponent to accept…' : 'A rematch starts when both players ask for one');
    }
    this.focus.refresh();
  }

  private drawStats(stats: MatchStats | null, halfLength: number): void {
    this.statsLayer.removeAll(true);
    const add = (o: Phaser.GameObjects.GameObject): void => {
      this.statsLayer.add(o);
    };
    const row = (y: number, left: string, mid: string, right: string, color = UI_COLORS.text): void => {
      add(label(this, CX - 270, y, 28, color, true).setText(left));
      add(label(this, CX, y, 22, UI_COLORS.muted).setText(mid));
      add(label(this, CX + 270, y, 28, color, true).setText(right));
    };
    // Team headers in kit colours.
    for (const t of [0, 1] as const) {
      add(label(this, CX + (t ? 270 : -270), 285, 24, hex(readableColor(t)), true).setText(teamStyle(t).name.toUpperCase()).setStroke('#000000', 4));
    }
    if (!stats) {
      add(label(this, CX, 400, 24, UI_COLORS.muted).setText('Collecting the match statistics…'));
      return;
    }
    const [ph, pa] = possessionPercent(stats.possession);
    row(335, String(stats.shots[0]), 'Shots', String(stats.shots[1]));
    row(380, `${ph}%`, 'Possession', `${pa}%`);

    add(label(this, CX, 440, 22, UI_COLORS.warn, true).setText('GOALS'));
    if (stats.goals.length === 0) {
      add(label(this, CX, 490, 20, UI_COLORS.muted).setText('No goals'));
      return;
    }
    // Up to 8 goals are listed, one per line, oldest first (the rest are summarised).
    const shown = stats.goals.slice(0, 8);
    shown.forEach((g: GoalRecord, i: number) => {
      const y = 478 + i * 25;
      const time = formatTime((g.half - 1) * halfLength + g.clock);
      const who = g.player >= 0 ? ` · #${(g.player % 5) + 1}` : '';
      const text = `${time}  ${teamStyle(g.team).name}${who}${g.ownGoal ? ' (own goal)' : ''}`;
      add(label(this, CX, y, 19, hex(readableColor(g.team))).setText(text).setStroke('#000000', 3));
    });
    if (stats.goals.length > shown.length) add(label(this, CX, 478 + shown.length * 25, 17, UI_COLORS.muted).setText(`…and ${stats.goals.length - shown.length} more`));
  }
}
