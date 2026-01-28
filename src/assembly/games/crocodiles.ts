// cspell:language en,fr
// CROCODILES - Jeu TinyForge
// Ramassez les viandes et déposez-les dans les gamelles pour nourrir les crocodiles.
// Objectif : Remplir les 3 gamelles pour gagner !
// Attention : Évitez de vous faire attraper par les crocodiles qui patrouillent le niveau.
// Contrôles : Flèches pour se déplacer, START pour redémarrer.

// Quand le joueur est sur le chemin d'un crocodile (tel qu'identifé par la couleur du pixel correspondant dans le sprite du level), double la vitesse du croco concerné. Utilise CrocoInfo pour stocker la vitesse

import {
  Button,
  HEIGHT,
  RAM_START,
  WIDTH,
  buttonDown,
  buttonPressed,
  c,
  drawSprite,
  drawSpriteScaled,
  drawStartMessageBox,
  fillRect,
  getLastSpriteAddress,
  getLastSpriteHeight,
  getLastSpriteWidth,
  randomRange,
  readSpriteInfo,
  s,
  warn,
} from "../sdk";

// === Constantes ===
const TAILLE_CASE: i32 = 16;
const LARGEUR_GRILLE: i32 = WIDTH / TAILLE_CASE;
const HAUTEUR_GRILLE: i32 = HEIGHT / TAILLE_CASE;

const JOUEUR_DEPL_DELAI: u8 = 6;
const CROCO_DEPL_DELAI: u8 = 30;
const NB_CROCOS: i32 = 3;
const VIES_DEPART: u8 = 3;
const INVINCIBLE_TICKS: u8 = 180; // ~3s @ 60fps

const INVALIDE: u8 = 0xff;
const INVALIDE_POS: u16 = 0xffff;

enum Couleurs {
  MessageBoxFond = c(0x2a1a1a),
  MessageBoxTexte = c(0xffaa00),
  MessageBoxFondVictoire = c(0x1a2a1a),
  MessageBoxTexteVictoire = c(0x00ff00),
  CrocoRouge = c(0xff0000),
  CrocoViolet = c(0xff00ff),
  CrocoVert = c(0x00ff00),
  Sol = c(0xe09729),
  Mur = c(0x04e5ff),
  Viande = c(0xba0b0b),
  Gamelle = c(0x583de8),
}

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
  VICTOIRE = 2,
}

// === Système de variables en RAM ===

@unmanaged
class Jeu {
  etat: u8;
  vies: u8;
  viande0PosX: u8;
  viande0PosY: u8;
  viande1PosX: u8;
  viande1PosY: u8;
  viande2PosX: u8;
  viande2PosY: u8;
  _fin: u8;
}

@unmanaged
class Joueur {
  x: u8;
  y: u8;
  minuteurDepl: u8;
  viandePortee: u8;
  invincible: u8;
  dirDepl: u8;
}

@unmanaged
class Croco {
  x: u8;
  y: u8;
  dir: u8;
  minuteurDepl: u8;
  gamelleX: u8;
  gamelleY: u8;
  gamelleRemplie: u8; // 0 = vide, 1 = remplie
  attaque: u8; // 0 = normal, 1 = attaque
  casesDepuisChgmDir: u8;
}

const jeu = changetype<Jeu>(RAM_START);
const szVars = offsetof<Jeu>("_fin");
const szJoueur: usize = (offsetof<Joueur>("dirDepl") + 4) & ~3;
const szCroco: usize = (offsetof<Croco>("casesDepuisChgmDir") + 4) & ~3;
let offset: usize = RAM_START + szVars;
const joueur = changetype<Joueur>(offset);
offset += szJoueur;
const croco0 = changetype<Croco>(offset);
offset += szCroco;
const croco1 = changetype<Croco>(offset);
offset += szCroco;
const croco2 = changetype<Croco>(offset);

const lesCrocos: Croco[] = [croco0, croco1, croco2];
const couleursCrocos: u32[] = [
  Couleurs.CrocoRouge,
  Couleurs.CrocoViolet,
  Couleurs.CrocoVert,
];

