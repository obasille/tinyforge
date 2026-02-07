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
  drawSpriteScaledDown,
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
const NB_TUNNELS: i32 = 2;
const TUNNEL_CYCLE_TICKS: u16 = 600; // 10s @ 60fps
const TUNNEL_ANIM_TICKS: u8 = 12;
const NB_PIEGES: i32 = 4;
const PIEGE_MIN_TICKS: u16 = 120; // 2s @ 60fps
const PIEGE_MAX_TICKS: u16 = 300; // 5s @ 60fps

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
  Tunnel1 = c(0x707070),
  Tunnel2 = c(0x909090),
  Piège = c(0xffff00),
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
  tunnelPhase: u8;
  tunnelTimer: u16;
  _fin: u8;
}

@unmanaged
class Joueur {
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

@unmanaged
class Viande {
  x: u8;
  y: u8;
}

@unmanaged
class Tunnel {
  present: u8; // 0 = pas de tunnel trouvé, 1 = tunnel présent
  x0: u8;
  y0: u8;
  x1: u8;
  y1: u8;
  ouvert: u8;
}

@unmanaged
class Piège {
  present: u8; // 0 = pas de piège trouvé, 1 = piège présent
  x: u8;
  y: u8;
  actif: u8; // 0 = piège désactivé, 1 = piège actif
  timer: u16; // Timer pour le changement d'état
}

const jeu = changetype<Jeu>(RAM_START);
const szVars = offsetof<Jeu>("_fin");
const szJoueur: usize = (offsetof<Joueur>("startupDelay") + 4) & ~3;
const szCroco: usize = (offsetof<Croco>("casesDepuisChgmDir") + 4) & ~3;
const szViande: usize = (offsetof<Viande>("y") + 4) & ~3;
const szTunnel: usize = (offsetof<Tunnel>("ouvert") + 4) & ~3;
const szPiège: usize = (offsetof<Piège>("timer") + 4) & ~3;
let offset: usize = RAM_START + szVars;
const joueur = changetype<Joueur>(offset);
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

const lesCrocos: Croco[] = [croco0, croco1, croco2];
const lesViandes: Viande[] = [viande0, viande1, viande2];
const lesTunnels: Tunnel[] = [tunnel0, tunnel1];
const lesPièges: Piège[] = [piège0, piège1, piège2, piège3];

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

function ecritCouleurCase(x: i32, y: i32, couleur: u32): void {
  store<u32>(adresseNiveau + (y * LARGEUR_GRILLE + x) * 4, couleur);
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

function estCaseGamelle(x: u8, y: u8): bool {
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    if (croco.gamelleX == x && croco.gamelleY == y) return true;
  }
  return false;
}

function estCaseViande(x: u8, y: u8): bool {
  for (let i: i32 = 0; i < 3; i++) {
    const v = lesViandes[i];
    if (v.x == x && v.y == y && v.x != INVALIDE) return true;
  }
  return false;
}

function estCaseTunnel(x: u8, y: u8): bool {
  for (let i: i32 = 0; i < NB_TUNNELS; i++) {
    const t = lesTunnels[i];
    if (!t.present) continue;
    if (t.x0 == x && t.y0 == y) return true;
    if (t.x1 == x && t.y1 == y) return true;
  }
  return false;
}

function caseLibrePourTunnel(x: u8, y: u8): bool {
  if (!peutBouger(x, y)) return false;
  if (estCaseGamelle(x, y)) return false;
  if (estCaseViande(x, y)) return false;
  if (estCaseTunnel(x, y)) return false;
  return true;
}

function distManhattan(x1: u8, y1: u8, x2: u8, y2: u8): i32 {
  let dx = (x1 as i32) - (x2 as i32);
  if (dx < 0) dx = -dx;
  let dy = (y1 as i32) - (y2 as i32);
  if (dy < 0) dy = -dy;
  return dx + dy;
}

function trouveCaseLibreTunnel(): u16 {
  let essais: i32 = 0;
  while (essais < 200) {
    const x = randomRange(LARGEUR_GRILLE) as u8;
    const y = randomRange(HAUTEUR_GRILLE) as u8;
    if (caseLibrePourTunnel(x, y)) return ((y as u16) << 8) | (x as u16);
    essais++;
  }
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      const ux = x as u8;
      const uy = y as u8;
      if (caseLibrePourTunnel(ux, uy)) return ((uy as u16) << 8) | (ux as u16);
    }
  }
  return INVALIDE_POS;
}

