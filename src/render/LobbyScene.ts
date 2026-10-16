import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, REJOIN_RETRIES, REJOIN_RETRY_MS } from '../config';
import { GuestLobby } from '../net/client';
import { HostLobby } from '../net/host';
import { describeRoute } from '../net/ice';
import { inviteLink, type Lobby, type LobbyView } from '../net/peer';
import { canStart, looksByTeam, teamOf } from '../net/protocol';
import { matchRulesSetting, settings, updateSettings } from '../settings';
import { nameOr, seriesPlayed, seriesText } from '../social';
import { rulesLabel, rulesSummary } from '../sim/matchRules';
import type { TeamId } from '../sim/types';
import { cycleKit, cycleName, teamStyles, type Look } from '../teams';
import type { MatchSceneData } from './MatchScene';
import { button, copyText, Focus, label, UI_COLORS, type Button } from './ui';

/**
 * host / join: a new lobby. join with `resumeToken` / `rejoin`: the page was refreshed and is rejoining its room (T21).
 * back: after a match, the same lobby (and connection) again, with the series score and the names.
 */
export type LobbySceneData = { mode: 'host'; look: Look } | { mode: 'join'; code: string; look: Look; resumeToken?: string; rejoin?: boolean } | { mode: 'back'; lobby: Lobby };

/** Retries of a failed rejoin so far (module-level: the scene restarts itself between tries). */
let rejoinTries = 0;

const CX = GAME_WIDTH / 2;
const CARD_W = 400;
const CARD_H = 190;
const CARD_Y = 470;
const CARD_X: [number, number] = [CX - 225, CX + 225];

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** The site root the game is served from (the GitHub Pages URL on the live site). */
function siteUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

interface Card {
  bg: Phaser.GameObjects.Graphics;
  title: Phaser.GameObjects.Text;
  who: Phaser.GameObjects.Text;
  ready: Phaser.GameObjects.Text;
  ping: Phaser.GameObjects.Text;
  route: Phaser.GameObjects.Text;
}

/** Online lobby: room code and invite link, both players, ping, team choice, ready, start. Reads the lobby's view; buttons call the lobby. */
export class LobbyScene extends Phaser.Scene {
  private lobby!: Lobby;
  private data_!: LobbySceneData;
  private handedOver = false;
  private retrying = false;
  private seriesLabel!: Phaser.GameObjects.Text;
  private resetSeries!: Button;

