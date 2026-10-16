// T24: the clubs data is valid, kit clashes are detected and resolved, and the clubs travel the protocol.
import { describe, expect, it } from 'vitest';
import { COLORS, KIT_CLASH_DELTA_E } from '../src/config';
import { CLUBS, clubsHash, UNOFFICIAL_NOTE } from '../src/data/clubs';
import { clubsMismatch, createLobbyState, decode, hello, PROTOCOL_VERSION } from '../src/net/protocol';
import {
  BIBS,
  CLUB_KITS,
  clashesWithGrass,
  clubPlayer,
  deltaE2000,
  deltaE76,
  isLook,
  KIT_COUNT,
  kitOf,
  outfieldKitsOk,
  randomOpponent,
  resolveLooks,
  shirtsClash,
  teamStyles,
} from '../src/teams';

const colourOk = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 0xffffff;
const idx = (code: string): number => CLUBS.findIndex((c) => c.code === code);
const ARS = idx('ARS');
const MUN = idx('MUN');
const LIV = idx('LIV');

describe('clubs data', () => {
  it('has the 20 clubs, with unique names and codes', () => {
    expect(CLUBS).toHaveLength(20);
    expect(new Set(CLUBS.map((c) => c.name)).size).toBe(20);
    expect(new Set(CLUBS.map((c) => c.code)).size).toBe(20);
    expect(new Set(CLUBS.map((c) => c.short)).size).toBe(20);
  });

  it.each(CLUBS.map((c) => [c.code, c] as const))('%s: names, kits and a valid squad of 5', (_code, c) => {
    expect(c.short.length).toBeGreaterThan(0);
    expect(c.short.length).toBeLessThanOrEqual(12);
    expect(c.code).toMatch(/^[A-Z]{3}$/);
    expect(c.kits).toHaveLength(CLUB_KITS);
    for (const kit of [...c.kits, c.gk]) for (const v of [kit.shirt, kit.trim, kit.number]) expect(colourOk(v)).toBe(true);
    expect(c.players).toHaveLength(5);
    expect(c.players.filter((p) => p.role === 'GK')).toHaveLength(1);
    expect(c.players[0].role).toBe('GK');
    expect(c.players.slice(1, 3).every((p) => p.role === 'DEF' || p.role === 'MID')).toBe(true);
    expect(c.players.slice(3).every((p) => p.role === 'FWD')).toBe(true);
    expect(new Set(c.players.map((p) => p.number)).size).toBe(5);
    for (const p of c.players) {
      expect(p.name.trim()).not.toBe('');
      expect(Number.isInteger(p.number) && p.number >= 1 && p.number <= 99).toBe(true);
    }
  });

  it('is cosmetic only: no ratings, crests or sponsors in the data', () => {
    for (const c of CLUBS) expect(Object.keys(c).sort()).toEqual(['code', 'gk', 'kits', 'name', 'players', 'short']);
    expect(UNOFFICIAL_NOTE).toMatch(/Unofficial fan game/);
  });

  it('maps a squad onto the formation slots', () => {
    expect(clubPlayer(ARS, 0).role).toBe('GK');
    expect(clubPlayer(ARS, 4)).toBe(CLUBS[ARS].players[4]);
    expect(clubPlayer(ARS, 9)).toBe(CLUBS[ARS].players[4]); // out of range: clamped
  });

  it('has a stable hash', () => {
    expect(clubsHash()).toMatch(/^[0-9a-f]{8}$/);
    expect(clubsHash()).toBe(clubsHash());
  });
});

describe('colour difference', () => {
  it('is 0 for the same colour and large for opposites', () => {
    expect(deltaE2000(0xff0000, 0xff0000)).toBe(0);
    expect(deltaE2000(0x000000, 0xffffff)).toBeGreaterThan(90);
    expect(deltaE76(0x000000, 0xffffff)).toBeCloseTo(100, 0);
  });

  it('ranks similar colours low and different ones high', () => {
    expect(deltaE2000(0xda291c, 0xe2231a)).toBeLessThan(5); // two reds
    expect(deltaE2000(0xda291c, 0x1f3f9e)).toBeGreaterThan(35); // red vs blue
  });

  it('is symmetric', () => {
    expect(deltaE2000(0x2a6fdb, 0xd9372b)).toBeCloseTo(deltaE2000(0xd9372b, 0x2a6fdb), 6);
  });
});

describe('kit clash detection', () => {
  it('flags near-identical shirts and the grass', () => {
    expect(shirtsClash(0xda291c, 0xe2231a)).toBe(true);
    expect(shirtsClash(0xda291c, 0x1f3f9e)).toBe(false);
    expect(clashesWithGrass(COLORS.grass)).toBe(true);
    expect(clashesWithGrass(0x2f8c3e)).toBe(true);
    expect(clashesWithGrass(0xffffff)).toBe(false);
    expect(KIT_CLASH_DELTA_E).toBeGreaterThan(10);
  });

  it('the same club in the same kit clashes with itself', () => {
    expect(outfieldKitsOk({ club: ARS, kit: 0 }, { club: ARS, kit: 0 })).toBe(false);
  });

  it('red clubs clash with each other (Arsenal v Man United home) but not with a blue kit', () => {
    expect(outfieldKitsOk({ club: ARS, kit: 0 }, { club: MUN, kit: 0 })).toBe(false);
    expect(outfieldKitsOk({ club: ARS, kit: 0 }, { club: MUN, kit: 1 })).toBe(true);
  });
});

