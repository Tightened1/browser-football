// Team looks (T24): a Premier League club and one of its kits, chosen from src/data/clubs.ts. Colour-difference maths and
// kit-clash prevention. Pure: no Phaser, no DOM (used by settings, the lobby protocol and the renderer).
import { COLORS, KIT_CLASH_DELTA_E, KIT_GRASS_DELTA_E } from './config';
import { CLUBS, clubsHash, type Club, type ClubPlayer, type KitColours } from './data/clubs';

export { CLUBS, clubsHash };

/** Kits a club has: 0 home, 1 away, 2 third. Looks 3.. are plain bibs: the last resort when no club kit avoids a clash. */
export const KIT_LABELS = ['Home', 'Away', 'Third'] as const;
export const CLUB_KITS = KIT_LABELS.length;
export const BIBS: readonly (KitColours & { label: string })[] = [
  { label: 'White bib', shirt: 0xf2f2f2, trim: 0x555555, number: 0x222222 },
  { label: 'Black bib', shirt: 0x1f1f1f, trim: 0xdddddd, number: 0xffffff },
  { label: 'Orange bib', shirt: 0xff7a1a, trim: 0x6b3300, number: 0x111111 },
];
export const KIT_COUNT = CLUB_KITS + BIBS.length;

/** Goalkeeper shirts tried when a club's own would clash (tried in this order). */
const GK_FALLBACKS: readonly KitColours[] = [
  { shirt: 0xf2c94c, trim: 0x6b5410, number: 0x111111 },
  { shirt: 0xe85d9e, trim: 0x5a1534, number: 0xffffff },
  { shirt: 0x4fc3f7, trim: 0x0e4a6b, number: 0x111111 },
  { shirt: 0xff7a1a, trim: 0x6b3300, number: 0x111111 },
  { shirt: 0x1f1f1f, trim: 0xdddddd, number: 0xffffff },
  { shirt: 0x8e44ad, trim: 0x3a1650, number: 0xffffff },
  { shirt: 0xf2f2f2, trim: 0x555555, number: 0x222222 },
];

/** A team's look: club index into CLUBS and kit index (0 home, 1 away, 2 third, 3+ bibs). Tiny, so it can go over the wire. */
export interface Look {
  club: number;
  kit: number;
}

export interface TeamStyle {
  /** Short name for the HUD (≤12 chars), the 3-letter code and the full name. */
  name: string;
  code: string;
  fullName: string;
  kit: number;
  outline: number;
  numberColor: number;
  keeper: number;
  keeperOutline: number;
  keeperNumber: number;
  /** Which club and kit this was drawn from. */
  club: number;
  kitIndex: number;
}

export const DEFAULT_LOOK: Look = { club: 0, kit: 0 };

export const isLook = (v: unknown): v is Look => {
  if (typeof v !== 'object' || v === null) return false;
  const l = v as Record<string, unknown>;
  return Number.isInteger(l.club) && (l.club as number) >= 0 && (l.club as number) < CLUBS.length && Number.isInteger(l.kit) && (l.kit as number) >= 0 && (l.kit as number) < KIT_COUNT;
};

/** Anything (e.g. parsed storage, maybe the pre-T24 `{name, kit}` look) -> a valid look. */
export function sanitizeLook(v: unknown): Look {
  return isLook(v) ? { club: v.club, kit: v.kit } : { ...DEFAULT_LOOK };
}

/** The colours of a look's kit. */
export function kitOf(look: Look): KitColours {
  const club = CLUBS[look.club];
  return look.kit < CLUB_KITS ? club.kits[look.kit] : BIBS[look.kit - CLUB_KITS];
}

export function kitLabel(look: Look): string {
  return look.kit < CLUB_KITS ? `${KIT_LABELS[look.kit]} kit` : BIBS[look.kit - CLUB_KITS].label;
}

/* ---- Colour difference (CIEDE2000) ------------------------------------------------------------- */

type Lab = [number, number, number];
const rad = (d: number): number => (d * Math.PI) / 180;
const labCache = new Map<number, Lab>();

