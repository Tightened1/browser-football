// The clubs of the game (T24): Premier League 2026-27, their kit colours and a fixed 5-a-side squad each.
// PURE DATA: no Phaser, no DOM. Edit it by hand to correct a name, number or colour (see docs/UPDATING_SQUADS.md);
// swap the names for made-up ones if you ever want to. Colours and text only: no crests, badges, logos or sponsors.
//
// Researched 2026-10-16 (after the summer 2026 window). The 20 clubs are the 2026-27 Premier League (Wikipedia
// "2026-27 Premier League": the promoted clubs are Coventry City, Hull City and Ipswich Town).
// Sources: squads and numbers from Wikipedia club / season pages (squad tables dated Sep-Oct 2026), the clubs' own
// squad-number announcements (Brentford; Arsenal via footyheadlines) and starting11.com; kits from footyheadlines.com,
// footballfashion.org, goal.com, club kit launch pages (liverpoolfc.com, chelseafc.com) and press reports.
// No source gives exact colour values, so every hex below is an ESTIMATE from the kit descriptions; some third kits
// were leaks or teasers and most goalkeeper kits were not found (those are plausible stand-ins). Clubs are cosmetic:
// every club plays identically.
//
// Each squad lists the 5 in the game's formation slots: [0] goalkeeper, [1] and [2] the back line (DEF or MID),
// [3] and [4] the front line (FWD). `role` is for display only.

export type PlayerRole = 'GK' | 'DEF' | 'MID' | 'FWD';

/** Shirt colour, secondary (trim / outline) colour and number colour, as 0xRRGGBB. */
export interface KitColours {
  shirt: number;
  trim: number;
  number: number;
}

export interface ClubPlayer {
  /** Display name: the surname, or the name the player is known by. */
  name: string;
  /** Real shirt number. */
  number: number;
  role: PlayerRole;
}

export interface Club {
  name: string;
  /** For the HUD: at most 12 characters. */
  short: string;
  /** Three capital letters. */
  code: string;
  /** Home, away, third. */
  kits: [KitColours, KitColours, KitColours];
  gk: KitColours;
  /** [GK, back, back, front, front]. */
  players: [ClubPlayer, ClubPlayer, ClubPlayer, ClubPlayer, ClubPlayer];
}

const k = (shirt: number, trim: number, number: number): KitColours => ({ shirt, trim, number });
const p = (role: PlayerRole, name: string, number: number): ClubPlayer => ({ name, number, role });

/** Shown on the title screen, the picker and in the README. */
export const UNOFFICIAL_NOTE = 'Unofficial fan game, not affiliated with the Premier League or any club';

export const CLUBS_SEASON = '2026-27';
export const CLUBS_RESEARCHED = '2026-10-16';