describe('kit clash resolution', () => {
  it('leaves a guest alone when nothing clashes', () => {
    const r = resolveLooks({ club: ARS, kit: 0 }, { club: MUN, kit: 1 });
    expect(r.looks).toEqual([{ club: ARS, kit: 0 }, { club: MUN, kit: 1 }]);
    expect(r.changed).toEqual([false, false]);
  });

  it('moves the guest (never the host) to another kit when they clash', () => {
    const r = resolveLooks({ club: ARS, kit: 0 }, { club: MUN, kit: 0 });
    expect(r.looks[0]).toEqual({ club: ARS, kit: 0 });
    expect(r.looks[1].club).toBe(MUN);
    expect(r.looks[1].kit).not.toBe(0);
    expect(r.changed).toEqual([false, true]);
  });

  it('the same club, home v home: the guest goes to its next kit', () => {
    const r = resolveLooks({ club: LIV, kit: 0 }, { club: LIV, kit: 0 });
    expect(r.looks[1].club).toBe(LIV);
    expect(r.looks[1].kit).not.toBe(0);
    expect(r.changed[1]).toBe(true);
  });

  it('every pair of clubs and kits ends up clearly different, off the grass, with different keepers', () => {
    for (let a = 0; a < CLUBS.length; a++) {
      for (let b = 0; b < CLUBS.length; b++) {
        for (let ka = 0; ka < CLUB_KITS; ka++) {
          for (let kb = 0; kb < CLUB_KITS; kb++) {
            const r = resolveLooks({ club: a, kit: ka }, { club: b, kit: kb });
            expect(r.looks[1].club).toBe(b);
            expect(outfieldKitsOk(r.looks[0], r.looks[1])).toBe(true);
            const [x, y] = teamStyles(r.looks);
            for (const keeper of [x.keeper, y.keeper]) {
              expect(clashesWithGrass(keeper)).toBe(false);
              expect(shirtsClash(keeper, x.kit)).toBe(false);
              expect(shirtsClash(keeper, y.kit)).toBe(false);
            }
            expect(shirtsClash(x.keeper, y.keeper)).toBe(false);
          }
        }
      }
    }
  });

  it('has bibs as the last resort, all valid looks', () => {
    expect(BIBS.length).toBeGreaterThan(0);
    for (let i = 0; i < BIBS.length; i++) {
      expect(isLook({ club: 0, kit: CLUB_KITS + i })).toBe(true);
      expect(kitOf({ club: 0, kit: CLUB_KITS + i }).shirt).toBe(BIBS[i].shirt);
    }
    expect(BIBS.some((b) => !clashesWithGrass(b.shirt))).toBe(true);
  });

  it('moves a host kit that disappears into the grass (Everton third) to another kit', () => {
    const r = resolveLooks({ club: idx('EVE'), kit: 2 }, { club: ARS, kit: 0 });
    expect(r.changed[0]).toBe(true);
    expect(clashesWithGrass(kitOf(r.looks[0]).shirt)).toBe(false);
  });

  it('offline: a random opponent is another club, in a kit that does not clash', () => {
    for (let i = 0; i < 60; i++) {
      const mine = { club: i % CLUBS.length, kit: i % CLUB_KITS };
      const opp = randomOpponent(mine, () => (i * 0.137) % 1);
      expect(opp.club).not.toBe(mine.club);
      expect(outfieldKitsOk(resolveLooks(mine, mine).looks[0], opp)).toBe(true);
    }
  });
});

describe('clubs in the protocol', () => {
  it('only accepts valid club and kit indices', () => {
    expect(isLook({ club: 0, kit: 0 })).toBe(true);
    expect(isLook({ club: 19, kit: KIT_COUNT - 1 })).toBe(true);
    for (const bad of [{ club: 20, kit: 0 }, { club: -1, kit: 0 }, { club: 0, kit: KIT_COUNT }, { club: 0.5, kit: 0 }, { club: '1', kit: 0 }, { name: 0, kit: 0 }, null, 5]) expect(isLook(bad)).toBe(false);
  });

  it('round-trips a lobby with looks and the changed flags, and a look message', () => {
    const lobby = { ...createLobbyState('H', 'G', { club: 3, kit: 0 }, { club: 3, kit: 1 }), changed: [false, true] as [boolean, boolean] };
    const msg = { t: 'lobby', lobby } as const;
    expect(decode(JSON.parse(JSON.stringify(msg)))).toEqual(msg);
    const look = { t: 'look', look: { club: 7, kit: 2 } } as const;
    expect(decode(JSON.parse(JSON.stringify(look)))).toEqual(look);
  });

  it('puts the clubs hash in the handshake and gives a clear refresh message on a mismatch', () => {
    const h = hello('Guest');
    expect(h.protocol).toBe(PROTOCOL_VERSION);
    expect(decode(h)).toEqual(h);
    expect(h.clubs).toBe(clubsHash());
    expect(clubsMismatch(clubsHash(), 'host')).toBeNull();
    expect(clubsMismatch('deadbeef', 'host')).toMatch(/refresh/i);
    expect(clubsMismatch(undefined, 'guest')).toMatch(/refresh/i);
  });
});