// === Niveau ===

const NIVEAU_1: i32 = s("level1");
let adresseNiveau: usize = 0;

// === Fonctions auxiliaires ===

function litCouleurCase(x: i32, y: i32): u32 {
  return load<u32>(adresseNiveau + (y * LARGEUR_GRILLE + x) * 4);
}

function caseCouleur(x: i32, y: i32, couleur: u32): bool {
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    const pixel = litCouleurCase(x, y);
    return pixel == couleur;
  }
  return false;
}

function peutBouger(x: i32, y: i32): bool {
  if (x >= 0 && x < LARGEUR_GRILLE && y >= 0 && y < HAUTEUR_GRILLE) {
    const pixel = litCouleurCase(x, y);
    if (pixel != Couleurs.Mur) {
      return true;
    }
  }
  return false;
}

function caseAutorisee(x: i32, y: i32, couleur: u32, utiliseCouleur: bool): bool {
  if (x < 0 || x >= LARGEUR_GRILLE || y < 0 || y >= HAUTEUR_GRILLE) return false;
  const estCouleur = litCouleurCase(x, y) == couleur;
  return utiliseCouleur ? estCouleur : !estCouleur;
}

const cheminPrev = new StaticArray<i32>(LARGEUR_GRILLE * HAUTEUR_GRILLE);
const cheminQueue = new StaticArray<i32>(LARGEUR_GRILLE * HAUTEUR_GRILLE);
const cheminDx: i32[] = [0, 0, -1, 1];
const cheminDy: i32[] = [-1, 1, 0, 0];

