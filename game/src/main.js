import { Game } from './game.js';

const game = new Game();
window.IRONHAVEN = {
  get ready() { return game.ready; },
  state: () => game.state(),
  teleport: (x, z) => game.teleport(x, z),
  setWanted: (n) => game.setWanted(n),
  aimAt: (x, y, z) => game.aimAt(x, y, z),
  shoot: () => game.shoot(),
  startMission: (n) => game.startMission(n),
  save: () => game.save(),
  game,
};
