// cspell:language en,fr
import {
  ArrayView,
  MemoryAllocator,
  RAM_START,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  c,
} from "../../sdk";

// === Constantes ===
export const TAILLE_CASE: i32 = 16;
export const LARGEUR_GRILLE: i32 = SCREEN_WIDTH / TAILLE_CASE;
export const HAUTEUR_GRILLE: i32 = SCREEN_HEIGHT / TAILLE_CASE;

export const JOUEUR_DEPL_DELAI: u8 = 6;
export const CROCO_DEPL_DELAI: u8 = 30;
export const NB_CROCOS: i32 = 3;
export const VIES_DEPART: u8 = 3;
export const INVINCIBLE_TICKS: u8 = 180; // ~3s @ 60fps
export const NB_TUNNELS: i32 = 2;
export const TUNNEL_CYCLE_TICKS: u16 = 600; // 10s @ 60fps
export const TUNNEL_ANIM_TICKS: u8 = 12;
export const NB_PIÈGES: i32 = 4;
export const PIÈGE_MIN_TICKS: u16 = 120; // 2s @ 60fps
export const PIÈGE_MAX_TICKS: u16 = 300; // 5s @ 60fps

export const INVALIDE: u8 = 0xff;
export const INVALIDE_POS: u16 = 0xffff;

export enum Couleurs {
  MessageBoxFond = c(0x2a1a1a),
  MessageBoxTexte = c(0xffaa00),
  MessageBoxFondVictoire = c(0x1a2a1a),
  MessageBoxTexteVictoire = c(0x00ff00),
  Joueur = c(0xffff00),
  CrocoRouge = c(0xff0000),
  CrocoViolet = c(0xff00ff),
  CrocoVert = c(0x00ff00),
  Sol = c(0xe09729),
  Mur = c(0x04e5ff),
  Viande = c(0xba0b0b),
  Gamelle = c(0x583de8),
  Tunnel1 = c(0x707070),
  Tunnel2 = c(0x909090),
  Piège = c(0x804000),
}

export enum Direction {
  IMMOBILE = 0,
  HAUT = 1,
  DROITE = 2,
  BAS = 3,
  GAUCHE = 4,
}

export enum EtatJeu {
  EN_COURS = 0,
  FIN = 1,
  VICTOIRE = 2,
}

// === Classes ===

@unmanaged
export class Jeu {
  etat: u8;
  vies: u8;
  tunnelPhase: u8;
  tunnelTimer: u16;
  _fin: u8;
}

@unmanaged
export class Joueur {
  x: u8;
  y: u8;
  minuteurDepl: u8;
  viandePortee: u8; // index de la viande portée, ou INVALIDE si aucune
  invincible: u8;
  dirDepl: u8;
  tunnelEtat: u8; // 0 = pas dans tunnel, 1 = entrée, 2 = sortie
  tunnelTimer: u8;
  tunnelDestX: u8;
  tunnelDestY: u8;
  startupDelay: u8;
}

@unmanaged
export class Croco {
  x: u8;
  y: u8;
  dir: u8;
  minuteurDepl: u8;
  gamelleX: u8;
  gamelleY: u8;
  gamelleRemplie: u8; // 0 = vide, 1 = remplie
  attaque: u8; // 0 = normal, 1 = attaque
  targetX: u8; // Position X de la cible
  targetY: u8; // Position Y de la cible
}

@unmanaged
export class Viande {
  x: u8;
  y: u8;
}

@unmanaged
export class Tunnel {
  present: u8; // 0 = pas de tunnel trouvé, 1 = tunnel présent
  x0: u8;
  y0: u8;
  x1: u8;
  y1: u8;
  ouvert: u8;
}

@unmanaged
export class Piège {
  present: u8; // 0 = pas de piège trouvé, 1 = piège présent
  x: u8;
  y: u8;
  actif: u8; // 0 = piège désactivé, 1 = piège actif
  timer: u16; // Timer pour le changement d'état
}

