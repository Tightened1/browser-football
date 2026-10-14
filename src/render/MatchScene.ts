import Phaser from 'phaser';
import {
  CENTRE_CIRCLE_RADIUS,
  COLORS,
  CONTROL_RING_COLOR,
  SET_PIECE_ARROW_COLOR,
  SET_PIECE_ARROW_LENGTH,
  GAME_HEIGHT,
  LINE_THICKNESS,
  PENALTY_BOX_HEIGHT,
  PENALTY_BOX_WIDTH,
  PITCH_HEIGHT,
  PITCH_MARGIN,
  PITCH_STRIPES,
  PITCH_TOP,
  PITCH_BOTTOM,
  PITCH_WIDTH,
  AI_VS_AI,
  DEBUG_CLICK_KICK,
  DEBUG_KICK_SPEED,
  POST_RADIUS,
  SHOT_MAX_CHARGE_TIME,
  AIM_LINE_ALPHA,
  AIM_LINE_COLOR,

  KICK_BUFFER_TIME,
  KICK_FLASH_TIME,
  GAME_WIDTH,
  CAMERA_AUTO_MIN_SCALE,
  CAMERA_FOLLOW_ZOOM,
  CAMERA_SMOOTH,
  CAMERA_ZOOM_SMOOTH,
  FX_CONFETTI_COUNT,
  FX_LIFT_SCALE,
  FX_SHAKE_INTENSITY,
  FX_SHAKE_MS,
  FX_ZOOM_PUNCH,
  PITCH_LEFT,
  PITCH_RIGHT,
} from '../config';
import { crowdExcitement, eventSound, kickPower, scanEvents, BallCueDetector, KickCueWatcher, type BallCue } from '../audio/cues';
import { sound } from '../audio/sound';
import { approach, ballLift, cameraTarget, netBox, netGrid, Effects } from './effects';
import { KeyboardInput } from '../input/keyboard';
import { controlsSummary, settings } from '../settings';
import { ballBoundary, NEUTRAL_INPUT } from '../sim/simulation';
import { matchRulesSetting } from '../settings';
import { randomOpponent, type Look } from '../teams';
import { setTeamLooks, teamStyle } from './teamStyle';
import { roleOf } from '../sim/ai';
import { pendingThrowIn, restartAim } from '../sim/setpiece';
import { assistAim, attackedGoalX, inShootingRange, yAtGoalLine } from '../sim/shooting';
import type { Difficulty, GameState, InputFrame, MatchEvent, MatchRules, MatchStats, PlayerState, TeamId, Vec2 } from '../sim/types';
import { GuestLobby, GuestMatch } from '../net/client';
import { HostLobby, HostMatch } from '../net/host';
import type { MatchDriver, NetOverlay } from '../net/match';
import type { Lobby } from '../net/peer';

/** How MatchScene is started: offline vs the AI by default; online (from the lobby) with the player's team. */
export interface MatchSceneData {
  /** The team the local player controls (default home). */
  humanTeam?: TeamId;
  seed?: number;
  /** The online lobby connection: the host runs the match and the guest follows it over this. */
  online?: Lobby;
  /** Seconds per half (default: the match length in the settings). Online, the host's setting. */
  halfLength?: number;
  /** Both teams' names and kits, indexed by team (default: the saved look against a random opponent). */
  looks?: [Look, Look];
  /** Match rules (T15; default: from the settings). Online, the host's. */
  rules?: MatchRules;
}

/** How long the final whistle is left alone before the results screen appears. */
const RESULTS_DELAY = 1.2;

const ROLE_LABEL = { keeper: 'GK', defender: 'DEF', attacker: 'ATT' } as const;

/** Match options from the URL: ?aivsai to spectate, ?difficulty=easy|normal|hard for the AI. */
function urlOptions(): { aiVsAi: boolean; difficulty?: Difficulty } {
  const q = new URLSearchParams(window.location.search);
  const d = q.get('difficulty');
  const difficulty = d === 'easy' || d === 'normal' || d === 'hard' ? d : undefined;
  return { aiVsAi: AI_VS_AI || q.has('aivsai'), difficulty };
}

/**
 * Draws the match. Reads state only; never changes it. The match itself is advanced by a driver: a HostMatch
 * (offline, or the online host: the only real simulation) or, for the online guest, a GuestMatch.
 */