/** 0xRRGGBB -> CIE L*a*b* (D65). */
export function toLab(rgb: number): Lab {
  const cached = labCache.get(rgb);
  if (cached) return cached;
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((rgb >> 16) & 255);
  const g = lin((rgb >> 8) & 255);
  const b = lin(rgb & 255);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const out: Lab = [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  labCache.set(rgb, out);
  return out;
}

/** The CIE76 colour difference (plain distance in Lab). */
export function deltaE76(a: number, b: number): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** The CIEDE2000 colour difference between two 0xRRGGBB colours: ~1 is barely visible, ~20+ is clearly a different colour. */
export function deltaE2000(c1: number, c2: number): number {
  const [L1, a1, b1] = toLab(c1);
  const [L2, a2, b2] = toLab(c2);
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number): number => (b === 0 && a === 0 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dL = L2 - L1;
  const dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2p - h1p;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
  const Lb = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hb: number;
  if (C1p * C2p === 0) hb = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hb = (h1p + h2p) / 2;
  else hb = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hb - 30)) + 0.24 * Math.cos(rad(2 * hb)) + 0.32 * Math.cos(rad(3 * hb + 6)) - 0.2 * Math.cos(rad(4 * hb - 63));
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  const x = dL / Sl;
  const y = dC / Sc;
  const z = dH / Sh;
  return Math.sqrt(x * x + y * y + z * z + Rt * y * z);
}

/** Two shirt colours are too alike to tell apart on the pitch. */
export const shirtsClash = (a: number, b: number): boolean => deltaE2000(a, b) < KIT_CLASH_DELTA_E;
/** A shirt colour that disappears into the grass. */
export const clashesWithGrass = (shirt: number): boolean => deltaE2000(shirt, COLORS.grass) < KIT_GRASS_DELTA_E || deltaE2000(shirt, COLORS.grassStripe) < KIT_GRASS_DELTA_E;

/* ---- Clash prevention ------------------------------------------------------------------------- */

/** Two outfield kits are fine together: different from each other and (each) from the grass. */
export function outfieldKitsOk(a: Look, b: Look): boolean {
  const ka = kitOf(a).shirt;
  const kb = kitOf(b).shirt;
  return !shirtsClash(ka, kb) && !clashesWithGrass(ka) && !clashesWithGrass(kb);
}

/** The kits of a club in the order they are tried when the first choice is no good (the chosen one, the rest, then the bibs). */
function kitOrder(first: number): number[] {
  const real = Array.from({ length: CLUB_KITS }, (_, i) => (first + i) % CLUB_KITS).filter((k) => k < CLUB_KITS);
  const order = first < CLUB_KITS ? real : [first];
  return [...order, ...real, ...BIBS.map((_, i) => CLUB_KITS + i)].filter((k, i, a) => a.indexOf(k) === i);
}

export interface ResolvedLooks {
  /** The final looks (host first), and whether each differs from what was asked for. */
  looks: [Look, Look];
  changed: [boolean, boolean];
}

/**
 * The host's look is the authority. It only moves if its own kit would vanish into the grass; the guest's (online) or
 * the AI's (offline) moves to its next kit that is clearly different from the host's (and the grass), trying the club's
 * other kits and finally a plain bib. The same club in the same kit is a clash like any other.
 */
export function resolveLooks(host: Look, guest: Look): ResolvedLooks {
  let h = host;
  if (clashesWithGrass(kitOf(h).shirt)) {
    const alt = kitOrder(h.kit).find((k) => !clashesWithGrass(kitOf({ club: h.club, kit: k }).shirt));
    if (alt !== undefined) h = { club: h.club, kit: alt };
  }
  let g = guest;
  const ok = kitOrder(guest.kit).find((k) => outfieldKitsOk(h, { club: guest.club, kit: k }));
  if (ok !== undefined) g = { club: guest.club, kit: ok };
  else {
    // Nothing of that club works at all: the bib that is furthest from the host's kit.
    const bib = BIBS.map((_, i) => CLUB_KITS + i).sort((a, b) => deltaE2000(kitOf({ club: guest.club, kit: b }).shirt, kitOf(h).shirt) - deltaE2000(kitOf({ club: guest.club, kit: a }).shirt, kitOf(h).shirt))[0];
    g = { club: guest.club, kit: bib };
  }
  return { looks: [h, g], changed: [h.kit !== host.kit, g.kit !== guest.kit] };
}