function prochaineCaseChemin(
  departX: u8,
  departY: u8,
  cibleX: u8,
  cibleY: u8,
  couleur: u32,
  utiliseCouleur: bool
): u16 {
  if (departX == cibleX && departY == cibleY) {
    return ((departY as u16) << 8) | (departX as u16);
  }

  if (
    !caseAutorisee(departX, departY, couleur, utiliseCouleur) ||
    !caseAutorisee(cibleX, cibleY, couleur, utiliseCouleur)
  ) {
    return ((departY as u16) << 8) | (departX as u16);
  }

  const total = LARGEUR_GRILLE * HAUTEUR_GRILLE;
  for (let i: i32 = 0; i < total; i++) cheminPrev[i] = -1;

  const idxDepart = departY * LARGEUR_GRILLE + departX;
  const idxCible = cibleY * LARGEUR_GRILLE + cibleX;
  let head: i32 = 0;
  let tail: i32 = 0;
  cheminQueue[tail++] = idxDepart;
  cheminPrev[idxDepart] = idxDepart;

  while (head < tail) {
    const idx = cheminQueue[head++];
    if (idx == idxCible) break;
    const cx = idx % LARGEUR_GRILLE;
    const cy = idx / LARGEUR_GRILLE;
    for (let d: i32 = 0; d < 4; d++) {
      let nx = cx + cheminDx[d];
      let ny = cy + cheminDy[d];
      if (nx < 0) nx = LARGEUR_GRILLE - 1;
      else if (nx >= LARGEUR_GRILLE) nx = 0;
      if (ny < 0) ny = HAUTEUR_GRILLE - 1;
      else if (ny >= HAUTEUR_GRILLE) ny = 0;
      if (!caseAutorisee(nx, ny, couleur, utiliseCouleur)) continue;
      const nidx = ny * LARGEUR_GRILLE + nx;
      if (cheminPrev[nidx] != -1) continue;
      cheminPrev[nidx] = idx;
      cheminQueue[tail++] = nidx;
    }
  }

  if (cheminPrev[idxCible] == -1) {
    return ((departY as u16) << 8) | (departX as u16);
  }

  let cur = idxCible;
  while (cheminPrev[cur] != idxDepart) {
    cur = cheminPrev[cur];
    if (cur == idxDepart) break;
  }
  const nx = (cur % LARGEUR_GRILLE) as u8;
  const ny = (cur / LARGEUR_GRILLE) as u8;
  return ((ny as u16) << 8) | (nx as u16);
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

const tableauDir = new StaticArray<u8>(4);

function choisisDirValide(x: u8, y: u8, dir: u8, couleur: u32): u8 {
  let dirRetour = Direction.IMMOBILE as u8;
  if (dir == Direction.HAUT) dirRetour = Direction.BAS as u8;
  else if (dir == Direction.BAS) dirRetour = Direction.HAUT as u8;
  else if (dir == Direction.GAUCHE) dirRetour = Direction.DROITE as u8;
  else if (dir == Direction.DROITE) dirRetour = Direction.GAUCHE as u8;

  let count: i32 = 0;

  for (let d: u8 = 1; d <= 4; d++) {
    if (d == dirRetour) continue;
    if (!dirValidePourCouleur(x, y, d, couleur)) continue;
    tableauDir[count] = d;
    count++;
  }

  if (count == 1) return tableauDir[0];
  if (count >= 2) {
    const r = randomRange(count);
    return tableauDir[r];
  }

  if (dirRetour != Direction.IMMOBILE && dirValidePourCouleur(x, y, dirRetour, couleur)) {
    return dirRetour;
  }
  return Direction.IMMOBILE as u8;
}

function dirValidePourCouleur(x: u8, y: u8, dir: u8, couleur: u32): bool {
  const nx = (x as i32) + deltaDirX(dir);
  const ny = (y as i32) + deltaDirY(dir);
  return caseCouleur(nx, ny, couleur);
}

function dirAttaqueCroco(croco: Croco, couleur: u32, jx: u8, jy: u8): u8 {
  let meilleurDir = croco.dir;
  let meilleurDist: i32 = 0x7fffffff;
  for (let dir: u8 = 1; dir <= 4; dir++) {
    if (!dirValidePourCouleur(croco.x, croco.y, dir, couleur)) continue;
    const nx = (croco.x as i32) + deltaDirX(dir);
    const ny = (croco.y as i32) + deltaDirY(dir);
    let dx = (jx as i32) - nx;
    if (dx < 0) dx = -dx;
    let dy = (jy as i32) - ny;
    if (dy < 0) dy = -dy;
    const dist = dx + dy;
    if (dist < meilleurDist || (dist == meilleurDist && dir == croco.dir)) {
      meilleurDist = dist;
      meilleurDir = dir;
    }
  }
  return meilleurDir;
}

function verifiePositionJoueur(px: u8, py: u8): bool {
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    if (croco.x == px && croco.y == py) return true;
  }
  return false;
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
  let renderX = x as f32;
  let renderY = y as f32;
  if (joueur.minuteurDepl > 0 && joueur.dirDepl != Direction.IMMOBILE) {
    const frac = (joueur.minuteurDepl as f32) / (JOUEUR_DEPL_DELAI as f32);
    const dx = deltaDirX(joueur.dirDepl) as f32;
    const dy = deltaDirY(joueur.dirDepl) as f32;
    renderX -= dx * frac;
    renderY -= dy * frac;
    if (renderX < 0.0) renderX += LARGEUR_GRILLE as f32;
    else if (renderX >= (LARGEUR_GRILLE as f32)) renderX -= LARGEUR_GRILLE as f32;
    if (renderY < 0.0) renderY += HAUTEUR_GRILLE as f32;
    else if (renderY >= (HAUTEUR_GRILLE as f32)) renderY -= HAUTEUR_GRILLE as f32;
  }
  const baseX = (renderX * (TAILLE_CASE as f32)) as i32;
  const baseY = (renderY * (TAILLE_CASE as f32)) as i32;
  let alpha: u8 = 255;
  if (joueur.invincible > 0) {
    const t = (joueur.invincible as i32) & 15;
    const tri = t < 8 ? t : (15 - t);
    alpha = (128 + (tri * 16)) as u8;
  }
  drawSprite(s("player"), baseX, baseY, false, false, alpha);
  
  // Dessine la viande portée au-dessus du joueur
  if (joueur.viandePortee != INVALIDE) {
    drawSprite(s("meat"), baseX + TAILLE_CASE / 3, baseY + TAILLE_CASE / 3);
  }
}