function initTunnel(index: u8): void {
  const tunnel = lesTunnels[index];
  const couleur = index == 0 ? Couleurs.Tunnel1 : Couleurs.Tunnel2;
  
  // Trouve tous les pixels de cette couleur
  let count: i32 = 0;
  let pos0: u16 = INVALIDE_POS;
  let pos1: u16 = INVALIDE_POS;
  
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      if (litCouleurCase(x, y) == couleur) {
        if (count == 0) {
          pos0 = ((y as u16) << 8) | (x as u16);
        } else if (count == 1) {
          pos1 = ((y as u16) << 8) | (x as u16);
        }
        count++;
      }
    }
  }
  
  // Log des avertissements si nécessaire
  if (count == 1) {
    warn("Tunnel " + index.toString() + ": seulement 1 pixel trouvé");
  } else if (count > 2) {
    warn("Tunnel " + index.toString() + ": " + count.toString() + " pixels trouvés (2 attendus)");
  }
  
  // Configure le tunnel si exactement 2 pixels trouvés
  if (count == 2) {
    tunnel.x0 = (pos0 & 0xff) as u8;
    tunnel.y0 = ((pos0 >> 8) & 0xff) as u8;
    tunnel.x1 = (pos1 & 0xff) as u8;
    tunnel.y1 = ((pos1 >> 8) & 0xff) as u8;
    tunnel.ouvert = 0;
    tunnel.present = 1;
  } else {
    tunnel.x0 = INVALIDE;
    tunnel.y0 = INVALIDE;
    tunnel.x1 = INVALIDE;
    tunnel.y1 = INVALIDE;
    tunnel.ouvert = 0;
    tunnel.present = 0;
  }
}

function initPiège(index: u8): void {
  const piège = lesPièges[index];
  
  // Trouve le Nième pixel de couleur Piège
  let count: i32 = 0;
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      if (litCouleurCase(x, y) == Couleurs.Piège) {
        if (count == (index as i32)) {
          piège.x = x as u8;
          piège.y = y as u8;
          piège.actif = 0; // Commence désactivé
          piège.present = 1;
          // Timer aléatoire initial entre 2 et 5 secondes
          piège.timer = (PIEGE_MIN_TICKS + randomRange((PIEGE_MAX_TICKS - PIEGE_MIN_TICKS) as i32)) as u16;
          return;
        }
        count++;
      }
    }
  }
  
  // Pas de piège trouvé à cet index
  piège.x = INVALIDE;
  piège.y = INVALIDE;
  piège.actif = 0;
  piège.present = 0;
  piège.timer = 0;
}

function majPièges(): void {
  for (let i: i32 = 0; i < NB_PIEGES; i++) {
    const piège = lesPièges[i];
    if (!piège.present) continue;
    
    if (piège.timer > 0) {
      piège.timer--;
    } else {
      // Change l'état du piège
      piège.actif = piège.actif == 1 ? 0 : 1;
      // Nouveau timer aléatoire entre 2 et 5 secondes
      piège.timer = (PIEGE_MIN_TICKS + randomRange((PIEGE_MAX_TICKS - PIEGE_MIN_TICKS) as i32)) as u16;
    }
  }
}

function verifieCollisionPieges(): void {
  if (joueur.invincible > 0) return;
  
  for (let i: i32 = 0; i < NB_PIEGES; i++) {
    const piege = lesPièges[i];
    if (!piege.present || !piege.actif) continue;
    
    if (joueur.x == piege.x && joueur.y == piege.y) {
      // Perte d'une vie
      if (jeu.vies > 0) jeu.vies--;
      joueur.invincible = INVINCIBLE_TICKS;
      if (jeu.vies == 0) {
        jeu.etat = EtatJeu.FIN as u8;
      }
      return;
    }
  }
}

function dessinePiège(piege: Piège): void {
  if (!piege.present || piege.x == INVALIDE) return;
  const baseX = (piege.x as i32) * TAILLE_CASE;
  const baseY = (piege.y as i32) * TAILLE_CASE;
  
  if (piege.actif) {
    // Piège actif - dessine en rouge
    fillRect(baseX, baseY, TAILLE_CASE, TAILLE_CASE, c(0xff0000));
  } else {
    // Piège inactif - dessine en gris
    fillRect(baseX, baseY, TAILLE_CASE, TAILLE_CASE, c(0x808080));
  }
}

