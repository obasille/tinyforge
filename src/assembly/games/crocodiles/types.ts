// cspell:language en,fr
import {
  FixedArray,
  FixedArrayWithCount,
  HEIGHT,
  RAM_START,
  WIDTH,
  c,
} from "../../sdk";

// === Constantes ===
export const TAILLE_CASE: i32 = 16;
export const LARGEUR_GRILLE: i32 = WIDTH / TAILLE_CASE;
export const HAUTEUR_GRILLE: i32 = HEIGHT / TAILLE_CASE;

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

// === Instances en RAM ===

export const jeu = changetype<Jeu>(RAM_START);
const szVars = offsetof<Jeu>("_fin");
const szJoueur: usize = (offsetof<Joueur>("startupDelay") + 4) & ~3;
const szCroco: usize = (offsetof<Croco>("targetY") + 4) & ~3;
const szViande: usize = (offsetof<Viande>("y") + 4) & ~3;
const szTunnel: usize = (offsetof<Tunnel>("ouvert") + 4) & ~3;
const szPiège: usize = (offsetof<Piège>("timer") + 4) & ~3;
let offset: usize = RAM_START + szVars;
export const joueur = changetype<Joueur>(offset);
offset += szJoueur;
const croco0 = changetype<Croco>(offset);
offset += szCroco;
const croco1 = changetype<Croco>(offset);
offset += szCroco;
const croco2 = changetype<Croco>(offset);
offset += szCroco;
const viande0 = changetype<Viande>(offset);
offset += szViande;
const viande1 = changetype<Viande>(offset);
offset += szViande;
const viande2 = changetype<Viande>(offset);
offset += szViande;
const tunnel0 = changetype<Tunnel>(offset);
offset += szTunnel;
const tunnel1 = changetype<Tunnel>(offset);
offset += szTunnel;
const piège0 = changetype<Piège>(offset);
offset += szPiège;
const piège1 = changetype<Piège>(offset);
offset += szPiège;
const piège2 = changetype<Piège>(offset);
offset += szPiège;
const piège3 = changetype<Piège>(offset);
offset += szPiège;

// Helper functions to get entities by index (avoids heap-allocated arrays)
export function donneCroco(index: i32): Croco {
  if (index == 0) return croco0;
  if (index == 1) return croco1;
  return croco2;
}

export function donneViande(index: i32): Viande {
  if (index == 0) return viande0;
  if (index == 1) return viande1;
  return viande2;
}

export function donneTunnel(index: i32): Tunnel {
  if (index == 0) return tunnel0;
  return tunnel1;
}

export function donnePiège(index: i32): Piège {
  if (index == 0) return piège0;
  if (index == 1) return piège1;
  if (index == 2) return piège2;
  return piège3;
}

export function donneCouleurCroco(index: i32): u32 {
  if (index == 0) return Couleurs.CrocoRouge;
  if (index == 1) return Couleurs.CrocoViolet;
  return Couleurs.CrocoVert;
}

// Maximum size for case arrays (grid is 20x15 = 300 cells)
const MAX_CASES_CIBLES: i32 = 100; // Max target cells per croco
const MAX_CASES_VALIDES: i32 = 200; // Max valid path cells per croco

// Allocate memory for case arrays
// SDK FixedArrayWithCount layout: [u16 length][u16 capacity][data...]
export const casesCiblesCrocoRouge =
  FixedArrayWithCount.fromAddress<u16>(offset);
offset += FixedArrayWithCount.sizeInMemory<u16>(MAX_CASES_CIBLES);
export const casesCiblesCrocoViolet =
  FixedArrayWithCount.fromAddress<u16>(offset);
offset += FixedArrayWithCount.sizeInMemory<u16>(MAX_CASES_CIBLES);
export const casesCiblesCrocoVert =
  FixedArrayWithCount.fromAddress<u16>(offset);
offset += FixedArrayWithCount.sizeInMemory<u16>(MAX_CASES_CIBLES);

export const casesValidesCrocoRouge =
  FixedArrayWithCount.fromAddress<u16>(offset);
offset += FixedArrayWithCount.sizeInMemory<u16>(MAX_CASES_VALIDES);
export const casesValidesCrocoViolet =
  FixedArrayWithCount.fromAddress<u16>(offset);
offset += FixedArrayWithCount.sizeInMemory<u16>(MAX_CASES_VALIDES);
export const casesValidesCrocoVert =
  FixedArrayWithCount.fromAddress<u16>(offset);
offset += FixedArrayWithCount.sizeInMemory<u16>(MAX_CASES_VALIDES);

// BFS pathfinding arrays (exported for use in pathfinding.ts)
export const MAX_BFS_SIZE: i32 = 256;
export const queueBFS = FixedArray.fromAddress<u16>(offset);
offset += FixedArray.sizeInMemory<u16>(MAX_BFS_SIZE);
export const parentsBFS = FixedArray.fromAddress<u16>(offset);
offset += FixedArray.sizeInMemory<u16>(MAX_BFS_SIZE);

// Direction arrays for pathfinding (4 directions: up, down, left, right)
export const directionX = FixedArray.fromAddress<i32>(offset);
offset += FixedArray.sizeInMemory<i32>(4);
export const directionY = FixedArray.fromAddress<i32>(offset);
offset += FixedArray.sizeInMemory<i32>(4);

/**
 * Initialize arrays capacities and static data
 * Call once from game init()
 */
export function initTypeArrays(): void {
  // Initialize capacities
  casesCiblesCrocoRouge.capacity = MAX_CASES_CIBLES as u16;
  casesCiblesCrocoViolet.capacity = MAX_CASES_CIBLES as u16;
  casesCiblesCrocoVert.capacity = MAX_CASES_CIBLES as u16;
  casesValidesCrocoRouge.capacity = MAX_CASES_VALIDES as u16;
  casesValidesCrocoViolet.capacity = MAX_CASES_VALIDES as u16;
  casesValidesCrocoVert.capacity = MAX_CASES_VALIDES as u16;

  // Initialize direction arrays
  directionX.set(0, 0);
  directionY.set(0, -1); // UP
  directionX.set(1, 0);
  directionY.set(1, 1); // DOWN
  directionX.set(2, -1);
  directionY.set(2, 0); // LEFT
  directionX.set(3, 1);
  directionY.set(3, 0); // RIGHT
}

// Helper functions to get arrays by index (avoids heap-allocated array)
export function getCasesCibles(index: i32): FixedArrayWithCount<u16> {
  if (index == 0) return casesCiblesCrocoRouge;
  if (index == 1) return casesCiblesCrocoViolet;
  return casesCiblesCrocoVert;
}

export function getCasesValides(index: i32): FixedArrayWithCount<u16> {
  if (index == 0) return casesValidesCrocoRouge;
  if (index == 1) return casesValidesCrocoViolet;
  return casesValidesCrocoVert;
}
