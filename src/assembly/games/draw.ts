// NOTE: Tous les commentaires doivent être en français !
// Exemple de jeu TinyForge

// Importation du SDK console
import {
  Button,
  RAM_START,
  buttonDown,
  buttonPressed,
  c,
  clearFramebuffer,
  log,
  pset,
} from "../sdk";

// === Système de variables RAM ===
// Allocation de la RAM pour l'état persistant du jeu

@unmanaged
class GameVars {
  posAxe1: i32 = 0;
  posAxe2: i32 = 0;
  modeGomme: boolean = false;
  posAxe1Avant: i32 = 0;
  posAxe2Avant: i32 = 0;
  couleur: i32 = 0;
}

const vars = changetype<GameVars>(RAM_START);

// Couleurs
const blanc = c(0xffffff);
const noir = c(0x000000);
const vert = c(0x00ff00);

// === Cycle de vie ===

export function init(): void {
  clearFramebuffer(noir);

  // Initialise la position du joueur dans la RAM
  vars.posAxe1 = 160;
  vars.posAxe2 = 120;
  vars.modeGomme = false;
  vars.posAxe1Avant = 160;
  vars.posAxe2Avant = 120;
  vars.couleur = noir;
}

export function update(): void {
  let bouge = false;
  const posAxe1Avant = vars.posAxe1;
  const posAxe2Avant = vars.posAxe2;

  if (buttonDown(Button.A)) {
    // Mouvement continu si A est maintenu
    // Gauche
    if (buttonDown(Button.LEFT)) {
      vars.posAxe1 -= 1
      bouge = true;
    }
    // Droite
    if (buttonDown(Button.RIGHT)) {
      vars.posAxe1 += 1
      bouge = true;
    }
    // Haut
    if (buttonDown(Button.UP)) {
      vars.posAxe2 -= 1;
      bouge = true;
    }
    // Bas
    if (buttonDown(Button.DOWN)) {
      vars.posAxe2 += 1;
      bouge = true;
    }
  } else {
    // Mouvement pas à pas
    // Gauche
    if (buttonPressed(Button.LEFT)) {
      vars.posAxe1 -= 1
      bouge = true;
    }
    // Droite
    if (buttonPressed(Button.RIGHT)) {
      vars.posAxe1 += 1
      bouge = true;
    }
    // Haut
    if (buttonPressed(Button.UP)) {
      vars.posAxe2 -= 1;
      bouge = true;
    }
    // Bas
    if (buttonPressed(Button.DOWN)) {
      vars.posAxe2 += 1;
      bouge = true;
    }
  }

  // Vérifie si le joueur a bougé
  if (bouge) {
    // Sauvegarde la position précédente
    vars.posAxe1Avant = posAxe1Avant;
    vars.posAxe2Avant = posAxe2Avant;
    // Détermine la couleur à dessiner
    if (vars.modeGomme == true) {
      vars.couleur = noir;
    } else {
      vars.couleur = blanc;
    }
  }

  // Active le mode gomme si B est maintenu
  if (buttonDown(Button.B)) {
    vars.modeGomme = true;
  } else {
    vars.modeGomme = false;
  }
}

export function draw(): void {
  // Dessine la couleur à la position précédente
  pset(vars.posAxe1Avant, vars.posAxe2Avant, vars.couleur);

  // Dessine le joueur en vert à sa position actuelle
  pset(vars.posAxe1, vars.posAxe2, vert);
}

