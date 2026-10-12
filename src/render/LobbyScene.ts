import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, TEAMS } from '../config';
import { GuestLobby } from '../net/client';
import { HostLobby } from '../net/host';
import { inviteLink, type Lobby, type LobbyView } from '../net/peer';
import { canStart, teamOf } from '../net/protocol';
import type { TeamId } from '../sim/types';
import type { MatchSceneData } from './MatchScene';
import { button, copyText, label, UI_COLORS, type Button } from './ui';

export type LobbySceneData = { mode: 'host' } | { mode: 'join'; code: string };

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
  who: Phaser.GameObjects.Text;
  ready: Phaser.GameObjects.Text;
  ping: Phaser.GameObjects.Text;
}

/** Online lobby: room code and invite link, both players, ping, team choice, ready, start. Reads the lobby's view; buttons call the lobby. */
export class LobbyScene extends Phaser.Scene {
  private lobby!: Lobby;
  private data_!: LobbySceneData;
  private handedOver = false;

  private code!: Phaser.GameObjects.Text;
  private link!: Phaser.GameObjects.Text;
  private copyLink!: Button;
  private copyCode!: Button;
  private status!: Phaser.GameObjects.Text;
  private cards!: [Card, Card];
  private swap!: Button;
  private ready!: Button;
  private start!: Button;
  private notice!: Phaser.GameObjects.Text;
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
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#14361c');
    this.lobby = this.data_.mode === 'host' ? new HostLobby() : new GuestLobby(this.data_.code);
    this.lobby.onStart = (info) => {
      this.handedOver = true;
      const data: MatchSceneData = { humanTeam: info.localTeam, seed: info.seed, online: this.lobby };
      this.scene.start('MatchScene', data);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (!this.handedOver) this.lobby.leave();
    });

    const host = this.data_.mode === 'host';
    label(this, CX, 55, 40, UI_COLORS.text, true).setText(host ? 'HOST AN ONLINE GAME' : 'JOIN AN ONLINE GAME');
    label(this, CX, 112, 20, UI_COLORS.muted).setText('Room code');
    this.code = label(this, CX, 160, 60, UI_COLORS.warn, true).setStroke('#000000', 6);
    this.copyLink = button(this, CX - 135, 240, 'Copy invite link', () => void this.copy('link'), { size: 22, width: 220 }).setVisible(host);
    this.copyCode = button(this, CX + 135, 240, 'Copy code', () => void this.copy('code'), { size: 22, width: 220, secondary: true }).setVisible(host);
    this.link = label(this, CX, 292, 17, UI_COLORS.muted).setVisible(host);
    this.status = label(this, CX, 338, 24, UI_COLORS.text, true).setWordWrapWidth(1000);

    this.cards = [this.makeCard(0), this.makeCard(1)];

    this.swap = button(this, CX - 240, 618, 'Swap teams', () => this.lobby.swapTeams(), { size: 22, width: 200, secondary: true });
    this.ready = button(this, CX, 618, 'Ready', () => this.toggleReady(), { size: 22, width: 200 });
    this.start = button(this, CX + 240, 618, 'Start match', () => this.lobby.start(), { size: 22, width: 200 }).setVisible(host);
    this.notice = label(this, CX, 685, 19, UI_COLORS.warn).setWordWrapWidth(1000);
    button(this, CX, GAME_HEIGHT - 60, 'Leave', () => this.backToMenu(), { size: 20, width: 140, secondary: true });

    this.makeErrorPanel();
    this.input.keyboard?.on('keydown-ESC', () => this.backToMenu());
  }

  private makeCard(team: TeamId): Card {
    const x = CARD_X[team];
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.45);
    bg.fillRoundedRect(x - CARD_W / 2, CARD_Y - CARD_H / 2, CARD_W, CARD_H, 12);
    bg.fillStyle(TEAMS[team].kit, 1);
    bg.fillRoundedRect(x - CARD_W / 2, CARD_Y - CARD_H / 2, CARD_W, 48, { tl: 12, tr: 12, bl: 0, br: 0 });
    label(this, x, CARD_Y - CARD_H / 2 + 24, 24, UI_COLORS.text, true).setText(TEAMS[team].name.toUpperCase()).setStroke(hex(TEAMS[team].outline), 4);
    return {
      bg,
      who: label(this, x, CARD_Y - 10, 26, UI_COLORS.text, true),
      ready: label(this, x, CARD_Y + 30, 20),
      ping: label(this, x, CARD_Y + 62, 17, UI_COLORS.muted),
    };
  }

  private makeErrorPanel(): void {
    const shade = this.add.rectangle(CX, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.75).setInteractive();
    const box = this.add.rectangle(CX, GAME_HEIGHT / 2, 820, 420, 0x22303a).setStrokeStyle(3, 0xff7a6b);
    this.errorTitle = label(this, CX, GAME_HEIGHT / 2 - 150, 38, UI_COLORS.bad, true);
    this.errorBody = label(this, CX, GAME_HEIGHT / 2 - 30, 21).setWordWrapWidth(740).setLineSpacing(6);
    const back = button(this, CX - 130, GAME_HEIGHT / 2 + 140, 'Back to menu', () => this.backToMenu(), { size: 22, width: 200, secondary: true });
    const retry = button(this, CX + 130, GAME_HEIGHT / 2 + 140, 'Try again', () => this.scene.restart(this.data_), { size: 22, width: 200 });
    this.errorPanel = this.add.container(0, 0, [shade, box, this.errorTitle, this.errorBody, back.text, retry.text]).setDepth(100).setVisible(false);
  }

  private toggleReady(): void {
    const v = this.lobby.view;
    const me = v.role === 'host' ? 0 : 1;
    this.lobby.setReady(!v.lobby.ready[me]);
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
    for (const team of [0, 1] as const) this.drawCard(team, v, connected);

    const me = v.role === 'host' ? 0 : 1;
    this.swap.setEnabled(connected);
    this.ready.setEnabled(connected).setLabel(v.lobby.ready[me] ? 'Not ready' : 'Ready');
    this.start.setEnabled(canStart(v.lobby, connected));
    this.notice.setText(v.notice ?? (connected && v.role === 'guest' && v.lobby.ready[1] ? 'Waiting for the host to start the match…' : ''));

    const failed = v.status === 'failed' && v.error;
    this.errorPanel.setVisible(!!failed);
    if (failed && v.error) {
      this.errorTitle.setText(v.error.title);
      this.errorBody.setText(v.error.hint ? `${v.error.message}\n\n${v.error.hint}` : v.error.message);
    }
  }

  private drawCard(team: TeamId, v: LobbyView, connected: boolean): void {
    const card = this.cards[team];
    const hostHere = teamOf(v.lobby, 'host') === team;
    const isMe = hostHere === (v.role === 'host');
    const present = isMe || connected;
    const idx = hostHere ? 0 : 1;
    if (!present) {
      card.who.setText(v.role === 'host' ? 'Waiting for a player…' : 'Connecting…').setColor(UI_COLORS.muted);
      card.ready.setText('');
      card.ping.setText('');
      return;
    }
    const name = v.lobby.names[idx];
    card.who.setText(isMe ? `You (${name})` : name).setColor(UI_COLORS.text);
    const ready = v.lobby.ready[idx];
    card.ready.setText(ready ? '✔ READY' : 'Not ready').setColor(ready ? UI_COLORS.good : UI_COLORS.muted);
    card.ping.setText(isMe ? '' : `Ping: ${v.pingMs === null ? '…' : `${Math.round(v.pingMs)} ms`}`);
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
    case 'failed':
      return 'Connection failed.';
    case 'closed':
      return 'Left the lobby.';
  }
}
