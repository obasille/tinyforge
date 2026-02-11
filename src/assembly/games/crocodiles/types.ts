// cspell:language en,fr
import {
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
export const NB_PIEGES: i32 = 4;
export const PIEGE_MIN_TICKS: u16 = 120; // 2s @ 60fps
export const PIEGE_MAX_TICKS: u16 = 300; // 5s @ 60fps

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

export const lesCrocos: Croco[] = [croco0, croco1, croco2];
export const lesViandes: Viande[] = [viande0, viande1, viande2];
export const lesTunnels: Tunnel[] = [tunnel0, tunnel1];
export const lesPièges: Piège[] = [piège0, piège1, piège2, piège3];

export const couleursCrocos: u32[] = [
  Couleurs.CrocoRouge,
  Couleurs.CrocoViolet,
  Couleurs.CrocoVert,
];

// cases cibles de chaque croco (format: y<<8 | x)
export let casesCiblesCrocoRouge: u16[] = [];
export let casesCiblesCrocoViolet: u16[] = [];
export let casesCiblesCrocoVert: u16[] = [];
export const casesCiblesCrocos: u16[][] = [casesCiblesCrocoRouge, casesCiblesCrocoViolet, casesCiblesCrocoVert];

// cases valides pour les chemins de chaque croco, calculées au lancement du niveau (format: y<<8 | x)
export let casesValidesCrocoRouge: u16[] = [];
export let casesValidesCrocoViolet: u16[] = [];
export let casesValidesCrocoVert: u16[] = [];
export const casesValidesCrocos: u16[][] = [casesValidesCrocoRouge, casesValidesCrocoViolet, casesValidesCrocoVert];