function dessineCroco(croco: Croco): void {
  let renderX = croco.x as f32;
  let renderY = croco.y as f32;
  if (croco.dir != Direction.IMMOBILE && croco.minuteurDepl > 0) {
    const delai = croco.attaque == 1
      ? ((CROCO_DEPL_DELAI / 2) as i32)
      : (CROCO_DEPL_DELAI as i32);
    if (delai > 0) {
      const frac = (croco.minuteurDepl as f32) / (delai as f32);
      const dx = deltaDirX(croco.dir) as f32;
      const dy = deltaDirY(croco.dir) as f32;
      renderX -= dx * frac;
      renderY -= dy * frac;
      if (renderX < 0.0) renderX += LARGEUR_GRILLE as f32;
      else if (renderX >= (LARGEUR_GRILLE as f32)) renderX -= LARGEUR_GRILLE as f32;
      if (renderY < 0.0) renderY += HAUTEUR_GRILLE as f32;
      else if (renderY >= (HAUTEUR_GRILLE as f32)) renderY -= HAUTEUR_GRILLE as f32;
    }
  }
  const baseX = (renderX * (TAILLE_CASE as f32)) as i32;
  const baseY = (renderY * (TAILLE_CASE as f32)) as i32;
  const sprite = croco.attaque == 1 ? s("crocodile_bloody") : s("crocodile");
  drawSprite(sprite, baseX, baseY);
}

function dessineViande(x: u8, y: u8): void {
  // Ne dessine pas si la position est invalide
  if (x == INVALIDE || y == INVALIDE) return;
  const baseX = (x as i32) * TAILLE_CASE;
  const baseY = (y as i32) * TAILLE_CASE;
  drawSprite(s("meat"), baseX, baseY);
}

function dessineGamelle(x: u8, y: u8, remplie: u8): void {
  // Ne dessine pas si la position est invalide
  if (x == INVALIDE || y == INVALIDE) return;
  const baseX = (x as i32) * TAILLE_CASE;
  const baseY = (y as i32) * TAILLE_CASE;
  drawSprite(s("plate"), baseX, baseY);
  
  // Dessiner la viande sur la gamelle si elle est remplie
  if (remplie == 1) {
    drawSprite(s("meat"), baseX, baseY);
  }
}

function trouvePointDepart(couleur: u32): u16 {
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      const pixel = litCouleurCase(x, y);
      if (pixel == couleur) {
        return ((y as u16) << 8) | (x as u16);
      }
    }
  }
  return INVALIDE_POS;
}

function trouveNiemePoint(couleur: u32, index: i32): u16 {
  let compteur: i32 = 0;
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      const pixel = litCouleurCase(x, y);
      if (pixel == couleur) {
        if (compteur == index) {
          return ((y as u16) << 8) | (x as u16);
        }
        compteur++;
      }
    }
  }
  return INVALIDE_POS;
}

function trouveCrocoPourGamelle(x: u8, y: u8): u8 {
  const gx = x as i32;
  const gy = y as i32;

  function indexCouleur(couleur: u32): u8 {
    for (let i: i32 = 0; i < NB_CROCOS; i++) {
      if (couleursCrocos[i] == couleur) return i as u8;
    }
    return INVALIDE;
  }

  const dx: i32[] = [0, 0, -1, 1];
  const dy: i32[] = [-1, 1, 0, 0];
  for (let i: i32 = 0; i < 4; i++) {
    const nx = gx + dx[i];
    const ny = gy + dy[i];
    if (nx < 0 || ny < 0 || nx >= LARGEUR_GRILLE || ny >= HAUTEUR_GRILLE) continue;
    const idx = indexCouleur(litCouleurCase(nx, ny));
    if (idx != INVALIDE) return idx;
  }
  return INVALIDE;
}

