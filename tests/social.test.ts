// T21: name sanitising, quick chat limits, the series score, man of the match and the per-player stats.
import { describe, expect, it } from 'vitest';
import { ASSIST_WINDOW, EMOTE_BUBBLE_MS, EMOTE_MAX_PER_WINDOW, EMOTE_MIN_GAP_MS, EMOTE_WINDOW_MS, NAME_MAX_LENGTH, SIM_DT, SIM_HZ } from '../src/config';
import { manOfTheMatch, mvpScore, tallyText } from '../src/matchStats';
import { QuickChat } from '../src/net/chat';
import { decode } from '../src/net/protocol';
import { cloneState, createMatchState, step } from '../src/sim/simulation';
import { emptyTally, trackStats } from '../src/sim/playerStats';
import type { GameState, PlayerTally } from '../src/sim/types';
import { settings as defaults, sanitizeSettings } from '../src/settings';
import {
  ChatFeed,
  emoteForKey,
  emptySeries,
  EmoteLimiter,
  isEmoteId,
  nameOr,
  QUICK_CHAT,
  sanitizeName,
  seriesAfter,
  seriesPlayed,
  seriesText,
  uniqueName,
} from '../src/social';

describe('player names', () => {
  it('keeps ordinary names, trimming and collapsing spaces', () => {
    expect(sanitizeName('Kevin')).toBe('Kevin');
    expect(sanitizeName('  Ana   María  ')).toBe('Ana María');
    expect(sanitizeName('J. R-R_Tolkien')).toBe('J. R-R_Tolkien');
    expect(sanitizeName('Zoë 7')).toBe('Zoë 7');
  });

  it('strips markup, quotes, control characters, emoji and other symbols', () => {
    expect(sanitizeName('<script>alert(1)</script>')).toBe('scriptalert1scri'); // (cut to the limit)
    expect(sanitizeName('a"b\'c`d&e\\f/g;h')).toBe('abcdefgh');
    expect(sanitizeName('a\tb\nc\u0000d‮e')).toBe('a b cde');
    expect(sanitizeName('Goal ⚽ 🔥 star★')).toBe('Goal star');
    expect(sanitizeName('{{name}} ${x} %s')).toBe('name x s');
  });

  it('limits the length (counting characters, not code units) and never leaves a trailing space', () => {
    expect(sanitizeName('x'.repeat(100)).length).toBe(NAME_MAX_LENGTH);
    expect(Array.from(sanitizeName('𝐀'.repeat(40)))).toHaveLength(NAME_MAX_LENGTH); // NFKC turns these into plain letters
    const cut = sanitizeName(`${'a'.repeat(NAME_MAX_LENGTH - 1)} bbbb`);
    expect(cut).toBe('a'.repeat(NAME_MAX_LENGTH - 1));
    expect(sanitizeName('abcdefgh ijkl', 5)).toBe('abcde');
  });

  it('turns anything that is not a string into an empty name, and falls back to a default', () => {
    for (const v of [undefined, null, 5, {}, [], true]) expect(sanitizeName(v)).toBe('');
    expect(sanitizeName('🔥🔥🔥')).toBe('');
    expect(nameOr('', 'Guest')).toBe('Guest');
    expect(nameOr('  <>  ', 'Host')).toBe('Host');
    expect(nameOr('Sam', 'Guest')).toBe('Sam');
  });

  it('gives the guest a different name when it matches the host (ignoring case)', () => {
    expect(uniqueName('Sam', 'Kev')).toBe('Sam');
    expect(uniqueName('sam', 'Sam')).toBe('sam 2');
    const long = 'x'.repeat(NAME_MAX_LENGTH);
    const unique = uniqueName(long, long);
    expect(unique).not.toBe(long);
    expect(unique.length).toBeLessThanOrEqual(NAME_MAX_LENGTH);
  });

  it('cleans a saved name when the settings load, and defaults to none', () => {
    expect(sanitizeSettings({ playerName: '<b>Kev</b>' }).playerName).toBe('bKevb');
    expect(sanitizeSettings({ playerName: 42 }).playerName).toBe('');
    expect(sanitizeSettings(null).playerName).toBe('');
    expect(sanitizeSettings({ muteChat: 'yes' }).muteChat).toBe(false);
    expect(defaults.playerName).toBeTypeOf('string');
  });

  it('is bounded on the wire: a huge name is refused by the protocol (what arrives is cleaned again on receipt)', () => {
    expect(decode({ t: 'hello', protocol: 8, game: '1.6.0', name: 'x'.repeat(300) })).toBeNull();
    expect(decode({ t: 'hello', protocol: 8, game: '1.6.0', name: 'Sam' })).not.toBeNull();
  });
});

