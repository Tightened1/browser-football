import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { matchRulesSetting, RULES_OPTIONS, settings, updateSettings } from '../settings';
import { rulesLabel, rulesSummary } from '../sim/matchRules';
import { UNOFFICIAL_NOTE } from '../data/clubs';
import { CLUBS, kitLabel, kitOf, randomOpponent, readableOn, resolveLooks, stepClub, stepKit, teamStyles, type Look } from '../teams';
import type { MatchSceneData } from './MatchScene';
import type { LobbySceneData } from './LobbyScene';
import { button, drawBackdrop, Focus, heading, label, UI_COLORS } from './ui';

export type TeamPickData = { mode: 'offline' } | { mode: 'host' } | { mode: 'join'; code: string };

const CX = GAME_WIDTH / 2;
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const CLASH_NOTE = 'Kit changed to avoid a colour clash';

/**
 * Before a match (or before opening / joining a lobby): choose a Premier League club and its home, away or third kit
 * (T24). Offline the AI gets a random other club (or the one you choose), moved to a kit that doesn't clash; online
 * the host settles the kits in the lobby, and both players see the final ones before the match.
 */
export class TeamPickScene extends Phaser.Scene {
  private data_!: TeamPickData;
  private look!: Look;
  /** Offline: the opponent's club, or -1 for a random one. */
  private opponent = -1;
  private preview!: Phaser.GameObjects.Graphics;
  private squad: { name: Phaser.GameObjects.Text; sub: Phaser.GameObjects.Text; num: Phaser.GameObjects.Text }[] = [];
  private clubBtn!: ReturnType<typeof button>;
  private kitBtn!: ReturnType<typeof button>;
  private oppBtn!: ReturnType<typeof button>;
  private rulesBtn!: ReturnType<typeof button>;
  private rulesInfo!: Phaser.GameObjects.Text;
  private title!: Phaser.GameObjects.Text;
  private note!: Phaser.GameObjects.Text;

  constructor() {
    super('TeamPickScene');
  }

  init(data: TeamPickData): void {
    this.data_ = data;
    this.look = { ...settings.look };
    this.opponent = -1;
  }

  create(): void {
    drawBackdrop(this, GAME_WIDTH, GAME_HEIGHT);
    const d = this.data_;
    const offline = d.mode === 'offline';
    heading(
      this,
      CX,
      60,
      'PICK YOUR CLUB',
      d.mode === 'join' ? `You are joining room ${d.code}` : d.mode === 'host' ? 'You are hosting: your friend picks their own club' : 'Choose a club and a kit (every club plays the same)',
    );

    this.preview = this.add.graphics();
    this.squad = [];
    for (let i = 0; i < 5; i++) {
      const x = CX + (i - 2) * 150;
      this.squad.push({
        num: label(this, x, 205, 22, '#ffffff', true),
        name: label(this, x, 262, 20, UI_COLORS.text, true).setStroke('#000000', 3),
        sub: label(this, x, 286, 15, UI_COLORS.muted),
      });
    }
    this.title = label(this, CX, 335, 34, UI_COLORS.text, true).setStroke('#000000', 5);

    this.clubBtn = button(this, CX, 395, '', () => this.changeClub(1), { width: 560 });
    this.kitBtn = button(this, CX, 455, '', () => this.changeKit(1), { width: 560 });
    this.oppBtn = button(this, CX, 515, '', () => this.changeOpponent(1), { width: 560 }).setVisible(offline);
    // Match rules (T15): offline and when hosting (a guest plays the host's rules, shown in the lobby).
    const pickRules = d.mode !== 'join';
    const rulesY = offline ? 575 : 515;
    this.rulesBtn = button(this, CX, rulesY, '', () => this.changeRules(1), { width: 560 }).setVisible(pickRules);
    this.rulesInfo = label(this, CX, rulesY + 36, 16, UI_COLORS.muted).setVisible(pickRules);
    this.note = label(this, CX, 650, 18, UI_COLORS.warn);
    const go = button(this, CX, 705, offline ? 'Kick off' : d.mode === 'host' ? 'Open a room' : 'Join', () => this.go(), { width: 260 });
    const back = button(this, CX - 330, 705, 'Back', () => this.scene.start(d.mode === 'join' ? 'JoinScene' : 'MenuScene'), { width: 200, secondary: true });
    new Focus(
      this,
      [
        { button: this.clubBtn, onLeft: () => this.changeClub(-1), onRight: () => this.changeClub(1) },
        { button: this.kitBtn, onLeft: () => this.changeKit(-1), onRight: () => this.changeKit(1) },
        ...(offline ? [{ button: this.oppBtn, onLeft: () => this.changeOpponent(-1), onRight: () => this.changeOpponent(1) }] : []),
        ...(pickRules ? [{ button: this.rulesBtn, onLeft: () => this.changeRules(-1), onRight: () => this.changeRules(1) }] : []),
        { button: go },
        { button: back },
      ],
      offline && pickRules ? 4 : pickRules ? 3 : 2,
    );
    label(this, CX, GAME_HEIGHT - 50, 18, UI_COLORS.muted).setText('↑ ↓ choose a row · ← → change it · Enter: continue · Esc: back');
    label(this, CX, GAME_HEIGHT - 24, 14, UI_COLORS.muted).setText(UNOFFICIAL_NOTE);
    this.input.keyboard?.on('keydown-ESC', () => back.click());
    this.redraw();
  }

