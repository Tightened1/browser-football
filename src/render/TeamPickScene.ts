import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { matchRulesSetting, RULES_OPTIONS, settings, updateSettings } from '../settings';
import { rulesLabel, rulesSummary } from '../sim/matchRules';
import { cycleKit, cycleName, KIT_PRESETS, randomOpponent, readableOn, TEAM_NAMES, type Look } from '../teams';
import type { MatchSceneData } from './MatchScene';
import type { LobbySceneData } from './LobbyScene';
import { button, drawBackdrop, Focus, heading, label, UI_COLORS } from './ui';

export type TeamPickData = { mode: 'offline' } | { mode: 'host' } | { mode: 'join'; code: string };

const CX = GAME_WIDTH / 2;
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Before a match (or before opening / joining a lobby): choose your team name and kit colour from presets.
 * Online, the lobby shows both teams and the host never lets the two share a kit colour; offline the AI team
 * gets a different one.
 */
export class TeamPickScene extends Phaser.Scene {
  private data_!: TeamPickData;
  private look!: Look;
  private preview!: Phaser.GameObjects.Graphics;
  private nameBtn!: ReturnType<typeof button>;
  private kitBtn!: ReturnType<typeof button>;
  private rulesBtn!: ReturnType<typeof button>;
  private rulesInfo!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;

  constructor() {
    super('TeamPickScene');
  }

  init(data: TeamPickData): void {
    this.data_ = data;
    this.look = { ...settings.look };
  }

  create(): void {
    drawBackdrop(this, GAME_WIDTH, GAME_HEIGHT);
    const d = this.data_;
    heading(
      this,
      CX,
      90,
      'PICK YOUR TEAM',
      d.mode === 'join' ? `You are joining room ${d.code}` : d.mode === 'host' ? 'You are hosting: your friend picks their own team' : 'Your opponent gets a different kit',
    );

    this.preview = this.add.graphics();
    this.title = label(this, CX, 395, 34, UI_COLORS.text, true).setStroke('#000000', 5);

    this.nameBtn = button(this, CX, 455, '', () => this.changeName(1), { width: 460 });
    this.kitBtn = button(this, CX, 520, '', () => this.changeKit(1), { width: 460 });
    // Match rules (T15): offline and when hosting (a guest plays the host's rules, shown in the lobby).
    const pickRules = d.mode !== 'join';
    this.rulesBtn = button(this, CX, 585, '', () => this.changeRules(1), { width: 460 }).setVisible(pickRules);
    this.rulesInfo = label(this, CX, 622, 16, UI_COLORS.muted).setVisible(pickRules);
    const go = button(this, CX, 680, d.mode === 'offline' ? 'Kick off' : d.mode === 'host' ? 'Open a room' : 'Join', () => this.go(), { width: 260 });
    const back = button(this, CX - 330, 680, 'Back', () => this.scene.start(d.mode === 'join' ? 'JoinScene' : 'MenuScene'), { width: 200, secondary: true });
    new Focus(
      this,
      [
        { button: this.nameBtn, onLeft: () => this.changeName(-1), onRight: () => this.changeName(1) },
        { button: this.kitBtn, onLeft: () => this.changeKit(-1), onRight: () => this.changeKit(1) },
        ...(pickRules ? [{ button: this.rulesBtn, onLeft: () => this.changeRules(-1), onRight: () => this.changeRules(1) }] : []),
        { button: go },
        { button: back },
      ],
      pickRules ? 3 : 2,
    );
    label(this, CX, GAME_HEIGHT - 50, 18, UI_COLORS.muted).setText('↑ ↓ choose a row · ← → change it · Enter: continue · Esc: back');
    this.input.keyboard?.on('keydown-ESC', () => back.click());
    this.redraw();
  }

  private changeName(dir: 1 | -1): void {
    this.look = cycleName(this.look, dir);
    this.redraw();
  }

  private changeKit(dir: 1 | -1): void {
    this.look = cycleKit(this.look, dir);
    this.redraw();
  }

  private changeRules(dir: 1 | -1): void {
    const i = RULES_OPTIONS.indexOf(settings.rules);
    updateSettings({ rules: RULES_OPTIONS[(i + dir + RULES_OPTIONS.length) % RULES_OPTIONS.length] });
    this.redraw();
  }

  private redraw(): void {
    this.rulesBtn.setLabel(`◀   Match rules:  ${rulesLabel(settings.rules)}   ▶`);
    this.rulesInfo.setText(rulesSummary(matchRulesSetting()));

    const kit = KIT_PRESETS[this.look.kit];
    this.nameBtn.setLabel(`◀   Team name:  ${TEAM_NAMES[this.look.name]}   ▶`);
    this.kitBtn.setLabel(`◀   Kit colour:  ${kit.label}   ▶`);
    this.title.setText(TEAM_NAMES[this.look.name].toUpperCase()).setColor(hex(readableOn(kit)));
    // A line-up of the team in its kit: keeper and four outfield players.
    const g = this.preview;
    g.clear();
    for (let i = 0; i < 5; i++) {
      const x = CX + (i - 2) * 70;
      const y = 300;
      const keeper = i === 0;
      g.fillStyle(0x000000, 0.25);
      g.fillCircle(x + 3, y + 4, 24);
      g.fillStyle(keeper ? kit.keeper : kit.kit, 1);
      g.fillCircle(x, y, 24);
      g.lineStyle(3, kit.outline, 1);
      g.strokeCircle(x, y, 24);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x + 14, y, 4);
    }
  }

  private go(): void {
    updateSettings({ look: this.look });
    const d = this.data_;
    if (d.mode === 'offline') {
      const data: MatchSceneData = { humanTeam: 0, looks: [this.look, randomOpponent(this.look)] };
      this.scene.start('MatchScene', data);
    } else {
      const data: LobbySceneData = d.mode === 'host' ? { mode: 'host', look: this.look } : { mode: 'join', code: d.code, look: this.look };
      this.scene.start('LobbyScene', data);
    }
  }
}