function initCroco(index: u8, croco: Croco, couleur: u32): void {
  const pos = trouvePointDepart(couleur);
  if (pos == INVALIDE_POS) {
    warn("Crocodile " + index.toString() + " non trouvé");
    croco.x = INVALIDE;
    croco.y = INVALIDE;
    croco.dir = Direction.IMMOBILE as u8;
    return;
  }
  croco.x = (pos & 0xff) as u8;
  croco.y = ((pos >> 8) & 0xff) as u8;
  croco.dir = Direction.IMMOBILE as u8;
  croco.gamelleX = INVALIDE;
  croco.gamelleY = INVALIDE;
  croco.gamelleRemplie = 0; // Gamelles vides au départ
  croco.attaque = 0;
  croco.minuteurDepl = 0;
  croco.casesDepuisChgmDir = 0;
}

function assigneGamelle(index: u8): void {
  const pos = trouveNiemePoint(Couleurs.Gamelle, index as i32);
  if (pos == INVALIDE_POS) {
    warn("Gamelle " + index.toString() + " non trouvée");
    return;
  }
  const gx = (pos & 0xff) as u8;
  const gy = ((pos >> 8) & 0xff) as u8;
  const idx = trouveCrocoPourGamelle(gx, gy);
  if ((idx as i32) < NB_CROCOS) {
    const croco = lesCrocos[idx as i32];
    croco.gamelleX = gx;
    croco.gamelleY = gy;
  } else {
    warn("Gamelle " + index.toString() + " sans croco associé");
  }
}

function deplaceCroco(croco: Croco, couleur: u32): void {
  const oldX = croco.x;
  const oldY = croco.y;
  const oldDir = croco.dir;

  // Choisi la direction du crocodile
  let dir = croco.attaque == 1
    ? dirAttaqueCroco(croco, couleur, joueur.x, joueur.y)
    : choisisDirValide(croco.x, croco.y, croco.dir, couleur);

  // Si le crocodile attaque, on ne change pas de direction si on a changé de direction il y a moins de 2 cases
  if (croco.attaque == 1 && dir != oldDir && croco.casesDepuisChgmDir < 2) {
    dir = oldDir;
    // Si la direction choisie n'est pas valide, on choisit une nouvelle direction valide
    if (!dirValidePourCouleur(croco.x, croco.y, dir, couleur)) {
      dir = choisisDirValide(croco.x, croco.y, croco.dir, couleur);
    }
  }

  // Si la direction choisie n'est pas valide, on ne fait rien
  if (!dirValidePourCouleur(croco.x, croco.y, dir, couleur)) {
    croco.dir = Direction.IMMOBILE as u8;
    return;
  }

  // Déplace le crocodile
  croco.x = (croco.x + deltaDirX(dir)) as u8;
  croco.y = (croco.y + deltaDirY(dir)) as u8;
  croco.dir = dir;

  // Met à jour le compteur de cases depuis le dernier changement de direction
  if (croco.dir != oldDir) {
    croco.casesDepuisChgmDir = 0;
  } else if (croco.x != oldX || croco.y != oldY) {
    croco.casesDepuisChgmDir = (croco.casesDepuisChgmDir + 1) as u8;
  }
}

function doneViandePos(index: u8): u16 {
  if (index == 0) return ((jeu.viande0PosY as u16) << 8) | (jeu.viande0PosX as u16);
  if (index == 1) return ((jeu.viande1PosY as u16) << 8) | (jeu.viande1PosX as u16);
  return ((jeu.viande2PosY as u16) << 8) | (jeu.viande2PosX as u16);
}

function metViandePos(index: u8, x: u8, y: u8): void {
  if (index == 0) {
    jeu.viande0PosX = x;
    jeu.viande0PosY = y;
  } else if (index == 1) {
    jeu.viande1PosX = x;
    jeu.viande1PosY = y;
  } else {
    jeu.viande2PosX = x;
    jeu.viande2PosY = y;
  }
}