export const CLUBS: readonly Club[] = [
  { name: 'Arsenal', short: 'Arsenal', code: 'ARS',
    kits: [k(0xef0107, 0x7a0a1e, 0xffffff), k(0x0b1a3a, 0xffd400, 0xffd400), k(0xf3e9a8, 0x0b1a3a, 0x0b1a3a)],
    gk: k(0x2e8b57, 0x111111, 0xffffff),
    players: [p('GK', 'Raya', 1), p('MID', 'Rice', 41), p('MID', 'Ødegaard', 8), p('FWD', 'Saka', 7), p('FWD', 'Gyökeres', 14)] },
  { name: 'Aston Villa', short: 'Aston Villa', code: 'AVL',
    kits: [k(0x7a003c, 0x95bfe5, 0x95bfe5), k(0x111111, 0xffd400, 0xffd400), k(0xa9d4f5, 0x7a003c, 0x7a003c)],
    gk: k(0xf28c28, 0x111111, 0x111111),
    players: [p('GK', 'Suzuki', 1), p('MID', 'Kamara', 8), p('MID', 'McGinn', 7), p('FWD', 'Jackson', 11), p('FWD', 'Garnacho', 17)] },
  { name: 'AFC Bournemouth', short: 'Bournemouth', code: 'BOU',
    kits: [k(0xd6001c, 0x111111, 0xffffff), k(0x6b2c91, 0xffffff, 0xffffff), k(0xf2ebd9, 0x14213d, 0x14213d)],
    gk: k(0x1fa8a0, 0x111111, 0x111111),
    players: [p('GK', 'Petrović', 1), p('MID', 'Tavernier', 16), p('MID', 'Christie', 10), p('FWD', 'Evanilson', 9), p('FWD', 'Doak', 11)] },
  { name: 'Brentford', short: 'Brentford', code: 'BRE',
    kits: [k(0xe30613, 0xffffff, 0xffffff), k(0x14213d, 0xf3ead3, 0xf3ead3), k(0xffd400, 0x111111, 0x111111)],
    gk: k(0x6a1b9a, 0x111111, 0xffffff),
    players: [p('GK', 'Kelleher', 1), p('DEF', 'van den Berg', 4), p('MID', 'Jensen', 8), p('FWD', 'Thiago', 9), p('FWD', 'Schade', 7)] },
  { name: 'Brighton & Hove Albion', short: 'Brighton', code: 'BHA',
    kits: [k(0x0057b8, 0xffffff, 0xffffff), k(0xffffff, 0x0057b8, 0x0057b8), k(0x0b6e6e, 0x2de2d0, 0x2de2d0)],
    gk: k(0xff6f00, 0x111111, 0x111111),
    players: [p('GK', 'Verbruggen', 1), p('DEF', 'Kadıoğlu', 24), p('MID', 'Hinshelwood', 8), p('FWD', 'Mitoma', 22), p('FWD', 'Tzimas', 9)] },
  { name: 'Chelsea', short: 'Chelsea', code: 'CHE',
    kits: [k(0x034694, 0xeec620, 0xffffff), k(0x111111, 0xeec620, 0xeec620), k(0xffffff, 0x1f4fbf, 0x1f4fbf)],
    gk: k(0x7bd389, 0x1a1a1a, 0x1a1a1a),
    players: [p('GK', 'Martínez', 1), p('DEF', 'Reece James', 24), p('MID', 'Palmer', 10), p('FWD', 'João Pedro', 9), p('FWD', 'Pedro Neto', 7)] },
  { name: 'Coventry City', short: 'Coventry', code: 'COV',
    kits: [k(0x6cb4ee, 0xffffff, 0xffffff), k(0xf2efe6, 0x1b2a4a, 0x1b2a4a), k(0x6a1b9a, 0xffffff, 0xffffff)],
    gk: k(0xf5a623, 0x1a1a1a, 0x1a1a1a),
    players: [p('GK', 'Dovin', 1), p('DEF', 'Pinnock', 2), p('MID', 'Grimes', 6), p('FWD', 'Wright', 11), p('FWD', 'Simms', 9)] },
  { name: 'Crystal Palace', short: 'Palace', code: 'CRY',
    kits: [k(0xffffff, 0x1b458f, 0x1b458f), k(0x111111, 0xc4122e, 0xffffff), k(0x1b458f, 0xc4122e, 0xffffff)],
    gk: k(0xf2a900, 0x1a1a1a, 0x1a1a1a),
    players: [p('GK', 'Henderson', 1), p('DEF', 'Mitchell', 3), p('MID', 'Wharton', 20), p('FWD', 'Mateta', 14), p('FWD', 'Sarr', 7)] },
  { name: 'Everton', short: 'Everton', code: 'EVE',
    kits: [k(0x003399, 0xf2a900, 0xffffff), k(0xffffff, 0x003399, 0x003399), k(0x2e8b57, 0xf28c28, 0xffffff)],
    gk: k(0xe8e21c, 0x1a1a1a, 0x1a1a1a),
    players: [p('GK', 'Pickford', 1), p('DEF', 'Branthwaite', 4), p('MID', 'Garner', 37), p('FWD', 'Grealish', 10), p('FWD', 'Barry', 11)] },
  { name: 'Fulham', short: 'Fulham', code: 'FUL',
    kits: [k(0xffffff, 0xcc0000, 0x111111), k(0xcc0000, 0x111111, 0xffffff), k(0x87ceeb, 0xff4fa3, 0xff4fa3)],
    gk: k(0x2e7d32, 0x1a1a1a, 0xffffff),
    players: [p('GK', 'Leno', 1), p('DEF', 'Bassey', 3), p('MID', 'Reed', 6), p('FWD', 'Muniz', 9), p('FWD', 'Gonzalo García', 7)] },
  { name: 'Hull City', short: 'Hull City', code: 'HUL',
    kits: [k(0xf5a11c, 0x111111, 0x111111), k(0xffffff, 0xf28c28, 0x111111), k(0x1f4fa3, 0xd4a937, 0xffffff)],
    gk: k(0xf2a7be, 0x111111, 0x111111),
    players: [p('GK', 'Butland', 1), p('DEF', 'Hughes', 4), p('MID', 'Morita', 5), p('FWD', 'McBurnie', 9), p('FWD', 'Belloumi', 10)] },
  { name: 'Ipswich Town', short: 'Ipswich', code: 'IPS',
    kits: [k(0x1f5fbf, 0xffffff, 0xffffff), k(0xf2e6b8, 0xc8102e, 0x111111), k(0x111111, 0xd4a937, 0xd4a937)],
    gk: k(0xf28c28, 0x111111, 0x111111),
    players: [p('GK', 'Palmer', 1), p('DEF', 'Davis', 3), p('MID', 'Palacios', 25), p('FWD', 'Enciso', 10), p('FWD', 'Philogene', 11)] },
  { name: 'Leeds United', short: 'Leeds', code: 'LEE',
    kits: [k(0xffffff, 0xffd200, 0x1d428a), k(0xffd200, 0x1d428a, 0x1d428a), k(0x2b2b2e, 0x111111, 0xffffff)],
    gk: k(0x3cb371, 0x111111, 0x111111),
    players: [p('GK', 'Trafford', 1), p('DEF', 'Rodon', 6), p('MID', 'Ampadu', 4), p('FWD', 'Calvert-Lewin', 9), p('FWD', 'James', 7)] },
  { name: 'Liverpool', short: 'Liverpool', code: 'LIV',
    kits: [k(0x8b1a2b, 0xffffff, 0xffffff), k(0xffffff, 0xc8102e, 0xc8102e), k(0x111111, 0xc0c0c0, 0xb5385a)],
    gk: k(0x1a1a1a, 0x7b3fa0, 0xffffff),
    players: [p('GK', 'Alisson', 1), p('DEF', 'Van Dijk', 4), p('MID', 'Wirtz', 7), p('FWD', 'Isak', 9), p('FWD', 'Ekitike', 22)] },
  { name: 'Manchester City', short: 'Man City', code: 'MCI',
    kits: [k(0x6cabdd, 0xffffff, 0x1c2c5b), k(0x111111, 0xf5e050, 0xf5e050), k(0xffffff, 0x2f6fd0, 0x1c2c5b)],
    gk: k(0xf28c28, 0x111111, 0x111111),
    players: [p('GK', 'Donnarumma', 1), p('DEF', 'Dias', 3), p('MID', 'Cherki', 10), p('FWD', 'Haaland', 9), p('FWD', 'Foden', 47)] },
  { name: 'Manchester United', short: 'Man United', code: 'MUN',
    kits: [k(0xda291c, 0xffffff, 0xffffff), k(0x1f3f9e, 0xffffff, 0xffffff), k(0xf2ede0, 0x1f5a3a, 0x1f5a3a)],
    gk: k(0xf5c400, 0x111111, 0x111111),
    players: [p('GK', 'Lammens', 1), p('DEF', 'Maguire', 5), p('MID', 'Bruno Fernandes', 8), p('FWD', 'Mbeumo', 19), p('FWD', 'Cunha', 10)] },
  { name: 'Newcastle United', short: 'Newcastle', code: 'NEW',
    kits: [k(0xffffff, 0x000000, 0x000000), k(0x0b1a3a, 0xffffff, 0xffffff), k(0xc9b6e4, 0x4b2a7b, 0x4b2a7b)],
    gk: k(0xe8e8e8, 0x00a3e0, 0x111111),
    players: [p('GK', 'Pope', 1), p('DEF', 'Burn', 33), p('MID', 'Joelinton', 7), p('FWD', 'Wissa', 9), p('FWD', 'Barnes', 11)] },
  { name: 'Nottingham Forest', short: 'Forest', code: 'NFO',
    kits: [k(0xc8102e, 0xffffff, 0xffffff), k(0x0e5a3a, 0xd0202a, 0xffffff), k(0x8fc6e8, 0xffffff, 0x14284b)],
    gk: k(0x1e1e1e, 0xf5c400, 0xf5c400),
    players: [p('GK', 'Sels', 26), p('DEF', 'Milenković', 31), p('MID', 'Gibbs-White', 10), p('FWD', 'Hudson-Odoi', 7), p('FWD', 'Wood', 9)] },
  { name: 'Sunderland', short: 'Sunderland', code: 'SUN',
    kits: [k(0xe2231a, 0xffffff, 0xffffff), k(0xf2a0c0, 0x111111, 0x1b2250), k(0x1e4fb5, 0xc77b3b, 0xffffff)],
    gk: k(0x2d2d2d, 0x00c2a8, 0xffffff),
    players: [p('GK', 'Roefs', 22), p('DEF', 'Ballard', 5), p('MID', 'Xhaka', 34), p('FWD', 'Brobbey', 9), p('FWD', 'Talbi', 7)] },
  { name: 'Tottenham Hotspur', short: 'Tottenham', code: 'TOT',
    kits: [k(0xffffff, 0x132257, 0x132257), k(0x14123a, 0xd63ba0, 0xff8a1f), k(0x5b2c83, 0xffffff, 0xffffff)],
    gk: k(0xff7a1a, 0x111111, 0x111111),
    players: [p('GK', 'Kinský', 31), p('DEF', 'Van de Ven', 37), p('MID', 'Tonali', 16), p('FWD', 'Solanke', 19), p('FWD', 'Richarlison', 9)] },
];

/**
 * A short fingerprint (FNV-1a over the data) of everything in CLUBS. Both players send it in the handshake, so two
 * builds with different clubs data (different indices!) tell the players to refresh instead of mixing up clubs.
 */
export function clubsHash(): string {
  const text = JSON.stringify(CLUBS);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
