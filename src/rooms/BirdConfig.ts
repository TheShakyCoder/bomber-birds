export interface BirdStats {
  name: string;
  health: number;
  armor: number;
  attack: number;
  critDamage: number;  // multiplier, e.g. 1.5
  critChance: number;  // 0–100
  weaponDirections: number; // 1, 4, or 8
  weaponRange: number;
  moveSpeed: number; // 1 = normal, 2 = double
}

export const BIRD_CONFIGS: Record<string, BirdStats> = {
  eagle: {
    name: "Eagle",
    health: 100,
    armor: 5,
    attack: 60,
    critDamage: 1.5,
    critChance: 10,
    weaponDirections: 1,
    weaponRange: 1,
    moveSpeed: 1,
  },
  falcon: {
    name: "Falcon",
    health: 80,
    armor: 0,
    attack: 40,
    critDamage: 2.0,
    critChance: 30,
    weaponDirections: 1,
    weaponRange: 1,
    moveSpeed: 2,
  },
  robin: {
    name: "Robin",
    health: 100,
    armor: 5,
    attack: 50,
    critDamage: 1.5,
    critChance: 10,
    weaponDirections: 4,
    weaponRange: 1,
    moveSpeed: 1,
  },
  parrot: {
    name: "Parrot",
    health: 150,
    armor: 15,
    attack: 40,
    critDamage: 1.2,
    critChance: 5,
    weaponDirections: 4,
    weaponRange: 1,
    moveSpeed: 1,
  },
  crow: {
    name: "Crow",
    health: 100,
    armor: 5,
    attack: 35,
    critDamage: 1.5,
    critChance: 15,
    weaponDirections: 8,
    weaponRange: 1,
    moveSpeed: 1,
  },
  penguin: {
    name: "Penguin",
    health: 130,
    armor: 20,
    attack: 30,
    critDamage: 1.2,
    critChance: 5,
    weaponDirections: 8,
    weaponRange: 1,
    moveSpeed: 1,
  },
};

// Range upgrade cost depends on weapon directions
export const RANGE_UPGRADE_COST: Record<number, number> = {
  1: 50,
  4: 75,
  8: 100,
};

export const STAT_UPGRADE_COSTS: Record<string, number> = {
  health: 40,
  armor: 60,
  attack: 50,
  critDamage: 80,
  critChance: 70,
  weaponRange: 0, // handled separately via RANGE_UPGRADE_COST
  moveSpeed: 100,
};

export const STAT_UPGRADE_AMOUNTS: Record<string, number> = {
  health: 20,
  armor: 3,
  attack: 10,
  critDamage: 0.1,
  critChance: 5,
  weaponRange: 1,
  moveSpeed: 1,
};