describe('quick chat', () => {
  it('has six presets, on the keys 1-6 (top row and numpad)', () => {
    expect(QUICK_CHAT).toHaveLength(6);
    expect(QUICK_CHAT[0]).toBe('Nice goal!');
    expect(QUICK_CHAT[5]).toBe('GG');
    expect([1, 2, 3, 4, 5, 6].map((n) => emoteForKey(`Digit${n}`))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(emoteForKey('Numpad4')).toBe(3);
    for (const k of ['Digit0', 'Digit7', 'KeyA', 'Space', '']) expect(emoteForKey(k)).toBe(-1);
    expect(isEmoteId(5)).toBe(true);
    for (const v of [6, -1, 1.2, '1', null]) expect(isEmoteId(v)).toBe(false);
  });

  it('rate-limits: a gap between messages and a cap per window', () => {
    const limiter = new EmoteLimiter();
    expect(limiter.allow(0)).toBe(true);
    expect(limiter.allow(EMOTE_MIN_GAP_MS - 1)).toBe(false); // too soon
    let t = EMOTE_MIN_GAP_MS;
    let allowed = 1;
    while (t < EMOTE_WINDOW_MS - 1) {
      if (limiter.allow(t)) allowed++;
      t += EMOTE_MIN_GAP_MS;
    }
    expect(allowed).toBe(EMOTE_MAX_PER_WINDOW); // the cap, not one per gap
    expect(limiter.allow(EMOTE_WINDOW_MS + 1)).toBe(true); // the window has moved on
  });

  it('shows a message to its sender at once and sends it, within the limit', () => {
    const sent: unknown[] = [];
    const link = { isOpen: true, send: (m: unknown) => sent.push(m) } as never;
    const chat = new QuickChat('host');
    expect(chat.send(0, link, 1000)).toBe(true);
    expect(chat.send(1, link, 1100)).toBe(false);
    expect(chat.send(9, link, 5000)).toBe(false); // not a message
    expect(chat.send(2, null, 6000)).toBe(false); // nobody to send to
    expect(sent).toEqual([{ t: 'emote', id: 0 }]);
    expect(chat.feed.bubble('host', 1000)?.emote).toBe(0);
  });

  it("drops the other player's messages when muted or sent too fast, and shows them otherwise", () => {
    const chat = new QuickChat('guest');
    chat.receive(1, 0);
    expect(chat.feed.bubble('host', 10)?.emote).toBe(1);
    chat.receive(2, 100); // a modified client ignoring its limit
    expect(chat.feed.bubble('host', 110)?.emote).toBe(1);
    chat.muted = true;
    chat.receive(3, 5000);
    expect(chat.feed.bubble('host', 5010)?.emote).not.toBe(3);
    chat.muted = false;
    chat.receive(4, 9000);
    expect(chat.feed.bubble('host', 9010)?.emote).toBe(4);
  });

  it('keeps bubbles short-lived and the feed to the last few lines', () => {
    const feed = new ChatFeed();
    feed.push('host', 0, 0);
    expect(feed.bubble('host', EMOTE_BUBBLE_MS - 1)?.emote).toBe(0);
    expect(feed.bubble('host', EMOTE_BUBBLE_MS + 1)).toBeNull();
    expect(feed.bubble('guest', 0)).toBeNull();
    for (let i = 0; i < 10; i++) feed.push(i % 2 ? 'guest' : 'host', i % 6, 100 + i);
    expect(feed.feed(200).length).toBeLessThanOrEqual(4);
    expect(feed.feed(100000)).toEqual([]);
  });
});

describe('series score', () => {
  it('counts a win for whichever player won, whichever team they were on', () => {
    let s = emptySeries();
    s = seriesAfter(s, 0, [2, 1]); // host was home, home won
    s = seriesAfter(s, 1, [0, 3]); // teams swapped: host away, away won -> host
    s = seriesAfter(s, 0, [1, 2]); // guest wins
    expect(s).toEqual({ host: 2, guest: 1, draws: 0 });
    expect(seriesPlayed(s)).toBe(3);
  });

  it('counts a draw, unless a penalty shoot-out decided it', () => {
    let s = seriesAfter(emptySeries(), 0, [1, 1]);
    expect(s).toEqual({ host: 0, guest: 0, draws: 1 });
    s = seriesAfter(s, 0, [2, 2], -1);
    expect(s.draws).toBe(2);
    s = seriesAfter(s, 0, [2, 2], 0); // home won on penalties, host was home
    expect(s).toEqual({ host: 1, guest: 0, draws: 2 });
    s = seriesAfter(s, 1, [0, 0], 0); // home won on penalties, but the host was away
    expect(s).toEqual({ host: 1, guest: 1, draws: 2 });
    expect(seriesAfter(emptySeries(), 0, [0, 0], undefined).draws).toBe(1);
  });

  it('does not change the series it was given', () => {
    const s = emptySeries();
    seriesAfter(s, 0, [1, 0]);
    expect(s).toEqual({ host: 0, guest: 0, draws: 0 });
  });

  it('reads "Series 3–2" from the viewer\'s side, empty before the first match', () => {
    expect(seriesText(emptySeries(), 'host')).toBe('');
    const s = { host: 3, guest: 2, draws: 0 };
    expect(seriesText(s, 'host')).toBe('Series 3–2');
    expect(seriesText(s, 'guest')).toBe('Series 2–3');
    expect(seriesText({ ...s, draws: 1 }, 'host', ['Kev', 'Sam'])).toBe('Series 3–2 · 1 drawn (Kev – Sam)');
  });
});

const tally = (t: Partial<PlayerTally>): PlayerTally => ({ ...emptyTally(), ...t });

describe('man of the match', () => {
  const team = (id: number): 0 | 1 => (id < 5 ? 0 : 1);
  const players = (list: Partial<PlayerTally>[]): { players: PlayerTally[] } => ({ players: list.map(tally) });

  it('weighs goals above assists above saves above tackles', () => {
    expect(mvpScore(tally({ goals: 1 }))).toBeGreaterThan(mvpScore(tally({ assists: 1 })));
    expect(mvpScore(tally({ assists: 1 }))).toBeGreaterThan(mvpScore(tally({ saves: 1 })));
    expect(mvpScore(tally({ saves: 1 }))).toBeGreaterThan(mvpScore(tally({ tackles: 1 })));
    expect(mvpScore(tally({}))).toBe(0);
  });

  it('picks the player with the most points', () => {
    const stats = players([{ goals: 1 }, { tackles: 3 }, {}, { assists: 1, saves: 1 }, {}, { goals: 2 }]);
    expect(manOfTheMatch(stats, team)).toEqual({ player: 5, points: mvpScore(tally({ goals: 2 })) });
  });

  it('can be a keeper with a lot of saves', () => {
    const stats = players([{ saves: 6 }, { goals: 1 }]);
    expect(manOfTheMatch(stats, team)?.player).toBe(0);
  });

  it('breaks a tie for the winning side, then the lower id; nobody if nobody did anything', () => {
    const tied = players([{ goals: 1 }, {}, {}, {}, {}, { goals: 1 }]);
    expect(manOfTheMatch(tied, team, 1)?.player).toBe(5);
    expect(manOfTheMatch(tied, team, 0)?.player).toBe(0);
    expect(manOfTheMatch(tied, team, -1)?.player).toBe(0);
    expect(manOfTheMatch(players([{}, {}]), team)).toBeNull();
    expect(manOfTheMatch(players([]), team)).toBeNull();
  });

  it('describes a stat line, leaving out zeros', () => {
    expect(tallyText(tally({ goals: 2, assists: 1, saves: 3, tackles: 1, shots: 5 }))).toBe('2 goals · 1 assist · 3 saves · 1 tackle · 5 shots');
    expect(tallyText(tally({ tackles: 2 }))).toBe('2 tackles');
    expect(tallyText(tally({}))).toBe('no stats');
  });
});

/** The next tick of `prev`, changed by `change`, then watched by the stats tracker (as step() does). */
function tick(prev: GameState, change: (next: GameState) => void = () => {}): GameState {
  const next = cloneState(prev);
  next.tick = prev.tick + 1;
  change(next);
  trackStats(prev, next);
  return next;
}

const touch = (id: number) => (s: GameState): void => {
  s.lastTouch = { team: s.players[id].team, player: id };
};

/** A match in open play. Players 0-4 are team 0 (0 = keeper), 5-9 team 1 (5 = keeper). */
function openPlay(): GameState {
  const s = createMatchState({ aiVsAi: true, seed: 1 });
  s.phase = 'playing';
  return s;
}

const goal = (scorer: number, ownGoal = false) => (s: GameState): void => {
  const team = ownGoal ? (1 - s.players[scorer].team) : s.players[scorer].team;
  s.stats.goals.push({ team: team as 0 | 1, player: scorer, ownGoal, half: 1, clock: 10 });
  s.score[team] += 1;
};

describe('per-player stats', () => {
  it('credits the goal to the scorer and the assist to the teammate who touched it before', () => {
    let s = openPlay();
    s = tick(s, touch(2));
    s = tick(s, touch(3));
    s = tick(s, goal(3));
    expect(s.stats.players[3].goals).toBe(1);
    expect(s.stats.players[2].assists).toBe(1);
    expect(s.stats.players[3].assists).toBe(0);
  });

  it('gives no assist when the earlier touch was an opponent, was too long ago, or the goal was an own goal or a penalty', () => {
    let s = tick(tick(openPlay(), touch(7)), touch(3));
    s = tick(s, goal(3));
    expect(s.stats.players.reduce((n, p) => n + p.assists, 0)).toBe(0);

    s = tick(tick(openPlay(), touch(2)), touch(3));
    for (let i = 0; i < (ASSIST_WINDOW + 1) * SIM_HZ; i++) s = tick(s);
    s = tick(s, goal(3));
    expect(s.stats.players[3].goals).toBe(1);
    expect(s.stats.players.reduce((n, p) => n + p.assists, 0)).toBe(0);

    s = tick(tick(openPlay(), touch(2)), touch(3));
    s = tick(s, goal(3, true));
    expect(s.stats.players[3].goals).toBe(0); // an own goal is nobody's goal
    expect(s.stats.players.reduce((n, p) => n + p.assists, 0)).toBe(0);

    s = tick(tick(openPlay(), touch(2)), touch(3));
    s.penalty = { team: 0, taker: 3, keeper: 5, timer: 0.2, keeperTouched: false, shootout: false };
    s = tick(s, goal(3));
    expect(s.stats.players[3].goals).toBe(1);
    expect(s.stats.players[2].assists).toBe(0);
  });

  it('gives the scorer no assist from their own earlier touches', () => {
    let s = tick(openPlay(), touch(3));
    s = tick(s, touch(3));
    s = tick(s, goal(3));
    expect(s.stats.players[3].assists).toBe(0);
  });

  it('counts a shot, and a save when the other keeper touches it while it is live', () => {
    let s = openPlay();
    s = tick(s, (n) => {
      touch(4)(n);
      n.stats.shots[0] += 1;
    });
    expect(s.stats.players[4].shots).toBe(1);
    s = tick(s, touch(5));
    expect(s.stats.players[5].saves).toBe(1);
    // The same ball touched again by the keeper is not a second save.
    s = tick(s, touch(6));
    s = tick(s, touch(5));
    expect(s.stats.players[5].saves).toBe(1);
  });

  it('is not a save when an outfield player blocks it, when the shooter\'s own keeper touches it, or when it goes in', () => {
    let s = openPlay();
    s = tick(s, (n) => {
      touch(4)(n);
      n.stats.shots[0] += 1;
    });
    s = tick(s, touch(8)); // a block by an outfield player
    s = tick(s, touch(5));
    expect(s.stats.players.reduce((n, p) => n + p.saves, 0)).toBe(0);

    s = tick(openPlay(), (n) => {
      touch(4)(n);
      n.stats.shots[0] += 1;
    });
    s = tick(s, touch(0)); // the shooter's own keeper
    expect(s.stats.players.reduce((n, p) => n + p.saves, 0)).toBe(0);

    s = tick(openPlay(), (n) => {
      touch(4)(n);
      n.stats.shots[0] += 1;
    });
    s = tick(s, goal(4));
    s = tick(s, touch(5));
    expect(s.stats.players.reduce((n, p) => n + p.saves, 0)).toBe(0);
  });

  it('counts a tackle won when an opponent takes the ball from the carrier, but not an interception', () => {
    let s = openPlay();
    s = tick(s, (n) => {
      touch(2)(n);
      n.possession = { player: 2, angle: 0, roll: 0 };
    });
    s = tick(s, (n) => {
      touch(7)(n);
      n.possession = null;
    });
    expect(s.stats.players[7].tackles).toBe(1);

    s = tick(openPlay(), touch(2)); // a pass in flight: nobody carries it
    s = tick(s, touch(7));
    expect(s.stats.players[7].tackles).toBe(0);

    s = tick(openPlay(), (n) => {
      touch(2)(n);
      n.possession = { player: 2, angle: 0, roll: 0 };
    });
    s = tick(s, touch(3)); // a teammate: not a tackle
    expect(s.stats.players[3].tackles).toBe(0);
  });

  it("also credits the team's human, but only for what they did while controlling that player", () => {
    let s = openPlay();
    s.controlled = [3, -1];
    s = tick(s, touch(2));
    s = tick(s, touch(3));
    s = tick(s, goal(3));
    expect(s.stats.humans[0].goals).toBe(1);
    expect(s.stats.humans[1].goals).toBe(0);
    s.controlled = [1, -1]; // switched to another player
    s = tick(s, touch(4));
    s = tick(s, (n) => {
      touch(4)(n);
      n.stats.shots[0] += 1;
    });
    expect(s.stats.players[4].shots).toBe(1);
    expect(s.stats.humans[0].shots).toBe(0);
  });

  it('adds up to the match statistics over a whole simulated match', () => {
    let s = createMatchState({ aiVsAi: true, seed: 11 });
    for (let i = 0; i < 4 * 60 * SIM_HZ; i++) s = step(s, [undefined, undefined], SIM_DT);
    const { stats } = s;
    expect(stats.players).toHaveLength(10);
    const sum = (k: keyof PlayerTally): number => stats.players.reduce((n, p) => n + p[k], 0);
    expect(sum('goals')).toBe(stats.goals.filter((g) => !g.ownGoal && g.player >= 0).length);
    expect(sum('shots')).toBe(stats.shots[0] + stats.shots[1]);
    expect(sum('assists')).toBeLessThanOrEqual(sum('goals'));
    expect(sum('tackles')).toBeGreaterThan(0);
    expect(sum('saves')).toBeGreaterThan(0);
    expect(stats.humans.every((h) => Object.values(h).every((n) => n === 0))).toBe(true); // nobody was a human
    expect(manOfTheMatch(stats, (id) => s.players[id].team)).not.toBeNull();
  });
});