  private changeClub(dir: 1 | -1): void {
    this.look = { club: stepClub(this.look.club, dir), kit: this.look.kit };
    this.redraw();
  }

  private changeKit(dir: 1 | -1): void {
    this.look = { ...this.look, kit: stepKit(this.look.kit, dir) };
    this.redraw();
  }

  /** -1 = a random club, then every club except yours is possible (you may pick any; the same club is fine). */
  private changeOpponent(dir: 1 | -1): void {
    const n = CLUBS.length + 1;
    this.opponent = ((this.opponent + 1 + dir + n) % n) - 1;
    this.redraw();
  }

  private changeRules(dir: 1 | -1): void {
    const i = RULES_OPTIONS.indexOf(settings.rules);
    updateSettings({ rules: RULES_OPTIONS[(i + dir + RULES_OPTIONS.length) % RULES_OPTIONS.length] });
    this.redraw();
  }

  /** Offline: the two looks the match would use right now (the opponent's random choice is made when it starts). */
  private offlineLooks(random = false): { mine: Look; theirs: Look; changed: [boolean, boolean] } {
    const guestWanted: Look = this.opponent < 0 ? (random ? randomOpponent(this.look) : { club: (this.look.club + 1) % CLUBS.length, kit: 0 }) : { club: this.opponent, kit: 0 };
    const r = resolveLooks(this.look, guestWanted);
    return { mine: r.looks[0], theirs: r.looks[1], changed: r.changed };
  }

  private redraw(): void {
    this.rulesBtn.setLabel(`◀   Match rules:  ${rulesLabel(settings.rules)}   ▶`);
    this.rulesInfo.setText(rulesSummary(matchRulesSetting()));

    const offline = this.data_.mode === 'offline';
    // (The opponent never moves your kit, except that a kit that vanishes into the grass is changed.)
    const mine = resolveLooks(this.look, this.look).looks[0];
    const club = CLUBS[this.look.club];
    const style = teamStyles([mine, mine])[0];
    this.clubBtn.setLabel(`◀   Club:  ${club.name}   ▶`);
    this.kitBtn.setLabel(`◀   Kit:  ${kitLabel(mine)}   ▶`);
    if (offline) this.oppBtn.setLabel(`◀   Opponent:  ${this.opponent < 0 ? 'a random club' : CLUBS[this.opponent].name}   ▶`);
    this.title.setText(club.name.toUpperCase()).setColor(hex(readableOn({ kit: style.kit, outline: style.outline })));

    // Why the kit isn't the one asked for.
    const changed = mine.kit !== this.look.kit;
    const oppChanged = offline && this.opponent >= 0 ? this.offlineLooks().changed[1] : false;
    this.note.setText(changed ? `${CLASH_NOTE} (${kitLabel(mine)})` : oppChanged ? `Opponent: ${CLASH_NOTE}` : offline ? '' : 'Your kit may change in the lobby if it clashes with the other player\'s');

    // A line-up of the squad in the kit: keeper and four outfield players, with their real names and numbers.
    const kit = kitOf(mine);
    const g = this.preview;
    g.clear();
    club.players.forEach((pl, i) => {
      const x = CX + (i - 2) * 150;
      const y = 205;
      const keeper = i === 0;
      g.fillStyle(0x000000, 0.25);
      g.fillCircle(x + 3, y + 4, 28);
      g.fillStyle(keeper ? style.keeper : kit.shirt, 1);
      g.fillCircle(x, y, 28);
      g.lineStyle(3, keeper ? style.keeperOutline : kit.trim, 1);
      g.strokeCircle(x, y, 28);
      const ink = keeper ? style.keeperNumber : kit.number;
      this.squad[i].num.setText(String(pl.number)).setColor(hex(ink)).setStroke(ink > 0x808080 ? '#000000' : '#ffffff', 3);
      this.squad[i].name.setText(pl.name);
      this.squad[i].sub.setText(pl.role);
    });
  }

  private go(): void {
    const d = this.data_;
    updateSettings({ look: this.look });
    if (d.mode === 'offline') {
      const r = this.offlineLooks(true);
      const data: MatchSceneData = { humanTeam: 0, looks: [r.mine, r.theirs] };
      this.scene.start('MatchScene', data);
    } else {
      const data: LobbySceneData = d.mode === 'host' ? { mode: 'host', look: this.look } : { mode: 'join', code: d.code, look: this.look };
      this.scene.start('LobbyScene', data);
    }
  }
}
