// HUD: DOM readouts + live 2D minimap (canvas).
export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      healthFill: $('health-fill'), healthNum: $('health-num'), money: $('money'), stars: $('stars'),
      objText: $('obj-text'), objDist: $('obj-dist'), objTimer: $('obj-timer'),
      speed: $('speed'), weapon: $('weapon-name'), ammo: $('ammo'),
      crosshair: $('crosshair'), hitmarker: $('hitmarker'), vignette: $('vignette'),
      banner: $('banner'), payout: $('payout'), toast: $('toast'),
      start: $('screen-start'), pause: $('screen-pause'), busted: $('screen-busted'),
      wasted: $('screen-wasted'), ending: $('screen-ending'),
      btnContinue: $('btn-continue'), endingMoney: $('ending-money'),
    };
    this.minimap = $('minimap');
    this.mm = this.minimap.getContext('2d');
    this.bannerT = 0; this.payoutT = 0; this.hitT = 0; this.vigT = 0;
    this.frame = 0;
  }
  showStart(hasSave) {
    this.el.start.classList.remove('hidden');
    this.el.btnContinue.classList.toggle('hidden', !hasSave);
  }
  hideAll() {
    for (const k of ['start', 'pause', 'busted', 'wasted', 'ending']) this.el[k].classList.add('hidden');
  }
  showPause() { this.el.pause.classList.remove('hidden'); }
  showBusted() { this.el.busted.classList.remove('hidden'); }
  showWasted() { this.el.wasted.classList.remove('hidden'); }
  showEnding(money) {
    this.el.endingMoney.textContent = `$${money.toLocaleString()}`;
    this.el.ending.classList.remove('hidden');
  }
  showMissionBanner(text) {
    this.el.banner.textContent = text;
    this.el.banner.classList.add('show');
    this.bannerT = 3;
  }
  showPayout(amount) {
    this.el.payout.textContent = `+$${amount}`;
    this.el.payout.classList.add('show');
    this.payoutT = 2.5;
  }
  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    setTimeout(() => this.el.toast.classList.remove('show'), 2500);
  }
  hitmarker() { this.hitT = 0.18; this.el.hitmarker.classList.add('show'); }
  damageFlash() { this.vigT = 0.5; }
  update(game, dt) {
    const e = this.el;
    e.healthFill.style.width = `${Math.max(0, game.player.health)}%`;
    e.healthNum.textContent = Math.ceil(Math.max(0, game.player.health));
    e.healthFill.style.background = game.player.health > 50 ? '#e8b23a' : game.player.health > 25 ? '#e07828' : '#d03030';
    e.money.textContent = `$${game.money.toLocaleString()}`;
    let stars = '';
    for (let i = 0; i < 5; i++) stars += `<span class="${i < game.wanted.wanted ? 'on' : ''}">★</span>`;
    e.stars.innerHTML = stars;
    e.stars.classList.toggle('hot', game.wanted.wanted >= 3);
    const obj = game.missions.currentObjective();
    e.objText.textContent = obj.text;
    e.objDist.textContent = obj.target ? `${Math.round(obj.dist)} m` : '';
    e.objTimer.textContent = obj.timeLeft > 0 ? `${Math.ceil(obj.timeLeft)}s` : '';
    e.objTimer.classList.toggle('urgent', obj.timeLeft > 0 && obj.timeLeft < 15);
    e.speed.textContent = game.driving ? Math.round(Math.abs(game.playerCar.speed) * 2.237) : '0';
    const w = game.weapons;
    e.weapon.textContent = w.owned[w.current] ? w.def.name : '—';
    e.ammo.textContent = w.owned[w.current] ? `${w.mag} / ${w.reserve}` : '—';
    e.ammo.classList.toggle('low', w.mag <= 3);
    e.crosshair.style.display = game.mode === 'playing' && !game.driving ? 'block' : 'none';
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) e.banner.classList.remove('show'); }
    if (this.payoutT > 0) { this.payoutT -= dt; if (this.payoutT <= 0) e.payout.classList.remove('show'); }
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) e.hitmarker.classList.remove('show'); }
    if (this.vigT > 0) { this.vigT -= dt; e.vignette.style.opacity = Math.max(0, this.vigT * 1.4); }
    else e.vignette.style.opacity = 0;
    this.drawMinimap(game);
  }
  drawMinimap(game) {
    const c = this.mm, S = 220, W = this.minimap.width;
    if (W !== S) { this.minimap.width = S; this.minimap.height = S; }
    const to = (v) => ((v + 196) / 392) * S;
    c.fillStyle = 'rgba(10,14,20,0.92)';
    c.fillRect(0, 0, S, S);
    // water + park + beach
    c.fillStyle = '#2a6a8a';
    c.fillRect(to(196), 0, S - to(196), S);
    c.fillRect(0, to(168), S, S - to(168));
    c.fillStyle = '#3a7a34';
    c.fillRect(to(6), to(6), to(50) - to(6), to(50) - to(6));
    // roads
    c.strokeStyle = '#5a5e64'; c.lineWidth = 5;
    for (const a of [-168, -112, -56, 0, 56, 112, 168]) {
      c.beginPath(); c.moveTo(0, to(a)); c.lineTo(S, to(a)); c.stroke();
      c.beginPath(); c.moveTo(to(a), 0); c.lineTo(to(a), S); c.stroke();
    }
    c.strokeStyle = '#e8c33a'; c.lineWidth = 1;
    for (const a of [-168, -112, -56, 0, 56, 112, 168]) {
      c.beginPath(); c.moveTo(0, to(a)); c.lineTo(S, to(a)); c.stroke();
      c.beginPath(); c.moveTo(to(a), 0); c.lineTo(to(a), S); c.stroke();
    }
    // mission beacon (pulsing yellow)
    const obj = game.missions.currentObjective();
    if (obj.target) {
      const pulse = 5 + Math.sin(performance.now() / 200) * 2;
      c.fillStyle = '#ffd428';
      c.beginPath(); c.arc(to(obj.target.x), to(obj.target.z), pulse, 0, 7); c.fill();
      c.strokeStyle = '#ffd428'; c.lineWidth = 2;
      c.beginPath(); c.arc(to(obj.target.x), to(obj.target.z), pulse + 5, 0, 7); c.stroke();
    }
    // golden car
    if (game.missions.goldenCar) {
      const p = game.missions.goldenCar.group.position;
      c.fillStyle = '#ffd428';
      c.beginPath(); c.arc(to(p.x), to(p.z), 4, 0, 7); c.fill();
    }
    // police (blue) + hostiles (red)
    c.fillStyle = '#4a90e8';
    for (const car of game.wanted.policeCars) c.fillRect(to(car.group.position.x) - 2, to(car.group.position.z) - 2, 4, 4);
    c.fillStyle = '#ff4040';
    for (const h of game.peds.hostiles) {
      if (h.state === 'fallen') continue;
      const p = h.h.group.position;
      c.beginPath(); c.arc(to(p.x), to(p.z), 3, 0, 7); c.fill();
    }
    // player arrow
    const p = game.player.pos;
    const a = game.player.angle;
    c.save();
    c.translate(to(p.x), to(p.z));
    c.rotate(Math.atan2(Math.sin(a), -Math.cos(a)) + Math.PI);
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 2;
    c.strokeRect(1, 1, S - 2, S - 2);
  }
}