export class MatchScene extends Phaser.Scene {
  private driver!: MatchDriver;
  private keyboard!: KeyboardInput;
  private dynamic!: Phaser.GameObjects.Graphics;
  private netGfx!: Phaser.GameObjects.Graphics;
  private fxGfx!: Phaser.GameObjects.Graphics;
  private readonly numberLabels: Phaser.GameObjects.Text[] = [];
  /** Shirt numbers drawn on every player. */
  private readonly shirtLabels: Phaser.GameObjects.Text[] = [];
  /** Juice (render/audio only): particles, net ripples, ball cues, camera. All driven by the drawn state and its events. */
  private effects = new Effects();
  private detector = new BallCueDetector();
  private kickCues = new KickCueWatcher();
  /** The latest local input (for the set-piece aim arrow, drawn from your keys at once, even online). */
  private lastInput: InputFrame = { ...NEUTRAL_INPUT };
  private lastEventId = 0;
  private lastTick = 0;
  private netsDirty = true;
  private lastVolume = -1;
  private excitementTimer = 0;
  private camX = GAME_WIDTH / 2;
  private camY = GAME_HEIGHT / 2;
  private camZoom = 1;
  private zoomPunch = 0;
  private aiVsAi = false;
  /** AI debug overlay (toggle with F2 or `): each AI player's role and intent, plus team modes. */
  private debugAi = false;
  private debugGfx!: Phaser.GameObjects.Graphics;
  private readonly debugLabels: Phaser.GameObjects.Text[] = [];
  private debugTeams!: Phaser.GameObjects.Text;
  private humanTeam: TeamId = 0;
  private seed?: number;
  private online?: Lobby;
  private halfLength = 180;
  private looks!: [Look, Look];
  private rules!: MatchRules;
  /** The goal posts' centres (for the match's goal width), for spotting a ball ringing off the woodwork. */
  private posts: Vec2[] = [];
  /** The pause menu is open (offline this also stops the match; online the match carries on without your input). */
  private pauseOpen = false;
  private frozen = false;
  private resultsShown = false;
  private fullTimeFor = 0;
  private onlineLabel?: Phaser.GameObjects.Text;
  /** Network debug overlay (toggle with F3): ping, snapshot rate, buffer, loss. */
  private debugNet = false;
  private netText!: Phaser.GameObjects.Text;

  constructor() {
    super('MatchScene');
  }

  init(data: MatchSceneData = {}): void {
    this.humanTeam = data.humanTeam ?? 0;
    this.online = data.online;
    // Offline matches get a fresh seed each time, so the AI doesn't play out the same match every time.
    this.seed = data.seed ?? (data.online ? undefined : Math.floor(Math.random() * 0x7fffffff));
    this.halfLength = data.halfLength ?? settings.halfMinutes * 60;
    this.looks = data.looks ?? [settings.look, randomOpponent(settings.look)];
    this.rules = data.rules ?? matchRulesSetting();
    setTeamLooks(this.looks);
    this.pauseOpen = false;
    this.frozen = false;
    this.resultsShown = false;
    this.fullTimeFor = 0;
  }

