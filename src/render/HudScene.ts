import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, HALF_LENGTH_SECONDS, TEAMS } from '../config';
import { matchClock } from '../sim/rules';
import type { GameState, RestartType } from '../sim/types';
import type { MatchScene } from './MatchScene';

const FONT = 'sans-serif';
const BAR_W = 560;
const BAR_H = 50;
const BAR_Y = 10;
const CX = GAME_WIDTH / 2;

const RESTART_LABEL: Record<Exclude<RestartType, 'kickoff'>, string> = {
  'throw-in': 'THROW-IN',
  'goal-kick': 'GOAL KICK',
  corner: 'CORNER',
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

function formatClock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function halfLabel(half: number): string {
  return half === 1 ? '1ST HALF' : half === 2 ? '2ND HALF' : `HALF ${half}`;
}

/** Score, team names and colours, clock, half, "GOAL!" banner and the half-time / full-time overlays. Reads the match state only. */
export class HudScene extends Phaser.Scene {
  private score!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private names!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private clock!: Phaser.GameObjects.Text;
  private half!: Phaser.GameObjects.Text;
  private restartLabel!: Phaser.GameObjects.Text;
  private goalBanner!: Phaser.GameObjects.Container;
  private goalTeam!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Container;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlayScore!: Phaser.GameObjects.Text;
  private overlayInfo!: Phaser.GameObjects.Text;
  private playAgain!: Phaser.GameObjects.Text;
  private netPanel!: Phaser.GameObjects.Container;
  private netTitle!: Phaser.GameObjects.Text;
  private netBody!: Phaser.GameObjects.Text;
  private netHint!: Phaser.GameObjects.Text;

  constructor() {
    super('HudScene');
  }

  private text(x: number, y: number, size: number, color = '#ffffff', bold = true): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, '', { fontFamily: FONT, fontSize: `${size}px`, fontStyle: bold ? 'bold' : 'normal', color, stroke: '#000000', strokeThickness: Math.max(2, size / 8) })
      .setOrigin(0.5);
  }

  create(): void {
    // Top bar: [swatch name score] clock [score name swatch].
    const bar = this.add.graphics();
    bar.fillStyle(0x000000, 0.65);
    bar.fillRoundedRect(CX - BAR_W / 2, BAR_Y, BAR_W, BAR_H, 10);
    for (const team of [0, 1] as const) {
      bar.fillStyle(TEAMS[team].kit, 1);
      bar.fillRoundedRect(team === 0 ? CX - BAR_W / 2 + 8 : CX + BAR_W / 2 - 20, BAR_Y + 8, 12, BAR_H - 16, 3);
      bar.lineStyle(2, TEAMS[team].outline, 1);
      bar.strokeRoundedRect(team === 0 ? CX - BAR_W / 2 + 8 : CX + BAR_W / 2 - 20, BAR_Y + 8, 12, BAR_H - 16, 3);
    }
    this.names = [this.text(CX - 190, BAR_Y + BAR_H / 2, 20), this.text(CX + 190, BAR_Y + BAR_H / 2, 20)];
    this.score = [this.text(CX - 82, BAR_Y + BAR_H / 2, 32), this.text(CX + 82, BAR_Y + BAR_H / 2, 32)];
    this.clock = this.text(CX, BAR_Y + 18, 22);
    this.half = this.text(CX, BAR_Y + 39, 11, '#cccccc');
    this.restartLabel = this.text(CX, BAR_Y + BAR_H + 18, 18, '#ffe27a').setVisible(false);

    // GOAL! banner.
    const goalText = this.text(0, 0, 110, '#ffd23f');
    goalText.setText('GOAL!').setStroke('#000000', 12);
    this.goalTeam = this.text(0, 78, 30);
    this.goalBanner = this.add.container(CX, GAME_HEIGHT / 2 - 40, [goalText, this.goalTeam]).setVisible(false);

    // Half-time / full-time overlay.
    const shade = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.65);
    this.overlayTitle = this.text(0, -120, 72);
    this.overlayScore = this.text(0, -20, 64);
    this.overlayInfo = this.text(0, 50, 26, '#dddddd');
    this.playAgain = this.text(0, 135, 40, '#ffffff')
      .setText('Play again')
      .setPadding(28, 12, 28, 12)
      .setBackgroundColor('#2e8b3d')
      .setInteractive({ useHandCursor: true });
    this.playAgain.on('pointerover', () => this.playAgain.setBackgroundColor('#3fae51'));
    this.playAgain.on('pointerout', () => this.playAgain.setBackgroundColor('#2e8b3d'));
    this.playAgain.on('pointerdown', () => this.newMatch());
    this.overlay = this.add
      .container(0, 0, [shade, this.add.container(CX, GAME_HEIGHT / 2, [this.overlayTitle, this.overlayScore, this.overlayInfo, this.playAgain])])
      .setVisible(false);

    // Online: connection trouble / match ended (drawn above everything else).
    const netShade = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55);
    const netBox = this.add.rectangle(CX, GAME_HEIGHT / 2, 760, 260, 0x22303a, 0.95).setStrokeStyle(3, 0xffd23f);
    this.netTitle = this.text(0, -70, 44, '#ffd23f');
    this.netBody = this.text(0, 5, 22, '#ffffff', false).setWordWrapWidth(680).setAlign('center');
    this.netHint = this.text(0, 85, 18, '#cccccc', false);
    this.netPanel = this.add
      .container(0, 0, [netShade, netBox, this.add.container(CX, GAME_HEIGHT / 2, [this.netTitle, this.netBody, this.netHint])])
      .setDepth(100)
      .setVisible(false);

    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.match()?.netOverlay()?.ended) this.match()?.scene.start('MenuScene');
      else if (this.matchState()?.phase === 'full-time' && !this.match()?.isOnline()) this.newMatch();
    });
  }

  private match(): MatchScene | undefined {
    return this.scene.get('MatchScene') as MatchScene | undefined;
  }

  private matchState(): GameState | undefined {
    return this.match()?.getState();
  }

  private newMatch(): void {
    this.match()?.restartMatch();
  }

  update(): void {
    const s = this.matchState();
    if (!s) return;
    for (const team of [0, 1] as const) {
      this.names[team].setText(TEAMS[team].name);
      this.score[team].setText(String(s.score[team]));
    }
    this.clock.setText(formatClock(matchClock(s)));
    this.half.setText(`${halfLabel(s.half)}  ·  ${formatClock(s.clock)}/${formatClock(HALF_LENGTH_SECONDS)}`);

    // Set-piece label.
    const r = s.restart;
    const label = s.phase === 'playing' && r && r.type !== 'kickoff' ? `${RESTART_LABEL[r.type]} — ${TEAMS[r.team].name}` : '';
    this.restartLabel.setText(label).setVisible(label !== '');

    // GOAL! banner.
    const goal = s.phase === 'goal-scored' ? [...s.events].reverse().find((e) => e.type === 'goal') : undefined;
    this.goalBanner.setVisible(!!goal);
    if (goal && goal.team !== undefined) {
      this.goalTeam.setText(`${TEAMS[goal.team].name}${goal.ownGoal ? ' (own goal)' : ''}`).setColor(hex(TEAMS[goal.team].kit)).setStroke('#ffffff', 5);
      const pulse = 1 + 0.06 * Math.sin(this.time.now / 90);
      this.goalBanner.setScale(pulse);
    }

    // Half-time / full-time overlay.
    const halfTime = s.phase === 'half-time';
    const fullTime = s.phase === 'full-time';
    this.overlay.setVisible(halfTime || fullTime);
    if (halfTime || fullTime) {
      this.overlayTitle.setText(halfTime ? 'HALF TIME' : 'FULL TIME');
      this.overlayScore.setText(`${TEAMS[0].name} ${s.score[0]} – ${s.score[1]} ${TEAMS[1].name}`);
      const result = s.score[0] === s.score[1] ? 'It ends in a draw' : `${TEAMS[s.score[0] > s.score[1] ? 0 : 1].name} win!`;
      this.overlayInfo.setText(halfTime ? `Teams swap ends — ${Math.max(0, Math.ceil(s.phaseTimer))}` : result);
      const online = !!this.match()?.isOnline();
      this.playAgain.setVisible(fullTime && !online);
      if (fullTime && online) this.overlayInfo.setText(`${result} · press Esc for the menu`);
    }

    const net = this.match()?.netOverlay() ?? null;
    this.netPanel.setVisible(!!net);
    if (net) {
      this.netTitle.setText(net.title);
      this.netBody.setText(net.body);
      this.netHint.setText(net.ended ? 'Press Enter or Esc to return to the menu' : 'Esc: leave the match');
    }
  }
}
