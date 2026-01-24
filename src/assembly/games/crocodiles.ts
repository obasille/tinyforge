// cspell:language en,fr
// CROCODILES - Jeu TinyForge
// Poursuite façon Pacman sur un écran unique avec une grille 16x16 pixels.
// Vous contrôlez une tête cubique tandis que les crocodiles patrouillent le labyrinthe.
// Évitez les crocodiles; appuyez sur START pour redémarrer après game over.

import {
  Button,
  RAM_START,
  WIDTH,
  HEIGHT,
  buttonDown,
  buttonPressed,
  c,
  drawStartMessageBox,
  drawRect,
  fillRect,
  randomRange,
  drawSpriteScaled,
  s,
  readSpriteInfo,
  getLastSpriteWidth,
  getLastSpriteAddress,
  getLastSpriteHeight,
  drawSprite,
  log,
} from "../sdk";

// === Constantes ===
const CASE_DIM_PIXELS: i32 = 16;
const LARGEUR_GRILLE: i32 = WIDTH / CASE_DIM_PIXELS;
const HAUTEUR_GRILLE: i32 = HEIGHT / CASE_DIM_PIXELS;

const JOUEUR_DEPL_DELAI: u8 = 6;
const CROCO_DEPL_DELAI: u8 = 30;

const COULEUR_PLAYER: u32 = c(0xf2c9a0);
const COULEUR_PLAYER_EYE: u32 = c(0x1b1b1b);
const COULEUR_CROCO_ROUGE: u32 = c(0xff0000);
const COULEUR_CROCO_VIOLET: u32 = c(0xff00ff);
const COULEUR_CROCO_VERT: u32 = c(0x00ff01);

const COULEUR_SOL: u32 = c(0xe09729);
const COULEUR_MUR: u32 = c(0x04e5ff);

const NIVEAU_1: i32 = s("level1");

enum Direction {
  HAUT = 0,
  DROITE = 1,
  BAS = 2,
  GAUCHE = 3,
}

enum EtatJeu {
  EN_COURS = 0,
  PARTIE_TERMINEE = 1,
}

// === Système de variables en RAM ===
@unmanaged
class Variables {
  joueurX: u8; // 0
  joueurY: u8; // 1
  etat: u8; // 2
  minuteurDeplJoueur: u8; // 3
  minuteurDeplCroc: u8; // 4
  croco0X: u8; // 5
  croco0Y: u8; // 6
  croco0Dir: u8; // 7
  croco1X: u8; // 8
  croco1Y: u8; // 9
  croco1Dir: u8; // 10
  croco2X: u8; // 11
  croco2Y: u8; // 12
  croco2Dir: u8; // 13
}

const vars = changetype<Variables>(RAM_START);

// === Fonctions auxiliaires ===

function peutBouger(x: i32, y: i32): bool {
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    if (readSpriteInfo(NIVEAU_1)) {
      const width = getLastSpriteWidth();
      const height = getLastSpriteHeight();
      const addr = getLastSpriteAddress();
      const pixel = load<u32>(addr + (y * width + x) * 4);
      if (pixel != COULEUR_MUR) {
        return true;
      }
    }
  }
  return false;
}

function caseCouleur(x: i32, y: i32, cc: u32): bool {
  const couleur = cc;
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    if (readSpriteInfo(NIVEAU_1)) {
      const width = getLastSpriteWidth();
      const height = getLastSpriteHeight();
      const addr = getLastSpriteAddress();
      const pixel = load<u32>(addr + (y * width + x) * 4);
      return pixel == couleur;
    }
  }
  return false;
}

function deltaDirX(dir: u8): i32 {
  if (dir == Direction.GAUCHE) return -1;
  if (dir == Direction.DROITE) return 1;
  return 0;
}

function deltaDirY(dir: u8): i32 {
  if (dir == Direction.HAUT) return -1;
  if (dir == Direction.BAS) return 1;
  return 0;
}

function choisisDirValide(x: u8, y: u8, dir: u8, couleur: u32): u8 {
  for (let essais = 0; essais < 4; essais++) {
    const prochDir = ((dir + essais) % 4) as u8;
    const nx = (x as i32) + deltaDirX(prochDir);
    const ny = (y as i32) + deltaDirY(prochDir);
    if (caseCouleur(nx, ny, couleur)) return prochDir;
  }
  return dir;
}