  private code!: Phaser.GameObjects.Text;
  private link!: Phaser.GameObjects.Text;
  private copyLink!: Button;
  private copyCode!: Button;
  private status!: Phaser.GameObjects.Text;
  private cards!: [Card, Card];
  private swap!: Button;
  private ready!: Button;
  private start!: Button;
  private kit!: Button;
  private name!: Button;
  private focus!: Focus;
  private readyItem!: { button: Button };
  private focusedReady = false;
  private notice!: Phaser.GameObjects.Text;
  private rulesText!: Phaser.GameObjects.Text;
  private rulesBtn!: Button;
  private errorPanel!: Phaser.GameObjects.Container;
  private errorTitle!: Phaser.GameObjects.Text;
  private errorBody!: Phaser.GameObjects.Text;
  private copiedTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super('LobbyScene');
  }

  init(data: LobbySceneData): void {
    this.data_ = data;
    this.handedOver = false;
    this.retrying = false;
    this.focusedReady = false;
    if (!(data.mode === 'join' && data.rejoin)) rejoinTries = 0;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#14361c');
    const d = this.data_;
    this.lobby =
      d.mode === 'back'
        ? d.lobby
        : d.mode === 'host'
          ? new HostLobby({ name: nameOr(settings.playerName, 'Host'), look: d.look, halfLength: settings.halfMinutes * 60, rules: matchRulesSetting() })
          : new GuestLobby(d.code, d.look, nameOr(settings.playerName, 'Guest'), d.resumeToken ?? '');
    this.lobby.onStart = (info) => {
      this.handedOver = true;
      const l = this.lobby.view.lobby;
      const names: [string, string] = teamOf(l, 'host') === 0 ? [l.names[0], l.names[1]] : [l.names[1], l.names[0]];
      const data: MatchSceneData = { humanTeam: info.localTeam, seed: info.seed, online: this.lobby, halfLength: info.halfLength, looks: info.looks, rules: info.rules, names };
      this.scene.start('MatchScene', data);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (!this.handedOver) this.lobby.leave();
    });

    const host = this.lobby.view.role === 'host';
    label(this, CX, 55, 40, UI_COLORS.text, true).setText(host ? 'HOST AN ONLINE GAME' : 'JOIN AN ONLINE GAME');
    label(this, CX, 112, 20, UI_COLORS.muted).setText('Room code');
    this.code = label(this, CX, 160, 60, UI_COLORS.warn, true).setStroke('#000000', 6);
    this.copyLink = button(this, CX - 135, 240, 'Copy invite link', () => void this.copy('link'), { size: 22, width: 220 }).setVisible(host);
    this.copyCode = button(this, CX + 135, 240, 'Copy code', () => void this.copy('code'), { size: 22, width: 220, secondary: true }).setVisible(host);
    this.link = label(this, CX, 292, 17, UI_COLORS.muted).setVisible(host);
    this.status = label(this, CX, 338, 24, UI_COLORS.text, true).setWordWrapWidth(1000);

    this.cards = [this.makeCard(0), this.makeCard(1)];
    // Your own team's name and kit can be changed here (the other player's kit and name are skipped).
    this.kit = button(this, CARD_X[0], CARD_Y + 62, 'Kit colour', () => this.changeKit(), { size: 18, width: 160, secondary: true });
    this.name = button(this, CARD_X[0] + 170, CARD_Y + 62, 'Team name', () => this.changeName(), { size: 18, width: 160, secondary: true });

    this.swap = button(this, CX - 240, 618, 'Swap teams', () => this.lobby.swapTeams(), { size: 22, width: 200, secondary: true });
    this.ready = button(this, CX, 618, 'Ready', () => this.toggleReady(), { size: 22, width: 200 });
    this.start = button(this, CX + 240, 618, 'Start match', () => this.lobby.start(), { size: 22, width: 200 }).setVisible(host);
    this.notice = label(this, CX, 685, 19, UI_COLORS.warn).setWordWrapWidth(1000);
    // Match rules (T15): the host's choice, shown to both; the host can change it here.
    this.rulesText = label(this, CX, 722, 19, UI_COLORS.text).setWordWrapWidth(1050);
    this.rulesBtn = button(this, CX - 250, GAME_HEIGHT - 60, 'Change rules', () => this.changeRules(), { size: 20, width: 200, secondary: true }).setVisible(host);
    const leave = button(this, CX, GAME_HEIGHT - 60, 'Leave', () => this.backToMenu(), { size: 20, width: 140, secondary: true });
    // T21: the running score of the matches played in this session.
    this.seriesLabel = label(this, CX, CARD_Y + CARD_H / 2 + 20, 22, UI_COLORS.warn, true);
    this.resetSeries = button(this, CX + 250, GAME_HEIGHT - 60, 'Reset series', () => this.lobby.resetSeries(), { size: 20, width: 200, secondary: true }).setVisible(false);
    this.readyItem = { button: this.ready };
    this.focus = new Focus(
      this,
      [
        { button: this.copyLink },
        { button: this.copyCode },
        { button: this.kit },
        { button: this.name },
        { button: this.swap },
        this.readyItem,
        { button: this.start },
        { button: this.rulesBtn },
        { button: this.resetSeries },
        { button: leave },
      ],
      5,
    );

    this.makeErrorPanel();
    this.input.keyboard?.on('keydown-ESC', () => this.backToMenu());
    this.input.keyboard?.on('keydown-ENTER', () => {
      if (this.errorPanel.visible) this.retryOrMenu();
    });
  }

  private makeCard(team: TeamId): Card {
    const x = CARD_X[team];
    return {
      bg: this.add.graphics(),
      title: label(this, x, CARD_Y - CARD_H / 2 + 24, 24, UI_COLORS.text, true),
      who: label(this, x, CARD_Y - 10, 26, UI_COLORS.text, true),
      ready: label(this, x, CARD_Y + 26, 20),
      ping: label(this, x, CARD_Y + 54, 17, UI_COLORS.muted),
      route: label(this, x, CARD_Y + 78, 16, UI_COLORS.muted).setWordWrapWidth(CARD_W - 20),
    };
  }

  private makeErrorPanel(): void {
    const shade = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.75).setInteractive();
    const box = this.add.rectangle(CX, GAME_HEIGHT / 2, 820, 420, 0x22303a).setStrokeStyle(3, 0xff7a6b);
    this.errorTitle = label(this, CX, GAME_HEIGHT / 2 - 150, 38, UI_COLORS.bad, true);
    this.errorBody = label(this, CX, GAME_HEIGHT / 2 - 30, 21).setWordWrapWidth(740).setLineSpacing(6);
    const back = button(this, CX - 130, GAME_HEIGHT / 2 + 140, 'Back to menu', () => this.backToMenu(), { size: 22, width: 200, secondary: true });
    const retry = button(this, CX + 130, GAME_HEIGHT / 2 + 140, 'Try again', () => this.retryOrMenu(), { size: 22, width: 200 });
    const hint = label(this, CX, GAME_HEIGHT / 2 + 195, 16, UI_COLORS.muted).setText('Enter: try again · Esc: back to menu');
    this.errorPanel = this.add.container(0, 0, [shade, box, this.errorTitle, this.errorBody, back.text, retry.text, hint]).setDepth(100).setVisible(false);
  }

  private toggleReady(): void {
    const v = this.lobby.view;
    const me = v.role === 'host' ? 0 : 1;
    this.lobby.setReady(!v.lobby.ready[me]);
  }

  private get myIndex(): 0 | 1 {
    return this.lobby.view.role === 'host' ? 0 : 1;
  }

  private changeKit(): void {
    const l = this.lobby.view.lobby;
    this.lobby.setLook(cycleKit(l.looks[this.myIndex], 1, l.looks[1 - this.myIndex]));
  }

  /** Host: switch between the Arcade and Classic rules (remembered in the settings for next time). */
  private changeRules(): void {
    if (!(this.lobby instanceof HostLobby)) return;
    const next = this.lobby.view.lobby.rules.preset === 'arcade' ? 'classic' : 'arcade';
    updateSettings({ rules: next });
    this.lobby.setRules(matchRulesSetting());
  }

  private changeName(): void {
    const l = this.lobby.view.lobby;
    this.lobby.setLook(cycleName(l.looks[this.myIndex], 1, l.looks[1 - this.myIndex]));
  }

  private async copy(what: 'link' | 'code'): Promise<void> {
    const code = this.lobby.view.code;
    if (!code) return;
    const ok = await copyText(what === 'link' ? inviteLink(code, siteUrl()) : code);
    const b = what === 'link' ? this.copyLink : this.copyCode;
    const original = what === 'link' ? 'Copy invite link' : 'Copy code';
    b.setLabel(ok ? 'Copied!' : 'Copy failed');
    this.copiedTimer?.remove();
    this.copiedTimer = this.time.delayedCall(1500, () => b.setLabel(original));
  }

  /** "Try again" starts a new lobby of the same kind (a lobby carried back from a match is over: back to the menu). */
  private retryOrMenu(): void {
    if (this.data_.mode === 'back') this.backToMenu();
    else this.scene.restart(this.data_);
  }

  private backToMenu(): void {
    this.scene.start('MenuScene');
  }

  update(): void {
    const v = this.lobby.view;
    this.code.setText(v.code || '…');
    const haveCode = v.role === 'host' && v.status !== 'opening' && !!v.code;
    this.copyLink.setEnabled(haveCode);
    this.copyCode.setEnabled(haveCode);
    if (v.role === 'host') this.link.setText(haveCode ? inviteLink(v.code, siteUrl()) : '');
    this.status.setText(statusText(v)).setColor(v.status === 'connected' ? UI_COLORS.good : UI_COLORS.text);

    const connected = v.status === 'connected';
    const styles = teamStyles(looksByTeam(v.lobby));
    for (const team of [0, 1] as const) this.drawCard(team, v, connected, styles[team]);

    // The kit / name buttons sit on your own card, wherever the teams were swapped to.
    const myTeam = teamOf(v.lobby, v.role);
    this.kit.setPosition(CARD_X[myTeam] - 85, CARD_Y + 62);
    this.name.setPosition(CARD_X[myTeam] + 85, CARD_Y + 62);

    const me = this.myIndex;
    this.swap.setEnabled(connected);
    this.kit.setEnabled(connected || v.role === 'host');
    this.name.setEnabled(connected || v.role === 'host');
    this.ready.setEnabled(connected).setLabel(v.lobby.ready[me] ? 'Not ready' : 'Ready');
    this.start.setEnabled(canStart(v.lobby, connected));
    const rules = v.lobby.rules;
    this.rulesText.setText(`Match rules: ${rulesLabel(rules.preset)} (${rulesSummary(rules)})${v.role === 'guest' ? ' · chosen by the host' : ''}`);


    const played = seriesPlayed(v.lobby.series) > 0;
    this.seriesLabel.setText(played ? seriesText(v.lobby.series, v.role) : '');
    this.resetSeries.setVisible(played);
    if (connected) rejoinTries = 0;
    // A refreshed page that couldn't get back in yet (the host may not have noticed the old connection closing): try again.
    const rejoining = this.data_.mode === 'join' && !!this.data_.rejoin;
    const retry = v.status === 'failed' && rejoining && rejoinTries < REJOIN_RETRIES;
    if (retry && !this.retrying) {
      this.retrying = true;
      rejoinTries++;
      this.time.delayedCall(REJOIN_RETRY_MS, () => this.scene.restart(this.data_));
    }
    const failed = v.status === 'failed' && v.error && !retry;
    this.notice.setText(v.notice ?? (retry ? `Rejoining room ${v.code}… (try ${rejoinTries} of ${REJOIN_RETRIES})` : rejoining && v.status !== 'connected' ? `Rejoining room ${v.code}…` : connected && v.role === 'guest' && v.lobby.ready[1] ? 'Waiting for the host to start the match…' : ''));
    this.errorPanel.setVisible(!!failed);
    this.focus.suspend(!!failed);
    // Once the other player is here, the obvious next step is Ready: start the keyboard focus there.
    if (connected && !this.focusedReady) {
      this.focusedReady = true;
      this.focus.focus(this.readyItem);
    }
    if (failed && v.error) {
      this.errorTitle.setText(v.error.title);
      this.errorBody.setText(v.error.hint ? `${v.error.message}\n\n${v.error.hint}` : v.error.message);
    }
    this.focus.refresh();
  }

  private drawCard(team: TeamId, v: LobbyView, connected: boolean, style: { name: string; kit: number; outline: number }): void {
    const card = this.cards[team];
    const x = CARD_X[team];
    const hostHere = teamOf(v.lobby, 'host') === team;
    const isMe = hostHere === (v.role === 'host');
    const present = isMe || connected;
    const idx = hostHere ? 0 : 1;
    card.bg.clear();
    card.bg.fillStyle(0x000000, 0.45);
    card.bg.fillRoundedRect(x - CARD_W / 2, CARD_Y - CARD_H / 2, CARD_W, CARD_H, 12);
    card.bg.fillStyle(style.kit, 1);
    card.bg.fillRoundedRect(x - CARD_W / 2, CARD_Y - CARD_H / 2, CARD_W, 48, { tl: 12, tr: 12, bl: 0, br: 0 });
    // Light kits get dark lettering and vice versa, so the name is always readable.
    const light = ((style.kit >> 16) & 255) * 0.3 + ((style.kit >> 8) & 255) * 0.6 + (style.kit & 255) * 0.1 > 150;
    card.title.setText(style.name.toUpperCase()).setColor(light ? '#111111' : '#ffffff').setStroke(hex(style.outline), light ? 0 : 4);
    if (!present) {
      card.who.setText(v.role === 'host' ? 'Waiting for a player…' : 'Connecting…').setColor(UI_COLORS.muted);
      card.ready.setText('');
      card.ping.setText('');
      card.route.setText('');
      return;
    }
    const player = v.lobby.names[idx];
    card.who.setText(isMe ? `You (${player})` : player).setColor(UI_COLORS.text);
    const ready = v.lobby.ready[idx];
    card.ready.setText(ready ? '✔ READY' : 'Not ready').setColor(ready ? UI_COLORS.good : UI_COLORS.muted);
    card.ping.setText(isMe ? '' : `Ping: ${v.pingMs === null ? '…' : `${Math.round(v.pingMs)} ms`}`);
    // "Connection: Direct (same network, UDP)" / "Connection: Relayed (through a TURN relay server, TLS)"
    card.route.setText(isMe ? '' : `Connection: ${v.route ? describeRoute(v.route) : 'checking…'}`).setColor(v.route?.kind === 'relayed' ? UI_COLORS.warn : UI_COLORS.muted);
  }
}

function statusText(v: LobbyView): string {
  switch (v.status) {
    case 'opening':
      return v.role === 'host' ? 'Opening a room on the matchmaking server…' : 'Contacting the matchmaking server…';
    case 'waiting':
      return 'Room open — send the invite link or code to a friend.';
    case 'connecting':
      return v.role === 'host' ? 'A player is connecting…' : `Connecting to room ${v.code}…`;
    case 'connected':
      return v.role === 'host' ? 'Connected! When you are both ready, press Start match.' : 'Connected! Press Ready, then the host starts the match.';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'failed':
      return 'Connection failed.';
    case 'closed':
      return 'Left the lobby.';
  }
}
