// Team looks: a name and a kit colour chosen from preset lists. Pure: no Phaser, no DOM (used by settings, the lobby
// protocol and the renderer).

export interface KitPreset {
  label: string;
  kit: number;
  outline: number;
  /** Goalkeeper shirt: always clearly different from the kit. */
  keeper: number;
}

/** Kit colours a player can pick from (no greens: they vanish on the grass). Online, two teams never share one. */
export const KIT_PRESETS: readonly KitPreset[] = [
  { label: 'Blue', kit: 0x2a6fdb, outline: 0x0b2a5e, keeper: 0xf2c94c },
  { label: 'Red', kit: 0xd9372b, outline: 0x5e1410, keeper: 0x2fbf71 },
  { label: 'Yellow', kit: 0xf2c94c, outline: 0x6b5410, keeper: 0x8e44ad },
  { label: 'Orange', kit: 0xf28c28, outline: 0x6b3a08, keeper: 0x1f2d3d },
  { label: 'Purple', kit: 0x8e44ad, outline: 0x3a1650, keeper: 0xf2c94c },
  { label: 'White', kit: 0xf2f2f2, outline: 0x555555, keeper: 0xe85d9e },
  { label: 'Black', kit: 0x2b2b2b, outline: 0xffffff, keeper: 0xf2c94c },
  { label: 'Sky', kit: 0x4fc3f7, outline: 0x0e4a6b, keeper: 0xd9372b },
];

export const TEAM_NAMES: readonly string[] = ['Rovers', 'United', 'City', 'Athletic', 'Wanderers', 'Albion', 'Town', 'Rangers'];

/** A team's look: indices into TEAM_NAMES and KIT_PRESETS (so it is tiny, and can't carry anything unexpected). */
export interface Look {
  name: number;
  kit: number;
}

export interface TeamStyle {
  name: string;
  kit: number;
  keeper: number;
  outline: number;
}

export const DEFAULT_LOOK: Look = { name: 0, kit: 0 };

const wrap = (i: number, n: number): number => ((i % n) + n) % n;

export const isLook = (v: unknown): v is Look => {
  if (typeof v !== 'object' || v === null) return false;
  const l = v as Record<string, unknown>;
  return Number.isInteger(l.name) && (l.name as number) >= 0 && (l.name as number) < TEAM_NAMES.length && Number.isInteger(l.kit) && (l.kit as number) >= 0 && (l.kit as number) < KIT_PRESETS.length;
};

/** Anything (e.g. parsed storage) -> a valid look. */
export function sanitizeLook(v: unknown): Look {
  return isLook(v) ? { name: v.name, kit: v.kit } : { ...DEFAULT_LOOK };
}

/** The next kit (or name) in the given direction that `other` isn't using. */
export function cycleKit(look: Look, dir: 1 | -1, other?: Look): Look {
  let kit = look.kit;
  for (let i = 0; i < KIT_PRESETS.length; i++) {
    kit = wrap(kit + dir, KIT_PRESETS.length);
    if (!other || other.kit !== kit) break;
  }
  return { ...look, kit };
}

export function cycleName(look: Look, dir: 1 | -1, other?: Look): Look {
  let name = look.name;
  for (let i = 0; i < TEAM_NAMES.length; i++) {
    name = wrap(name + dir, TEAM_NAMES.length);
    if (!other || other.name !== name) break;
  }
  return { ...look, name };
}

/** `mine`, changed as little as needed so that it doesn't clash with `theirs` (same kit colour or same name). */
export function resolveClash(mine: Look, theirs: Look): Look {
  let out = mine;
  if (out.kit === theirs.kit) out = cycleKit(out, 1, theirs);
  if (out.name === theirs.name) out = cycleName(out, 1, theirs);
  return out;
}

/** An opponent look for offline play: different from the player's, otherwise random. */
export function randomOpponent(mine: Look, random: () => number = Math.random): Look {
  const kit = wrap(mine.kit + 1 + Math.floor(random() * (KIT_PRESETS.length - 1)), KIT_PRESETS.length);
  const name = wrap(mine.name + 1 + Math.floor(random() * (TEAM_NAMES.length - 1)), TEAM_NAMES.length);
  return { name, kit };
}

/** The drawing colours for both teams (index = team). The second keeper changes shirt if it would match the first. */
export function teamStyles(looks: readonly [Look, Look]): [TeamStyle, TeamStyle] {
  const style = (l: Look): TeamStyle => {
    const k = KIT_PRESETS[l.kit];
    return { name: TEAM_NAMES[l.name], kit: k.kit, keeper: k.keeper, outline: k.outline };
  };
  const a = style(looks[0]);
  const b = style(looks[1]);
  if (a.keeper === b.keeper || b.keeper === a.kit) b.keeper = [0xf2c94c, 0x2fbf71, 0xe85d9e, 0x1f2d3d].find((c) => c !== a.keeper && c !== a.kit && c !== b.kit) ?? b.keeper;
  return [a, b];
}

/** The colour to write a team's name in on a dark background: its kit, or its outline colour if the kit is too dark to read. */
export function readableOn(style: { kit: number; outline: number }): number {
  const luma = ((style.kit >> 16) & 255) * 0.3 + ((style.kit >> 8) & 255) * 0.6 + (style.kit & 255) * 0.1;
  return luma < 70 ? style.outline : style.kit;
}