function deplaceCroc(x: u8, y: u8, dir: u8, couleur: u32): u32 {
  const prochDir = choisisDirValide(x, y, dir, couleur);
  const nx = ((x as i32) + deltaDirX(prochDir)) as u8;
  const ny = ((y as i32) + deltaDirY(prochDir)) as u8;
  return ((prochDir as u32) << 16) | ((ny as u32) << 8) | (nx as u32);
}

function verifiePositionJoueur(px: u8, py: u8): bool {
  return (
    (vars.croco0X == px && vars.croco0Y == py) ||
    (vars.croco1X == px && vars.croco1Y == py) ||
    (vars.croco2X == px && vars.croco2Y == py)
  );
}

function dessineGrille(): void {
  // for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
  //   for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
  //     const couleur = ((x + y) & 1) == 0 ? COULEUR_GRILLE_SOMBRE : COULEUR_GRILLE_CLAIR;
  //     fillRect(x * CASE_DIM_PIXELS, y * CASE_DIM_PIXELS, CASE_DIM_PIXELS, CASE_DIM_PIXELS, couleur);
  //   }
  // }
  drawSpriteScaled(NIVEAU_1, 0, 0, 16, 16);
}

function dessineTeteJoueur(x: u8, y: u8): void {
  const baseX = (x as i32) * CASE_DIM_PIXELS;
  const baseY = (y as i32) * CASE_DIM_PIXELS;
  const tailleTete: i32 = 12;
  const decalage: i32 = (CASE_DIM_PIXELS - tailleTete) / 2;
  fillRect(baseX + decalage, baseY + decalage, tailleTete, tailleTete, COULEUR_PLAYER);
  drawRect(baseX + decalage, baseY + decalage, tailleTete, tailleTete, COULEUR_PLAYER_EYE);
  fillRect(baseX + decalage + 3, baseY + decalage + 4, 2, 2, COULEUR_PLAYER_EYE);
  fillRect(baseX + decalage + 7, baseY + decalage + 4, 2, 2, COULEUR_PLAYER_EYE);
}

function dessineCroco(x: u8, y: u8): void {
  const baseX = (x as i32) * CASE_DIM_PIXELS;
  const baseY = (y as i32) * CASE_DIM_PIXELS;
  drawSprite(s("crocodile"), baseX, baseY);
}

function trouvePointDepart(col: u32, defX: u8, defY: u8): u16 {
  const couleur = c(col);
  if (readSpriteInfo(NIVEAU_1)) {
    const width = getLastSpriteWidth();
    const height = getLastSpriteHeight();
    const addr = getLastSpriteAddress();
    for (let y: i32 = 0; y < height; y++) {
      for (let x: i32 = 0; x < width; x++) {
        const pixel = load<u32>(addr + (y * width + x) * 4);
        if (pixel == couleur) {
          return ((y as u16) << 8) | (x as u16);
        }
      }
    }
  }
  return ((defY as u16) << 8) | (defX as u16);
}

// === Cycle de vie ===

// Initialisation du jeu
export function init(): void {
  vars.joueurX = (LARGEUR_GRILLE / 2) as u8;
  vars.joueurY = (HAUTEUR_GRILLE / 2) as u8;
  vars.etat = EtatJeu.EN_COURS as u8;
  vars.minuteurDeplJoueur = 0;
  vars.minuteurDeplCroc = 0;

  // Trouve le point de départ du crocodile rouge
  const posCrocoRouge = trouvePointDepart(COULEUR_CROCO_ROUGE, 1, 1);
  vars.croco0X = (posCrocoRouge & 0xff) as u8;
  vars.croco0Y = ((posCrocoRouge >> 8) & 0xff) as u8;
  vars.croco0Dir = Direction.DROITE as u8;

  // Trouve le point de départ du crocodile violet
  const posCrocoViolet = trouvePointDepart(
    COULEUR_CROCO_VIOLET,
    (LARGEUR_GRILLE - 2) as u8,
    1
  );
  vars.croco1X = (posCrocoViolet & 0xff) as u8;
  vars.croco1Y = ((posCrocoViolet >> 8) & 0xff) as u8;
  vars.croco1Dir = Direction.BAS as u8;

  // Trouve le point de départ du crocodile vert
  const posCrocoVert = trouvePointDepart(
    COULEUR_CROCO_VERT,
    1,
    (HAUTEUR_GRILLE - 2) as u8
  );
  vars.croco2X = (posCrocoVert & 0xff) as u8;
  vars.croco2Y = ((posCrocoVert >> 8) & 0xff) as u8;
  vars.croco2Dir = Direction.HAUT as u8;
}

