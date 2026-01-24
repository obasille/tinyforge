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
  drawSpriteScaled,
  s,
  readSpriteInfo,
  getLastSpriteWidth,
  getLastSpriteAddress,
  getLastSpriteHeight,
  drawSprite,
} from "../sdk";

// === Constantes ===
const CASE_DIM_PIXELS: i32 = 16;
const LARGEUR_GRILLE: i32 = WIDTH / CASE_DIM_PIXELS;
const HAUTEUR_GRILLE: i32 = HEIGHT / CASE_DIM_PIXELS;

const JOUEUR_DEPL_DELAI: u8 = 6;
const CROCO_DEPL_DELAI: u8 = 30;

const COULEUR_CROCO_ROUGE: u32 = c(0xff0000);
const COULEUR_CROCO_VIOLET: u32 = c(0xff00ff);
const COULEUR_CROCO_VERT: u32 = c(0x00ff00);

const COULEUR_SOL: u32 = c(0xe09729);
const COULEUR_MUR: u32 = c(0x04e5ff);

const NIVEAU_1: i32 = s("level1");

enum Direction {
  IMMOBILE = 0,
  HAUT = 1,
  DROITE = 2,
  BAS = 3,
  GAUCHE = 4,
}

enum EtatJeu {
  EN_COURS = 0,
  FIN = 1,
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

function donneDir(dx: i32, dy: i32): u8 {
  if (dx == 0 && dy == -1) return Direction.HAUT as u8;
  if (dx == 1 && dy == 0) return Direction.DROITE as u8;
  if (dx == 0 && dy == 1) return Direction.BAS as u8;
  if (dx == -1 && dy == 0) return Direction.GAUCHE as u8;
  return Direction.IMMOBILE as u8;
}

function choisisDirValide(x: u8, y: u8, dir: u8, couleur: u32): u8 {
  const startDir = dir == Direction.IMMOBILE ? Direction.HAUT as u8 : dir;
  const startDX = deltaDirX(startDir);
  const startDY = deltaDirY(startDir);
  for (let essais = 0; essais < 4; essais++) {
    let dx = startDX;
    let dy = startDY;
    if (essais == 1) {
      const tmp = dx;
      dx = -dy;
      dy = tmp;
    } else if (essais == 2) {
      const tmp = dx;
      dx = dy;
      dy = -tmp;
    } else if (essais == 3) {
      const tmp = dx;
      dx = -dy;
      dy = tmp;
    }
    const nx = x + dx;
    const ny = y + dy;
    if (caseCouleur(nx, ny, couleur)) return donneDir(dx, dy);
  }
  return Direction.IMMOBILE as u8;
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
  drawSprite(s("player"), baseX, baseY);
}

function dessineCroco(x: u8, y: u8): void {
  const baseX = (x as i32) * CASE_DIM_PIXELS;
  const baseY = (y as i32) * CASE_DIM_PIXELS;
  drawSprite(s("crocodile"), baseX, baseY);
}

function trouvePointDepart(couleur: u32): u16 {
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
  return 0xffff;
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
  const posCrocoRouge = trouvePointDepart(COULEUR_CROCO_ROUGE);
  if (posCrocoRouge == 0xffff) {
    vars.croco0X = 0xff;
    vars.croco0Y = 0xff;
    vars.croco0Dir = Direction.IMMOBILE as u8;
  } else {
    vars.croco0X = (posCrocoRouge & 0xff) as u8;
    vars.croco0Y = ((posCrocoRouge >> 8) & 0xff) as u8;
    vars.croco0Dir = Direction.DROITE as u8;
  }

  // Trouve le point de départ du crocodile violet
  const posCrocoViolet = trouvePointDepart(COULEUR_CROCO_VIOLET);
  if (posCrocoViolet == 0xffff) {
    vars.croco1X = 0xff;
    vars.croco1Y = 0xff;
    vars.croco1Dir = Direction.IMMOBILE as u8;
  } else {
    vars.croco1X = (posCrocoViolet & 0xff) as u8;
    vars.croco1Y = ((posCrocoViolet >> 8) & 0xff) as u8;
    vars.croco1Dir = Direction.BAS as u8;
  }

  // Trouve le point de départ du crocodile vert
  const posCrocoVert = trouvePointDepart(COULEUR_CROCO_VERT);
  if (posCrocoVert == 0xffff) {
    vars.croco2X = 0xff;
    vars.croco2Y = 0xff;
    vars.croco2Dir = Direction.IMMOBILE as u8;
  } else {
    vars.croco2X = (posCrocoVert & 0xff) as u8;
    vars.croco2Y = ((posCrocoVert >> 8) & 0xff) as u8;
    vars.croco2Dir = Direction.HAUT as u8;
  }
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
      COULEUR_CROCO_VERT
    );
    vars.croco2X = (posXYDir & 0xff) as u8;
    vars.croco2Y = ((posXYDir >> 8) & 0xff) as u8;
    vars.croco2Dir = ((posXYDir >> 16) & 0xff) as u8;

    vars.minuteurDeplCroc = CROCO_DEPL_DELAI;
  }

  if (verifiePositionJoueur(vars.joueurX, vars.joueurY)) {
    vars.etat = EtatJeu.FIN as u8;
  }
}

// Dessine la grille et les crocodiles
export function draw(): void {
  dessineGrille();

  dessineCroco(vars.croco0X, vars.croco0Y);
  dessineCroco(vars.croco1X, vars.croco1Y);
  dessineCroco(vars.croco2X, vars.croco2Y);

  dessineTeteJoueur(vars.joueurX, vars.joueurY);

  if (vars.etat == EtatJeu.FIN) {
    drawStartMessageBox("IL VA TE MANGER...", c(0x2a1a1a), c(0xffaa00));
  }
}