  create(): void {
    const opts = urlOptions();
    this.aiVsAi = !this.online && opts.aiVsAi;
    this.driver = this.createDriver(opts.difficulty);
    this.posts = ballBoundary(this.driver.state.rules).posts.map((p) => p.pos);
    this.effects = new Effects();
    this.detector = new BallCueDetector();
    this.kickCues = new KickCueWatcher();
    this.lastEventId = 0;
    this.lastTick = 0;
    this.netsDirty = true;
    this.lastVolume = -1;
    this.excitementTimer = 0;
    this.camX = GAME_WIDTH / 2;
    this.camY = GAME_HEIGHT / 2;
    this.camZoom = 1;
    this.zoomPunch = 0;
    const world: Phaser.GameObjects.GameObject[] = [];
    const ui: Phaser.GameObjects.GameObject[] = [];
    world.push(this.drawPitch());
    this.netGfx = this.add.graphics().setDepth(1);
    this.dynamic = this.add.graphics().setDepth(5);
    this.fxGfx = this.add.graphics().setDepth(8);
    world.push(this.netGfx, this.dynamic, this.fxGfx);
    this.createDebugOverlay();
    this.numberLabels.length = 0;
    this.shirtLabels.length = 0;
    for (const p of this.driver.state.players) {
      const t = this.add
        .text(0, 0, String(p.number), { fontFamily: 'sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(9);
      this.shirtLabels[p.id] = t;
      world.push(t);
    }
    for (const team of [0, 1]) {
      const label = this.add
        .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 4 })
        .setOrigin(0.5, 1)
        .setDepth(10)
        .setVisible(false);
      this.numberLabels[team] = label;
      world.push(label);
    }
    world.push(this.debugGfx, ...this.debugLabels);
    ui.push(this.debugTeams);

    this.keyboard = new KeyboardInput(settings.bindings);
    this.scene.launch('HudScene');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.keyboard.dispose();
      for (const key of ['HudScene', 'PauseScene', 'ResultsScene']) this.scene.stop(key);
      this.online?.leave();
    });
    // Esc: the pause menu (or, once the match is over for good, back to the menu).
    this.input.keyboard?.on('keydown-ESC', (e: KeyboardEvent) => {
      if (e.repeat || this.resultsShown) return; // the results screen has its own Esc
      if (this.driver.overlay(performance.now())?.ended) this.quit();
      else if (this.pauseOpen) this.closePause();
      else this.openPause();
    });
    if (settings.showControls) {
      const controls = this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT - 14, controlsSummary(settings.bindings), { fontFamily: 'sans-serif', fontSize: '14px', color: '#d8e4dc', stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5)
        .setDepth(30);
      ui.push(controls);
    }
    this.onlineLabel = this.online
      ? this.add
          .text(PITCH_MARGIN, GAME_HEIGHT - PITCH_MARGIN / 2 - 8, '', { fontFamily: 'sans-serif', fontSize: '15px', color: '#ffffff', backgroundColor: '#000000a0', padding: { x: 6, y: 3 } })
          .setOrigin(0, 0.5)
          .setDepth(30)
 : undefined;
    if (this.onlineLabel) ui.push(this.onlineLabel);
    this.netText = this.add
      .text(GAME_WIDTH - 8, GAME_HEIGHT - 8, '', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', backgroundColor: '#000000b0', padding: { x: 6, y: 4 } })
      .setOrigin(1, 1)
      .setDepth(40)
      .setVisible(false);
    ui.push(this.netText);
    // The camera can zoom and follow the ball, so the on-screen text lives on a second, fixed camera.
    const cam = this.cameras.main;
    cam.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
    const uiCam = this.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT);
    uiCam.ignore(world);
    cam.ignore(ui);
    sound.startCrowd();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => sound.stopCrowd());
    // F3 (captured, so the browser's find bar doesn't open) or N.
    this.input.keyboard?.addCapture('F3');
    const toggleNet = (): void => {
      this.debugNet = !this.debugNet;
    };
    this.input.keyboard?.on('keydown-F3', toggleNet);
    this.input.keyboard?.on('keydown-N', toggleNet);

    if (DEBUG_CLICK_KICK) {
      // Debug only, render-side: pokes the ball towards the pointer. Off by default (see config.ts).
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (this.driver.online) return;
        const { ball } = this.driver.state;
        const dx = pointer.worldX - ball.pos.x;
        const dy = pointer.worldY - ball.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        ball.vel.x = (dx / d) * DEBUG_KICK_SPEED;
        ball.vel.y = (dy / d) * DEBUG_KICK_SPEED;
      });
    }
  }

  private createDriver(difficulty?: Difficulty): MatchDriver {
    const online = this.online;
    const level = difficulty ?? settings.difficulty;
    const halfLength = this.halfLength;
    const rules = this.rules;
    if (online instanceof HostLobby) return new HostMatch({ localTeam: this.humanTeam, seed: this.seed, difficulty: level, halfLength, lobby: online, rules });
    if (online instanceof GuestLobby) return new GuestMatch(online, this.humanTeam, halfLength, this.seed, rules);
    return new HostMatch({ localTeam: this.aiVsAi ? null : this.humanTeam, seed: this.seed, difficulty: level, halfLength, rules });
  }

  /** Read-only access for the HUD. */
  getState(): GameState {
    return this.driver.state;
  }

  isOnline(): boolean {
    return this.driver.online;
  }

  /** Connection trouble / match ended online (drawn by the HUD), or null. */
  netOverlay(): NetOverlay | null {
    return this.driver.overlay(performance.now());
  }

  /** Offline "Rematch": a brand-new match. (Online, a rematch starts through the lobby when both players ask.) */
  restartMatch(): void {
    this.driver.restart();
  }

  stats(): MatchStats | null {
    return this.driver.stats();
  }

  rematch(): { mine: boolean; theirs: boolean } | null {
    return this.driver.rematch();
  }

  setRematch(want: boolean): void {
    this.driver.setRematch(want);
  }

  /** Is the match over for good (the other player left, or the connection was lost)? */
  isEnded(): boolean {
    return !!this.driver.overlay(performance.now())?.ended;
  }

  /** The pause menu. Offline it freezes the match. Online it can't: your friend is still playing, so the match keeps going and only your input is ignored. */
  openPause(): void {
    if (this.pauseOpen) return;
    this.pauseOpen = true;
    this.frozen = !this.driver.online;
    this.scene.launch('PauseScene', { online: this.driver.online });
  }

  closePause(): void {
    if (!this.pauseOpen) return;
    this.pauseOpen = false;
    this.frozen = false;
    this.scene.stop('PauseScene');
  }

  /** Leave the match (online: the other player is told) and go back to the title screen. */
  quit(): void {
    this.scene.start('MenuScene');
  }

  /** Local input for one tick: nothing while a menu is open (the keys belong to the menu then). */
  private sampleInput(): InputFrame {
    const frame = this.keyboard.sample();
    this.lastInput = this.pauseOpen || this.resultsShown ? { ...NEUTRAL_INPUT, seq: frame.seq } : frame;
    return this.lastInput;
  }

  /** Full time: after a moment, the results screen goes over the match; it closes itself when a new match starts. */
  private watchFullTime(dt: number): void {
    const over = this.driver.state.phase === 'full-time';
    if (!over) {
      this.fullTimeFor = 0;
      if (this.resultsShown) {
        this.resultsShown = false;
        this.scene.stop('ResultsScene');
      }
      return;
    }
    this.fullTimeFor += dt;
    if (!this.resultsShown && this.fullTimeFor >= RESULTS_DELAY) {
      this.closePause();
      this.resultsShown = true;
      this.scene.launch('ResultsScene');
    }
  }

  update(_time: number, delta: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, delta / 1000);
    if (!this.frozen) this.driver.advance(delta / 1000, () => this.sampleInput(), now);
    this.watchFullTime(delta / 1000);
    const state = this.driver.state;
    this.react(state, dt);
    this.effects.update(dt);
    this.updateCamera(state, dt);
    this.drawState(state);
    this.drawNets();
    this.drawEffects();
    this.drawOnlineStatus();
    this.netText.setVisible(this.debugNet);
    if (this.debugNet) this.netText.setText(this.driver.debugLines(now).join('\n'));
  }

  /**
   * Sounds and effects for what just happened. Everything is worked out from the drawn state alone (its new events and
   * the ball's motion), so the host, the offline game and the online guest all behave the same.
   */
  private react(state: GameState, dt: number): void {
    if (settings.volume !== this.lastVolume) {
      this.lastVolume = settings.volume;
      sound.applyVolume();
    }
    // A new match (ticks and event ids start again) forgets what it had handled.
    const restarted = state.tick < this.lastTick - 5;
    this.lastTick = state.tick;
    if (restarted) {
      this.detector.reset();
      this.effects.clear();
    }
    const scan = scanEvents(state.events, this.lastEventId, restarted);
    this.lastEventId = scan.lastId;
    for (const e of scan.fresh) this.onEvent(e, state);
    // Your own kicks always make a sound: queued (waiting for the ball), fired, or expired (it never got there).
    const mine = this.aiVsAi ? -1 : state.controlled[this.humanTeam];
    const me = mine >= 0 ? state.players[mine] : undefined;
    const kickCue = me ? this.kickCues.update(me.id, me.kickQueue > 0, me.kickFlash > 0) : null;
    if (kickCue === 'fired') {
      sound.kick(kickPower(Math.hypot(state.ball.vel.x, state.ball.vel.y)));
      this.detector.heard();
    } else if (kickCue === 'queued') sound.queued();
    else if (kickCue === 'expired') sound.whiff();
    const cue = this.detector.update(state.ball, dt, this.posts);
    if (cue) this.onBallCue(cue);
    this.excitementTimer -= dt;
    if (this.excitementTimer <= 0) {
      this.excitementTimer = 0.15;
      sound.setExcitement(crowdExcitement(state.ball.pos.x, Math.hypot(state.ball.vel.x, state.ball.vel.y), PITCH_LEFT, PITCH_RIGHT));
    }
    // Sliding players kick up dust.
    for (const p of state.players) {
      const speed = Math.hypot(p.vel.x, p.vel.y);
      if (p.tackleTimer > 0 && speed > 80 && Math.random() < 0.6) this.effects.dust(p.pos.x, p.pos.y, { x: p.vel.x / speed, y: p.vel.y / speed }, 0.2, 1);
    }
  }

  private onEvent(e: MatchEvent, state: GameState): void {
    const id = eventSound(e);
    if (id) sound.playId(id);
    if (e.type !== 'goal') return;
    // GOAL!: the net bulges, confetti flies, and a light shake and zoom punch.
    const { x, y } = state.ball.pos;
    this.effects.ripple(x, y, 1);
    const kit = e.team === undefined ? 0xffd23f : teamStyle(e.team).kit;
    this.effects.confetti(x, y, [kit, 0xffffff, 0xffd23f], FX_CONFETTI_COUNT);
    this.cameras.main.shake(FX_SHAKE_MS, FX_SHAKE_INTENSITY);
    this.zoomPunch = FX_ZOOM_PUNCH;
  }

  private onBallCue(cue: BallCue): void {
    if (cue.type === 'kick') {
      sound.kick(cue.power);
      if (cue.power > 0.2) this.effects.dust(cue.pos.x, cue.pos.y, cue.dir, cue.power);
    } else if (cue.type === 'post') {
      sound.post(cue.power);
    } else {
      sound.net(cue.power);
      this.effects.ripple(cue.pos.x, cue.pos.y, 0.3 + 0.7 * cue.power);
    }
  }

  /** Follows the ball (with look-ahead) when the pitch is drawn small or the setting says so, otherwise holds the whole pitch. */
  private updateCamera(state: GameState, dt: number): void {
    const mode = settings.camera;
    const scale = this.scale.displaySize.width / GAME_WIDTH;
    const follow = mode === 'follow' || (mode === 'auto' && scale < CAMERA_AUTO_MIN_SCALE);
    this.camZoom = approach(this.camZoom, follow ? CAMERA_FOLLOW_ZOOM : 1, CAMERA_ZOOM_SMOOTH, dt);
    const target = follow ? cameraTarget(state.ball) : { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
    this.camX = approach(this.camX, target.x, CAMERA_SMOOTH, dt);
    this.camY = approach(this.camY, target.y, CAMERA_SMOOTH, dt);
    this.zoomPunch = approach(this.zoomPunch, 0, 6, dt);
    const cam = this.cameras.main;
    cam.setZoom(this.camZoom * (1 + this.zoomPunch));
    cam.centerOn(this.camX, this.camY);
  }

  /** The goal nets: a mesh that ripples. Redrawn only while a ripple runs (and once more when it ends). */
  private drawNets(): void {
    if (!this.netsDirty && !this.effects.netsMoving) return;
    const g = this.netGfx;
    g.clear();
    for (const side of [-1, 1] as const) {
      const gw = this.driver.state.rules.goalWidth;
      const box = netBox(side, gw);
      g.fillStyle(0x000000, 0.2);
      g.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      const { cols, rows, pts } = netGrid(side, this.effects.ripples, gw);
      g.lineStyle(1, COLORS.goalNet, 0.5);
      for (let r = 0; r < rows; r++) {
        g.beginPath();
        g.moveTo(pts[r * cols].x, pts[r * cols].y);
        for (let c = 1; c < cols; c++) g.lineTo(pts[r * cols + c].x, pts[r * cols + c].y);
        g.strokePath();
      }
      for (let c = 0; c < cols; c++) {
        g.beginPath();
        g.moveTo(pts[c].x, pts[c].y);
        for (let r = 1; r < rows; r++) g.lineTo(pts[r * cols + c].x, pts[r * cols + c].y);
        g.strokePath();
      }
      g.lineStyle(LINE_THICKNESS, COLORS.line, 1);
      g.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    }
    this.netsDirty = this.effects.netsMoving;
  }

  private drawEffects(): void {
    const g = this.fxGfx;
    g.clear();
    for (const p of this.effects.particles) {
      const fade = 1 - p.age / p.life;
      g.fillStyle(p.color, p.alpha * (p.kind === 'dust' ? fade : Math.min(1, fade * 2)));
      if (p.kind === 'dust') g.fillCircle(p.x, p.y, p.size);
      else g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size * 0.6);
    }
  }

  private drawOnlineStatus(): void {
    if (!this.online || !this.onlineLabel) return;
    const v = this.online.view;
    const link =
      v.status === 'connected'
        ? `ping ${v.pingMs === null ? '…' : Math.round(v.pingMs)} ms`
        : v.status === 'reconnecting'
          ? 'reconnecting…'
          : `disconnected${v.error ? ` (${v.error.title.toLowerCase()})` : ''}`;
    this.onlineLabel.setText(`ONLINE · you are ${teamStyle(this.humanTeam).name} (${v.role}) · ${link} · F3: network info · Esc: menu`);
  }

  private createDebugOverlay(): void {
    this.debugGfx = this.add.graphics().setDepth(20);
    this.debugLabels.length = 0;
    const style = { fontFamily: 'monospace', fontSize: '11px', color: '#ffffff', backgroundColor: '#000000a0', padding: { x: 2, y: 1 } };
    for (let i = 0; i < this.driver.state.players.length; i++) {
      this.debugLabels.push(this.add.text(0, 0, '', style).setOrigin(0.5, 0).setDepth(21).setVisible(false));
    }
    this.debugTeams = this.add.text(8, 6, '', { ...style, fontSize: '13px' }).setDepth(21).setVisible(false);
    const toggle = (): void => {
      this.debugAi = !this.debugAi;
    };
    this.input.keyboard?.on('keydown-F2', toggle);
    this.input.keyboard?.on('keydown-BACKTICK', toggle);
  }

  /** Read-only: role, intent and target of every AI player, and each team's mode and counters. */
  private drawDebugOverlay(state: GameState): void {
    const g = this.debugGfx;
    g.clear();
    const on = this.debugAi;
    this.debugTeams.setVisible(on);
    // The guest's copy of the state has no AI memory: the AI only runs on the host.
    const guest = this.online?.view.role === 'guest';
    if (on && guest) this.debugTeams.setText('AI debug (F2) is only available on the host, where the AI runs');
    state.players.forEach((p, i) => {
      const label = this.debugLabels[i];
      label.setVisible(on && !guest);
      if (!on || guest) return;
      const m = state.ai.players[i];
      label.setText(`${ROLE_LABEL[roleOf(p)]} ${m.intent}`).setPosition(p.pos.x, p.pos.y + p.radius + 4);
      if (m.intent === 'human') return;
      g.lineStyle(1, teamStyle(p.team).kit, 0.9);
      g.lineBetween(p.pos.x, p.pos.y, m.target.x, m.target.y);
      g.strokeCircle(m.target.x, m.target.y, 4);
      if (m.intent === 'pass' || m.intent === 'shoot' || m.intent === 'clear' || m.intent === 'distribute') {
        g.lineStyle(2, 0xffff00, 0.8);
        g.lineBetween(state.ball.pos.x, state.ball.pos.y, m.kickTarget.x, m.kickTarget.y);
      }
    });
    if (on && !guest) {
      const t = state.ai.teams;
      const line = (i: 0 | 1): string =>
        `${teamStyle(i).name} [${state.ai.difficulty[i]}] ${t[i].mode.padEnd(13)} passes ${t[i].passes}  shots ${t[i].shots}  tackles ${t[i].tackles}  saves ${t[i].saves}`;
      this.debugTeams.setText(`${line(0)}\n${line(1)}\nAI debug (F2)`);
    }
  }

  /** Read-only: draws the given state. */
  private drawState(state: GameState): void {
    const g = this.dynamic;
    g.clear();
    g.fillStyle(0xffffff, 1);
    for (const post of this.posts) g.fillCircle(post.x, post.y, POST_RADIUS);
    for (const p of state.players) {
      this.drawPlayer(g, p, state.controlled[p.team] === p.id);
      this.shirtLabels[p.id]?.setPosition(p.pos.x, p.pos.y + 1);
    }
    for (const team of [0, 1] as const) {
      const cur = state.controlled[team] >= 0 ? state.players[state.controlled[team]] : undefined;
      const label = this.numberLabels[team];
      label.setVisible(!!cur);
      if (cur) label.setText(String(cur.number)).setPosition(cur.pos.x, cur.pos.y - cur.radius - 10);
    }
    this.drawDebugOverlay(state);
    this.drawRestartAim(g, state);
    this.drawAimLine(g, state);
    // Ball: a hard shot looks lifted: it grows a little and its shadow slides away and shrinks. (Drawing only: the sim is 2D.)
    const { ball } = state;
    const lift = ballLift(Math.hypot(ball.vel.x, ball.vel.y));
    const r = ball.radius * (1 + FX_LIFT_SCALE * lift);
    g.fillStyle(0x000000, 0.28 - 0.12 * lift);
    g.fillCircle(ball.pos.x + 2 + 6 * lift, ball.pos.y + 3 + 14 * lift, ball.radius * (1 - 0.2 * lift));
    const by = ball.pos.y - 9 * lift;
    g.fillStyle(0xffffff, 1);
    g.fillCircle(ball.pos.x, by, r);
    g.lineStyle(2, 0x222222, 1);
    g.strokeCircle(ball.pos.x, by, r);
  }

  /**
   * Your set piece (throw-in, corner, kickoff): an arrow from the ball where it will go, from your move keys and clamped
   * into the pitch as the sim will (sim/setpiece.ts), longer as a long throw / shot charges.
   */
  private drawRestartAim(g: Phaser.GameObjects.Graphics, state: GameState): void {
    const r = state.restart;
    if (this.aiVsAi || !r || r.team !== this.humanTeam || r.taker < 0 || r.taker !== state.controlled[this.humanTeam]) return;
    const taker = state.players[r.taker];
    const aim = restartAim(r, this.lastInput, taker.facing);
    const fx = Math.cos(aim);
    const fy = Math.sin(aim);
    const { x, y } = r.pos;
    const start = state.ball.radius + 6;
    const len = start + SET_PIECE_ARROW_LENGTH * (1 + Math.min(1, taker.charge / SHOT_MAX_CHARGE_TIME));
    g.lineStyle(4, SET_PIECE_ARROW_COLOR, 0.85);
    g.lineBetween(x + fx * start, y + fy * start, x + fx * (len - 10), y + fy * (len - 10));
    g.fillStyle(SET_PIECE_ARROW_COLOR, 0.85);
    g.fillTriangle(
      x + fx * len, y + fy * len,
      x + fx * (len - 14) - fy * 8, y + fy * (len - 14) + fx * 8,
      x + fx * (len - 14) + fy * 8, y + fy * (len - 14) - fx * 8,
    );
  }

  /**
   * Aim line (rules.aimLine, T15): while you charge a shot with the ball, inside shooting range, a dashed line shows
   * where it will go -- your move keys (else your facing) plus the aim assist, as the sim will strike it. Drawn from
   * your keys straight away, so the online guest sees it without lag.
   */
  private drawAimLine(g: Phaser.GameObjects.Graphics, state: GameState): void {
    const team = this.humanTeam;
    const id = state.controlled[team];
    if (this.aiVsAi || !state.rules.aimLine || id < 0 || state.phase !== 'playing') return;
    const p = state.players[id];
    if (!(this.lastInput.shoot || p.charge > 0) || pendingThrowIn(state)?.taker === id) return;
    const { ball } = state;
    const mine = state.possession ? state.possession.player === id : Math.hypot(ball.pos.x - p.pos.x, ball.pos.y - p.pos.y) <= p.radius + ball.radius + 10;
    if (!mine || !inShootingRange(state, team, ball.pos)) return;
    const keys = this.lastInput;
    const raw = Math.hypot(keys.moveX, keys.moveY) > 1e-6 ? Math.atan2(keys.moveY, keys.moveX) : p.facing;
    const aim = assistAim(state, team, ball.pos, raw);
    const goalX = attackedGoalX(state, team);
    const y = yAtGoalLine(ball.pos, aim, goalX);
    const len = y === null ? 140 : Math.min(600, Math.hypot(goalX - ball.pos.x, y - ball.pos.y));
    const fx = Math.cos(aim);
    const fy = Math.sin(aim);
    g.lineStyle(2, AIM_LINE_COLOR, AIM_LINE_ALPHA);
    for (let d = ball.radius + 4; d < len; d += 16) {
      const e = Math.min(len, d + 9);
      g.lineBetween(ball.pos.x + fx * d, ball.pos.y + fy * d, ball.pos.x + fx * e, ball.pos.y + fy * e);
    }
  }

  private drawPlayer(g: Phaser.GameObjects.Graphics, p: PlayerState, controlled: boolean): void {
    const { x, y } = p.pos;
    g.fillStyle(0x000000, 0.25);
    g.fillCircle(x + 2, y + 3, p.radius);
    const team = teamStyle(p.team);
    g.fillStyle(p.tackleTimer > 0 ? 0xffffff : p.role === 'keeper' ? team.keeper : team.kit, p.tackleTimer > 0 ? 0.75 : 1);
    g.fillCircle(x, y, p.radius);
    g.lineStyle(2, team.outline, 1);
    g.strokeCircle(x, y, p.radius);
    if (controlled) {
      g.lineStyle(3, CONTROL_RING_COLOR, 1);
      g.strokeCircle(x, y, p.radius + 5);
    }
    // Facing indicator: a line and a dot at the front edge.
    const fx = Math.cos(p.facing);
    const fy = Math.sin(p.facing);
    g.lineStyle(3, COLORS.playerFacing, 1);
    g.lineBetween(x, y, x + fx * p.radius, y + fy * p.radius);
    g.fillStyle(COLORS.playerFacing, 1);
    g.fillCircle(x + fx * p.radius * 0.75, y + fy * p.radius * 0.75, 3);
    // Kick queued (waiting for the ball): an amber ring closing in and an arrow where it will go.
    // Kick fired: a white ring bursting outwards.
    if (p.kickQueue > 0) {
      const f = Math.min(1, p.kickQueue / KICK_BUFFER_TIME);
      g.lineStyle(2, 0xffb020, 0.9);
      g.strokeCircle(x, y, p.radius + 4 + 8 * f);
      g.fillStyle(0xffb020, 0.9);
      const tip = p.radius + 16;
      g.fillTriangle(
        x + fx * tip, y + fy * tip,
        x + fx * (tip - 7) - fy * 5, y + fy * (tip - 7) + fx * 5,
        x + fx * (tip - 7) + fy * 5, y + fy * (tip - 7) - fx * 5,
      );
    }
    if (p.kickFlash > 0) {
      const f = 1 - p.kickFlash / KICK_FLASH_TIME;
      g.lineStyle(3, 0xffffff, 1 - f);
      g.strokeCircle(x, y, p.radius + 3 + 14 * f);
    }
    // Shot power bar under the player while charging (on the ball or not).
    if (p.charge > 0) {
      const w = 36;
      const h = 6;
      // (A long throw charges like the Classic shot; a shot takes the rules' charge time.)
      const full = pendingThrowIn(this.driver.state)?.taker === p.id ? SHOT_MAX_CHARGE_TIME : this.driver.state.rules.shotChargeTime;
      const frac = Math.min(1, p.charge / full);
      const bx = x - w / 2;
      const by = y + p.radius + 6;
      g.fillStyle(0x000000, 0.6);
      g.fillRect(bx - 1, by - 1, w + 2, h + 2);
      g.fillStyle(frac >= 1 ? 0xff4040 : 0xffd23f, 1);
      g.fillRect(bx, by, w * frac, h);
    }
  }

  /** Striped grass, markings and goal frames, drawn once. The nets are drawn separately (they ripple). */
  private drawPitch(): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    const left = PITCH_LEFT;
    const top = PITCH_TOP;
    const right = PITCH_RIGHT;
    const bottom = PITCH_BOTTOM;
    const midX = left + PITCH_WIDTH / 2;
    const midY = top + PITCH_HEIGHT / 2;

    // Grass: a darker surround, then mown stripes across the pitch.
    g.fillStyle(COLORS.grassSurround, 1);
    g.fillRect(0, 0, PITCH_WIDTH + PITCH_MARGIN * 2, PITCH_HEIGHT + PITCH_MARGIN * 2);
    const stripes = PITCH_STRIPES;
    const stripeW = PITCH_WIDTH / stripes;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle(i % 2 === 0 ? COLORS.grass : COLORS.grassStripe, 1);
      g.fillRect(left + i * stripeW, top, stripeW + 0.5, PITCH_HEIGHT);
    }

    // Lines
    g.lineStyle(LINE_THICKNESS, COLORS.line, 1);
    g.strokeRect(left, top, PITCH_WIDTH, PITCH_HEIGHT);
    g.lineBetween(midX, top, midX, bottom);
    g.strokeCircle(midX, midY, CENTRE_CIRCLE_RADIUS);
    g.fillStyle(COLORS.line, 1);
    g.fillCircle(midX, midY, 5);

    // Penalty boxes, penalty spots and the "D" arcs outside the boxes.
    const boxTop = midY - PENALTY_BOX_HEIGHT / 2;
    g.strokeRect(left, boxTop, PENALTY_BOX_WIDTH, PENALTY_BOX_HEIGHT);
    g.strokeRect(right - PENALTY_BOX_WIDTH, boxTop, PENALTY_BOX_WIDTH, PENALTY_BOX_HEIGHT);
    const spot = PENALTY_BOX_WIDTH * 0.7;
    g.fillCircle(left + spot, midY, 4);
    g.fillCircle(right - spot, midY, 4);
    const arc = 55;
    const span = Math.acos((PENALTY_BOX_WIDTH - spot) / arc);
    g.beginPath();
    g.arc(left + spot, midY, arc, -span, span);
    g.strokePath();
    g.beginPath();
    g.arc(right - spot, midY, arc, Math.PI - span, Math.PI + span);
    g.strokePath();
    // Corner arcs.
    const corner = 16;
    g.beginPath();
    g.arc(left, top, corner, 0, Math.PI / 2);
    g.strokePath();
    g.beginPath();
    g.arc(right, top, corner, Math.PI / 2, Math.PI);
    g.strokePath();
    g.beginPath();
    g.arc(left, bottom, corner, -Math.PI / 2, 0);
    g.strokePath();
    g.beginPath();
    g.arc(right, bottom, corner, Math.PI, Math.PI * 1.5);
    g.strokePath();
    return g;
  }
}