function majOuvertureTunnels(): void {
  if (jeu.tunnelTimer > 0) {
    jeu.tunnelTimer--;
  } else {
    if (jeu.tunnelPhase == 0) {
      if (tunnel0.present) tunnel0.ouvert = 1;
      if (tunnel1.present) tunnel1.ouvert = 0;
      jeu.tunnelPhase = 1;
    } else if (jeu.tunnelPhase == 1) {
      if (tunnel0.present) tunnel0.ouvert = 0;
      jeu.tunnelPhase = 2;
    } else if (jeu.tunnelPhase == 2) {
      if (tunnel1.present) tunnel1.ouvert = 1;
      jeu.tunnelPhase = 3;
    } else {
      if (tunnel1.present) tunnel1.ouvert = 0;
      jeu.tunnelPhase = 0;
    }
    jeu.tunnelTimer = TUNNEL_CYCLE_TICKS;
  }
}

function essaieTeleportTunnel(): void {
  const px = joueur.x;
  const py = joueur.y;
  if (joueur.tunnelEtat != 0) return;

  let destX = INVALIDE;
  let destY = INVALIDE;
  
  for (let i: i32 = 0; i < NB_TUNNELS; i++) {
    const t = lesTunnels[i];
    if (!t.present || !t.ouvert) continue;
    
    if (px == t.x0 && py == t.y0) {
      destX = t.x1;
      destY = t.y1;
      break;
    } else if (px == t.x1 && py == t.y1) {
      destX = t.x0;
      destY = t.y0;
      break;
    }
  }

  if (destX == INVALIDE) return;

  joueur.tunnelEtat = 1;
  joueur.tunnelTimer = TUNNEL_ANIM_TICKS;
  joueur.tunnelDestX = destX;
  joueur.tunnelDestY = destY;
  joueur.dirDepl = Direction.IMMOBILE as u8;
}

function majTunnelAnimJoueur(): void {
  if (joueur.tunnelEtat == 0) return;
  if (joueur.tunnelTimer > 0) {
    joueur.tunnelTimer--;
    if (joueur.tunnelTimer > 0) return;
  }
  if (joueur.tunnelEtat == 1) {
    joueur.x = joueur.tunnelDestX;
    joueur.y = joueur.tunnelDestY;
    joueur.tunnelEtat = 2;
    joueur.tunnelTimer = TUNNEL_ANIM_TICKS;
  } else {
    joueur.tunnelEtat = 0;
    joueur.tunnelTimer = 0;
  }
}

function dessineTunnel(x: u8, y: u8, ouvert: u8): void {
  if (x == INVALIDE || y == INVALIDE) return;
  const baseX = (x as i32) * TAILLE_CASE;
  const baseY = (y as i32) * TAILLE_CASE;
  const sprite = ouvert == 1 ? s("tunnel") : s("tunnel_closed");
  drawSprite(sprite, baseX, baseY);
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
  drawSpriteScaled(NIVEAU_1, 0, 0, 16, 16);
}