function initViande(index: u8): void {
  const pos = trouveNiemePoint(Couleurs.Viande, index as i32);
  if (pos == INVALIDE_POS) {
    if (index == 0) warn("Viande 0 non trouvée dans le niveau");
    else if (index == 1) warn("Viande 1 non trouvée dans le niveau");
    else warn("Viande 2 non trouvée dans le niveau");
    metViandePos(index, INVALIDE, INVALIDE);
    return;
  }
  metViandePos(index, (pos & 0xff) as u8, ((pos >> 8) & 0xff) as u8);
}

function ramasseViande(jx: u8, jy: u8): void {
  if (joueur.viandePortee != INVALIDE) return;
  for (let i: u8 = 0; i < 3; i++) {
    const pos = doneViandePos(i);
    const vx = (pos & 0xff) as u8;
    const vy = ((pos >> 8) & 0xff) as u8;
    if (vx == jx && vy == jy && vx != INVALIDE) {
      joueur.viandePortee = i;
      metViandePos(i, INVALIDE, INVALIDE);
      return;
    }
  }
}

function deposeViande(jx: u8, jy: u8): void {
  if (joueur.viandePortee == INVALIDE) return;
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    if (croco.gamelleX == jx && croco.gamelleY == jy && croco.gamelleRemplie == 0) {
      croco.gamelleRemplie = 1;
      joueur.viandePortee = INVALIDE;
      return;
    }
  }
}

function deplaceJoueur(): void {
  if (joueur.minuteurDepl != 0) return;
  let deplX: i32 = 0;
  let deplY: i32 = 0;

  if (buttonDown(Button.LEFT)) deplX = -1;
  else if (buttonDown(Button.RIGHT)) deplX = 1;
  else if (buttonDown(Button.UP)) deplY = -1;
  else if (buttonDown(Button.DOWN)) deplY = 1;

  if (deplX == 0 && deplY == 0) {
    joueur.dirDepl = Direction.IMMOBILE as u8;
    return;
  }

  let posX = (joueur.x as i32) + deplX;
  let posY = (joueur.y as i32) + deplY;

  if (posX == -1) posX = LARGEUR_GRILLE - 1;
  if (posX == LARGEUR_GRILLE) posX = 0;
  if (posY == -1) posY = HAUTEUR_GRILLE - 1;
  if (posY == HAUTEUR_GRILLE) posY = 0;

  if (peutBouger(posX, posY)) {
    joueur.x = posX as u8;
    joueur.y = posY as u8;
    joueur.dirDepl = donneDir(deplX, deplY);
  } else {
    joueur.dirDepl = Direction.IMMOBILE as u8;
  }

  joueur.minuteurDepl = JOUEUR_DEPL_DELAI;
}

// === Cycle de vie ===

// Initialisation du jeu
export function init(): void {
  // Charge le niveau
  if (!readSpriteInfo(NIVEAU_1)) return;
  const largeur = getLastSpriteWidth();
  const hauteur = getLastSpriteHeight();
  adresseNiveau = getLastSpriteAddress();
  if (largeur != LARGEUR_GRILLE || hauteur != HAUTEUR_GRILLE) {
    warn("Taille niveau != grille");
    return;
  }

  // Initialise le joueur
  joueur.x = (LARGEUR_GRILLE / 2) as u8;
  joueur.y = (HAUTEUR_GRILLE / 2) as u8;
  joueur.viandePortee = INVALIDE; // Aucune viande portée au départ
  joueur.minuteurDepl = 0;
  joueur.invincible = 0;
  joueur.dirDepl = Direction.IMMOBILE as u8;

  // Initialise le jeu
  jeu.etat = EtatJeu.EN_COURS as u8;
  jeu.vies = VIES_DEPART;

  // Initialise les crocodiles
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    initCroco(i as u8, croco, couleursCrocos[i]);
  }

  // Trouve les positions des 3 viandes
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    initViande(i as u8);
  }

  // Trouve les positions des 3 gamelles
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    assigneGamelle(i as u8);
  }
}

