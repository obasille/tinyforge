// cspell:language en,fr
import { drawSprite, s, warni } from "../../sdk";

import { litCouleurCase } from "./level";
import {
  Couleurs,
  Direction,
  tunnels,
  HAUTEUR_GRILLE,
  INVALIDE,
  INVALIDE_POS,
  jeu,
  joueur,
  LARGEUR_GRILLE,
  NB_TUNNELS,
  TAILLE_CASE,
  TUNNEL_ANIM_TICKS,
  TUNNEL_CYCLE_TICKS,
} from "./types";

export function initTunnel(index: u8): void {
  const tunnel = tunnels.get(index);
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
    warni("Tunnel {}: seulement 1 pixel trouvé", index);
  } else if (count > 2) {
    warni("Tunnel {}: {} pixels trouvés (2 attendus)", index, count);
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

export function majOuvertureTunnels(): void {
  if (jeu.tunnelTimer > 0) {
    jeu.tunnelTimer--;
  } else {
    if (jeu.tunnelPhase == 0) {
      if (tunnels.get(0).present) tunnels.get(0).ouvert = 1;
      if (tunnels.get(1).present) tunnels.get(1).ouvert = 0;
      jeu.tunnelPhase = 1;
    } else if (jeu.tunnelPhase == 1) {
      if (tunnels.get(0).present) tunnels.get(0).ouvert = 0;
      jeu.tunnelPhase = 2;
    } else if (jeu.tunnelPhase == 2) {
      if (tunnels.get(1).present) tunnels.get(1).ouvert = 1;
      jeu.tunnelPhase = 3;
    } else {
      if (tunnels.get(1).present) tunnels.get(1).ouvert = 0;
      jeu.tunnelPhase = 0;
    }
    jeu.tunnelTimer = TUNNEL_CYCLE_TICKS;
  }
}

export function essaieTeleportTunnel(): void {
  const px = joueur.x;
  const py = joueur.y;
  if (joueur.tunnelEtat != 0) return;

  let destX = INVALIDE;
  let destY = INVALIDE;

  for (let i: i32 = 0; i < NB_TUNNELS; i++) {
    const t = tunnels.get(i);
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

export function majTunnelAnimJoueur(): void {
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

export function dessineTunnel(x: u8, y: u8, ouvert: u8): void {
  if (x == INVALIDE || y == INVALIDE) return;
  const baseX = (x as i32) * TAILLE_CASE;
  const baseY = (y as i32) * TAILLE_CASE;
  const sprite = ouvert == 1 ? s("tunnel") : s("tunnel_closed");
  drawSprite(sprite, baseX, baseY);
}