function dessineTeteJoueur(): void {
  let renderX = joueur.x as f32;
  let renderY = joueur.y as f32;
  // Interpoler le mouvement tant que le timer est actif
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
  let scaleNum: i32 = 8;
  if (joueur.tunnelEtat == 1) {
    scaleNum = ((joueur.tunnelTimer as i32) * 8) / (TUNNEL_ANIM_TICKS as i32);
  } else if (joueur.tunnelEtat == 2) {
    scaleNum = 8 - (((joueur.tunnelTimer as i32) * 8) / (TUNNEL_ANIM_TICKS as i32));
  }
  if (scaleNum <= 0) return;
  if (scaleNum >= 8) {
    drawSprite(s("player"), baseX, baseY, false, false, alpha);
  } else {
    drawSpriteScaledDown(s("player"), baseX, baseY, scaleNum, 8);
  }
  
  // Dessine la viande portée au-dessus du joueur
  if (joueur.viandePortee != INVALIDE && scaleNum >= 8) {
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
  const v = lesViandes[index];
  return ((v.y as u16) << 8) | (v.x as u16);
}

function metViandePos(index: u8, x: u8, y: u8): void {
  const v = lesViandes[index];
  v.x = x;
  v.y = y;
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
  if (joueur.tunnelEtat != 0) return;
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
  const spawn = trouveNiemePoint(Couleurs.Sol, 0);
  if (spawn != INVALIDE_POS) {
    joueur.x = (spawn & 0xff) as u8;
    joueur.y = ((spawn >> 8) & 0xff) as u8;
  } else {
    joueur.x = (LARGEUR_GRILLE / 2) as u8;
    joueur.y = (HAUTEUR_GRILLE / 2) as u8;
  }
  joueur.viandePortee = INVALIDE; // Aucune viande portée au départ
  joueur.minuteurDepl = 0;
  joueur.invincible = 0;
  joueur.dirDepl = Direction.IMMOBILE as u8;
  joueur.tunnelEtat = 0;
  joueur.tunnelTimer = 0;
  joueur.tunnelDestX = INVALIDE;
  joueur.tunnelDestY = INVALIDE;
  joueur.startupDelay = 60; // 1 seconde à 60fps

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

  // Initialise les tunnels
  jeu.tunnelPhase = 0;
  jeu.tunnelTimer = TUNNEL_CYCLE_TICKS;
  for (let i: i32 = 0; i < NB_TUNNELS; i++) {
    initTunnel(i as u8);
  }

  // Initialise les pièges
  for (let i = 0; i < NB_PIEGES; i++) {
    initPiège(i as u8);
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
  
  // Si le jeu est terminé, continuer à animer le mouvement du joueur
  if (etat != EtatJeu.EN_COURS) {
    if (joueur.minuteurDepl > 0) joueur.minuteurDepl--;
    return;
  }

  // Gestion de l'animation de démarrage
  if (joueur.startupDelay > 0) {
    joueur.startupDelay--;
    if (joueur.startupDelay == 0) {
      // Déclenche l'animation d'apparition (même que sortie de tunnel)
      joueur.tunnelEtat = 2;
      joueur.tunnelTimer = TUNNEL_ANIM_TICKS;
    }
    return; // Ne rien faire pendant le délai de démarrage
  }

  // Décrémenter les minuteurs de mouvement
  if (joueur.minuteurDepl > 0) joueur.minuteurDepl--;
  if (joueur.invincible > 0) joueur.invincible--;
  majPièges();
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    if (lesCrocos[i].minuteurDepl > 0) lesCrocos[i].minuteurDepl--;
  }
  majTunnelAnimJoueur();
  majOuvertureTunnels();

  // Gestion du mouvement du joueur
  deplaceJoueur();

  if (buttonPressed(Button.A)) {
    essaieTeleportTunnel();
  }

  // Déposer/ramasser la viande si besoin
  if (joueur.tunnelEtat == 0) {
    deposeViande(joueur.x, joueur.y);
    ramasseViande(joueur.x, joueur.y);
  }

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
    if (jeu.vies == 0) {
      jeu.etat = EtatJeu.FIN as u8;
    } else {
      joueur.invincible = INVINCIBLE_TICKS;
    }
  }

  // Vérifier si le joueur touche un piège actif
  verifieCollisionPieges();
}

// Dessine la grille et les crocodiles
export function draw(): void {
  dessineGrille();
  // Colorie tous les cases
  for (let y: i32 = 0; y < HAUTEUR_GRILLE; y++) {
    for (let x: i32 = 0; x < LARGEUR_GRILLE; x++) {
      const estMur = caseCouleur(x, y, Couleurs.Mur);
      if (!estMur) {
        fillRect(
          x * TAILLE_CASE,
          y * TAILLE_CASE,
          TAILLE_CASE,
          TAILLE_CASE,
          // estMur ? Couleurs.Mur : Couleurs.Sol
          // litCouleurCase(x, y)
          Couleurs.Sol
        );
      }
    }
  }

  // Dessine les pièges
  for (let i: i32 = 0; i < NB_PIEGES; i++) {
    dessinePiège(lesPièges[i]);
  }

  // Dessine les tunnels
  for (let i: i32 = 0; i < NB_TUNNELS; i++) {
    const t = lesTunnels[i];
    if (!t.present) continue;
    dessineTunnel(t.x0, t.y0, t.ouvert);
    dessineTunnel(t.x1, t.y1, t.ouvert);
  }

  // Dessine les gamelles
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    dessineGamelle(croco.gamelleX, croco.gamelleY, croco.gamelleRemplie);
  }

  // Dessine les viandes
  for (let i: i32 = 0; i < 3; i++) {
    const v = lesViandes[i];
    dessineViande(v.x, v.y);
  }

  // Dessine les crocodiles
  for (let i: i32 = 0; i < NB_CROCOS; i++) {
    const croco = lesCrocos[i];
    dessineCroco(croco);
  }

  // Dessine le joueur (sauf pendant le délai de démarrage)
  if (joueur.startupDelay == 0) {
    dessineTeteJoueur();
  }

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