// === Memory Layout ===

// Allocator state stored at RAM_START, data follows after sizeof<usize> bytes
const mem = MemoryAllocator.fromAddress(RAM_START);

export const jeu: Jeu = mem.allocStruct<Jeu>(offsetof<Jeu>("_fin"));
export const joueur: Joueur = mem.allocStruct<Joueur>(
  offsetof<Joueur>("startupDelay") + sizeof<u8>(),
);
export const crocos = mem.allocUncheckedObjArray<Croco>(
  offsetof<Croco>("targetY") + sizeof<u8>(),
  NB_CROCOS,
);
export const viandes = mem.allocUncheckedObjArray<Viande>(
  offsetof<Viande>("y") + sizeof<u8>(),
  3,
);
export const tunnels = mem.allocUncheckedObjArray<Tunnel>(
  offsetof<Tunnel>("ouvert") + sizeof<u8>(),
  NB_TUNNELS,
);
export const pieges = mem.allocUncheckedObjArray<Piège>(
  offsetof<Piège>("timer") + sizeof<u16>(),
  NB_PIÈGES,
);

// Maximum size for case arrays (grid is 20x15 = 300 cells)
const MAX_CASES_CIBLES: i32 = 100; // Max target cells per croco
const MAX_CASES_VALIDES: i32 = 200; // Max valid path cells per croco

// Allocate memory for case arrays using MemoryAllocator
export const casesCiblesCrocoRouge = mem.allocArray<u16>(
  MAX_CASES_CIBLES as u16,
);
export const casesCiblesCrocoViolet = mem.allocArray<u16>(
  MAX_CASES_CIBLES as u16,
);
export const casesCiblesCrocoVert = mem.allocArray<u16>(
  MAX_CASES_CIBLES as u16,
);

export const casesValidesCrocoRouge = mem.allocArray<u16>(
  MAX_CASES_VALIDES as u16,
);
export const casesValidesCrocoViolet = mem.allocArray<u16>(
  MAX_CASES_VALIDES as u16,
);
export const casesValidesCrocoVert = mem.allocArray<u16>(
  MAX_CASES_VALIDES as u16,
);

// BFS pathfinding arrays (exported for use in pathfinding.ts)
export const queueBFS = mem.allocArray<u16>(256);
export const parentsBFS = mem.allocArray<u16>(256);

// Direction arrays for pathfinding (4 directions: up, down, left, right)
export const directionX = mem.allocUncheckedArray<i32>(4);
export const directionY = mem.allocUncheckedArray<i32>(4);

/**
 * Initialize arrays capacities and static data
 * Call once from game init()
 */
export function initTableaux(): void {
  // Efface toutes les tableaux de cases
  casesCiblesCrocoRouge.clear();
  casesCiblesCrocoViolet.clear();
  casesCiblesCrocoVert.clear();
  casesValidesCrocoRouge.clear();
  casesValidesCrocoViolet.clear();
  casesValidesCrocoVert.clear();

  // Initialise les tableaux de direction
  directionX.set(0, 0);
  directionY.set(0, -1); // UP
  directionX.set(1, 0);
  directionY.set(1, 1); // DOWN
  directionX.set(2, -1);
  directionY.set(2, 0); // LEFT
  directionX.set(3, 1);
  directionY.set(3, 0); // RIGHT
}

// Fonctions d'accès aux tableaux de cases (pour éviter les if dans le code de jeu)
export function getCasesCibles(index: i32): ArrayView<u16> {
  if (index == 0) return casesCiblesCrocoRouge;
  if (index == 1) return casesCiblesCrocoViolet;
  return casesCiblesCrocoVert;
}

export function getCasesValides(index: i32): ArrayView<u16> {
  if (index == 0) return casesValidesCrocoRouge;
  if (index == 1) return casesValidesCrocoViolet;
  return casesValidesCrocoVert;
}