// Mise à jour du jeu
export function update(): void {
  const etat = vars.etat;
  
  // Gestion du redémarrage : appuyer sur START après la fin de partie
  if (etat != EtatJeu.EN_COURS && buttonPressed(Button.START)) {
    init();
    return;
  }
  
  // Ne rien faire si le jeu n'est pas en cours
  if (etat != EtatJeu.EN_COURS) return;

  // Décrémenter les minuteurs de mouvement
  if (vars.minuteurDeplJoueur > 0) vars.minuteurDeplJoueur--;
  if (vars.minuteurDeplCroc > 0) vars.minuteurDeplCroc--;

  // Gestion du mouvement du joueur
  if (vars.minuteurDeplJoueur == 0) {
    let deplX: i32 = 0;
    let deplY: i32 = 0;
    
    // Détection des touches directionnelles
    if (buttonDown(Button.LEFT)) deplX = -1;
    else if (buttonDown(Button.RIGHT)) deplX = 1;
    else if (buttonDown(Button.UP)) deplY = -1;
    else if (buttonDown(Button.DOWN)) deplY = 1;

    // Si une direction est pressée, déplace le joueur
    if (deplX != 0 || deplY != 0) {
      // Calcule la nouvelle position
      let posX = vars.joueurX + deplX;
      let posY = vars.joueurY + deplY;

      if (posX == -1) posX = LARGEUR_GRILLE - 1;
      if (posX == LARGEUR_GRILLE) posX = 0;
      if (posY == -1) posY = HAUTEUR_GRILLE - 1;
      if (posY == HAUTEUR_GRILLE) posY = 0;
      
      // Déplacer uniquement si la position est valide
      if (peutBouger(posX, posY)) {
        vars.joueurX = posX as u8;
        vars.joueurY = posY as u8;
      }
      
      // Réinitialiser le minuteur de mouvement
      vars.minuteurDeplJoueur = JOUEUR_DEPL_DELAI;
    }
  }

  if (vars.minuteurDeplCroc == 0) {
    // Déplace le crocodile rouge
    let posXYDir = deplaceCroc(
      vars.croco0X,
      vars.croco0Y,
      vars.croco0Dir,
      COULEUR_CROCO_ROUGE
    );
    vars.croco0X = (posXYDir & 0xff) as u8;
    vars.croco0Y = ((posXYDir >> 8) & 0xff) as u8;
    vars.croco0Dir = ((posXYDir >> 16) & 0xff) as u8;

    // Déplace le crocodile violet
    posXYDir = deplaceCroc(
      vars.croco1X,
      vars.croco1Y,
      vars.croco1Dir,
      COULEUR_CROCO_VIOLET
    );
    vars.croco1X = (posXYDir & 0xff) as u8;
    vars.croco1Y = ((posXYDir >> 8) & 0xff) as u8;
    vars.croco1Dir = ((posXYDir >> 16) & 0xff) as u8;

    // Déplace le crocodile vert
    posXYDir = deplaceCroc(
      vars.croco2X,
      vars.croco2Y,
      vars.croco2Dir,
      c(COULEUR_CROCO_VERT)
    );
    vars.croco2X = (posXYDir & 0xff) as u8;
    vars.croco2Y = ((posXYDir >> 8) & 0xff) as u8;
    vars.croco2Dir = ((posXYDir >> 16) & 0xff) as u8;

    vars.minuteurDeplCroc = CROCO_DEPL_DELAI;
  }

  if (verifiePositionJoueur(vars.joueurX, vars.joueurY)) {
    vars.etat = EtatJeu.PARTIE_TERMINEE as u8;
  }
}

// Dessine la grille et les crocodiles
export function draw(): void {
  dessineGrille();

  dessineCroco(vars.croco0X, vars.croco0Y);
  dessineCroco(vars.croco1X, vars.croco1Y);
  dessineCroco(vars.croco2X, vars.croco2Y);

  dessineTeteJoueur(vars.joueurX, vars.joueurY);

  if (vars.etat == EtatJeu.PARTIE_TERMINEE) {
    drawStartMessageBox("IL VA TE MANGER...", c(0x2a1a1a), c(0xffaa00));
  }
}