// Mise à jour du jeu
export function update(): void {
  const etat = jeu.etat;
  
  // Gestion du redémarrage : appuyer sur START après la fin de partie
  if (etat != EtatJeu.EN_COURS && buttonPressed(Button.START)) {
    init();
    return;
  }
  
  // Ne rien faire si le jeu n'est pas en cours
  if (etat != EtatJeu.EN_COURS) return;

  // Décrémenter les minuteurs de mouvement
  if (joueur.minuteurDepl > 0) joueur.minuteurDepl--;
  if (joueur.invincible > 0) joueur.invincible--;
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    if (lesCrocos[i].minuteurDepl > 0) lesCrocos[i].minuteurDepl--;
  }

  // Gestion du mouvement du joueur
  deplaceJoueur();

  // Déposer/ramasser la viande si besoin
  deposeViande(joueur.x, joueur.y);
  ramasseViande(joueur.x, joueur.y);

  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    croco.attaque = caseCouleur(joueur.x, joueur.y, couleursCrocos[i]) ? 1 : 0;
  }

  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    if (croco.minuteurDepl == 0) {
      const couleur = couleursCrocos[i];
      deplaceCroco(croco, couleur);
      const delai =
        croco.attaque == 1 ? ((CROCO_DEPL_DELAI / 2) as u8) : CROCO_DEPL_DELAI;
      croco.minuteurDepl = delai == 0 ? 1 : delai;
    }
  }

  // Vérifier si toutes les gamelles sont remplies (victoire)
  let toutesGamellesRemplies = true;
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    if (lesCrocos[i].gamelleRemplie == 0) {
      toutesGamellesRemplies = false;
      break;
    }
  }
  if (toutesGamellesRemplies) {
    jeu.etat = EtatJeu.VICTOIRE as u8;
  }

  // Vérifier si le joueur touche un crocodile (perte de vie)
  if (joueur.invincible == 0 && verifiePositionJoueur(joueur.x, joueur.y)) {
    if (jeu.vies > 0) jeu.vies--;
    joueur.invincible = INVINCIBLE_TICKS;
    if (jeu.vies == 0) {
      jeu.etat = EtatJeu.FIN as u8;
    }
  }
}

// Dessine la grille et les crocodiles
export function draw(): void {
  dessineGrille();
  // Colorie tous les cases qui ne sont pas des murs
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      if (!caseCouleur(x, y, Couleurs.Mur)) {
        // Colorie la case
        fillRect(
          x * TAILLE_CASE,
          y * TAILLE_CASE,
          TAILLE_CASE,
          TAILLE_CASE,
          Couleurs.Sol
        );
      }
    }
  }

  // Dessine les gamelles
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    dessineGamelle(croco.gamelleX, croco.gamelleY, croco.gamelleRemplie);
  }

  // Dessine les viandes
  dessineViande(jeu.viande0PosX, jeu.viande0PosY);
  dessineViande(jeu.viande1PosX, jeu.viande1PosY);
  dessineViande(jeu.viande2PosX, jeu.viande2PosY);

  // Dessine les crocodiles
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    dessineCroco(croco);
  }

  // Dessine le joueur
  dessineTeteJoueur(joueur.x, joueur.y);

  // Affiche les vies en haut à droite avec un petit bounce
  const coeurX = WIDTH - TAILLE_CASE;
  const bounce = ((joueur.invincible >> 4) & 1) == 0 ? 0 : -2;
  const pasCoeur = TAILLE_CASE + 2;
  for (let i: i32 = 0; i < (jeu.vies as i32); i++) {
    const offsetY = (i & 1) == 0 ? bounce : -bounce;
    drawSprite(s("heart"), coeurX - (i * pasCoeur), offsetY);
  }

  if (jeu.etat == EtatJeu.FIN) {
    drawStartMessageBox("IL VA TE MANGER...", Couleurs.MessageBoxFond, Couleurs.MessageBoxTexte);
  } else if (jeu.etat == EtatJeu.VICTOIRE) {
    drawStartMessageBox("VICTOIRE!", Couleurs.MessageBoxFondVictoire, Couleurs.MessageBoxTexteVictoire);
  }
}