/** The guest's look after the host's has been taken into account. */
export const resolveGuest = (host: Look, guest: Look): Look => resolveLooks(host, guest).looks[1];

/**
 * An opponent look for offline play: a random club other than the player's (same-club matches are for online), in its
 * home kit, moved off any clash.
 */
export function randomOpponent(mine: Look, random: () => number = Math.random): Look {
  const club = (mine.club + 1 + Math.floor(random() * (CLUBS.length - 1))) % CLUBS.length;
  return resolveGuest(mine, { club, kit: 0 });
}

/** The look for a chosen opponent club. */
export const opponentLook = (mine: Look, club: number): Look => resolveGuest(mine, { club, kit: 0 });

/** Step a club index (wrapping). */
export const stepClub = (club: number, dir: 1 | -1): number => (club + dir + CLUBS.length) % CLUBS.length;
export const stepKit = (kit: number, dir: 1 | -1): number => (kit + dir + CLUB_KITS) % CLUB_KITS;

/* ---- Drawing styles --------------------------------------------------------------------------- */

/**
 * The drawing colours for both teams (index = team). `fixed` is the team whose goalkeeper keeps its own shirt if the two
 * would clash (the host's); a keeper shirt is also kept away from every outfield shirt and the grass, using the
 * fallback colours when its club's own would not do. Deterministic, so both machines draw the same.
 */
export function teamStyles(looks: readonly [Look, Look], fixed: 0 | 1 = 0): [TeamStyle, TeamStyle] {
  const shirts = [kitOf(looks[0]).shirt, kitOf(looks[1]).shirt];
  const keepers: KitColours[] = [];
  for (const t of [fixed, (1 - fixed) as 0 | 1]) {
    const own = CLUBS[looks[t].club].gk;
    const fits = (k: KitColours): boolean => !clashesWithGrass(k.shirt) && shirts.every((s) => !shirtsClash(k.shirt, s)) && keepers.every((o) => !shirtsClash(k.shirt, o.shirt));
    const pool = [own, ...GK_FALLBACKS];
    const best = pool.find(fits) ?? [...pool].sort((a, b) => minGap(b, shirts, keepers) - minGap(a, shirts, keepers))[0];
    keepers[t] = best;
  }
  const style = (l: Look, k: KitColours): TeamStyle => {
    const c: Club = CLUBS[l.club];
    const kit = kitOf(l);
    return { name: c.short, code: c.code, fullName: c.name, kit: kit.shirt, outline: kit.trim, numberColor: kit.number, keeper: k.shirt, keeperOutline: k.trim, keeperNumber: k.number, club: l.club, kitIndex: l.kit };
  };
  return [style(looks[0], keepers[0]), style(looks[1], keepers[1])];
}

function minGap(k: KitColours, shirts: number[], keepers: KitColours[]): number {
  return Math.min(deltaE2000(k.shirt, COLORS.grass), ...shirts.map((s) => deltaE2000(k.shirt, s)), ...keepers.map((o) => deltaE2000(k.shirt, o.shirt)));
}

/** The colour to write a team's name in on a dark background: its kit, or its outline colour if the kit is too dark to read. */
export function readableOn(style: { kit: number; outline: number }): number {
  const luma = ((style.kit >> 16) & 255) * 0.3 + ((style.kit >> 8) & 255) * 0.6 + (style.kit & 255) * 0.1;
  return luma < 70 ? style.outline : style.kit;
}

/** Black or white, whichever reads better on this colour (for the stroke round shirt numbers and names). */
export function contrastOn(rgb: number): number {
  return ((rgb >> 16) & 255) * 0.3 + ((rgb >> 8) & 255) * 0.6 + (rgb & 255) * 0.1 > 140 ? 0x000000 : 0xffffff;
}

/* ---- Players ---------------------------------------------------------------------------------- */

/** The squad member in formation slot `slot` (0 = keeper, 1..4 = the outfield slots). */
export function clubPlayer(club: number, slot: number): ClubPlayer {
  const players = CLUBS[club].players;
  return players[Math.min(Math.max(slot, 0), players.length - 1)];
}
