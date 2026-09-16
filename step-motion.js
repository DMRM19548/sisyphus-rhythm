(function (root) {
  'use strict';
  var FRAMES = 17;
  var rear = { hip: [135, 286], knee: [117, 310], ankle: [94, 338], foot: [98, 359] };
  var front = { hip: [184, 255], knee: [220, 275], ankle: [226, 309], foot: [237, 330] };
  function mix(a, b, t) { return a + (b - a) * t; }
  function point(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t)]; }
  function length(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
  function knee(hip, ankle, thigh, shin) {
    var dx = ankle[0] - hip[0], dy = ankle[1] - hip[1];
    var d = Math.max(0.001, Math.hypot(dx, dy));
    var along = (thigh * thigh - shin * shin + d * d) / (2 * d);
    var across = Math.sqrt(Math.max(0, thigh * thigh - along * along));
    return [hip[0] + dx / d * along + dy / d * across,
      hip[1] + dy / d * along - dx / d * across];
  }
  function leg(from, to, t, foot) {
    var hip = point(from.hip, to.hip, t);
    var ankleOffset = point([from.ankle[0] - from.foot[0], from.ankle[1] - from.foot[1]],
      [to.ankle[0] - to.foot[0], to.ankle[1] - to.foot[1]], t);
    var ankle = [foot[0] + ankleOffset[0], foot[1] + ankleOffset[1]];
    var k = knee(hip, ankle, mix(length(from.hip, from.knee), length(to.hip, to.knee), t),
      mix(length(from.knee, from.ankle), length(to.knee, to.ankle), t));
    // Preserve the exact approved joint positions at both ends of the step.
    var k0 = knee(from.hip, from.ankle, length(from.hip, from.knee), length(from.knee, from.ankle));
    var k1 = knee(to.hip, to.ankle, length(to.hip, to.knee), length(to.knee, to.ankle));
    k[0] += mix(from.knee[0] - k0[0], to.knee[0] - k1[0], t);
    k[1] += mix(from.knee[1] - k0[1], to.knee[1] - k1[1], t);
    return {hip: hip, knee: k, ankle: ankle, foot: foot};
  }
  var delta = [front.foot[0] - rear.foot[0], front.foot[1] - rear.foot[1]];
  var stride = Math.hypot(delta[0], delta[1]);
  function sample(progress) {
    var p = Math.max(0, Math.min(1, progress));
    var supportFoot = point(front.foot, rear.foot, p);
    var swingFoot = point(rear.foot, front.foot, p);
    var clearance = 27 * Math.sin(Math.PI * p);
    swingFoot[0] += delta[1] / stride * clearance;
    swingFoot[1] -= delta[0] / stride * clearance;
    var swing = leg(rear, front, p, swingFoot);
    // Lead with the knee so the carrying leg clears the tunic's hem.
    swing.knee[0] += 16 * Math.sin(Math.PI * p);
    swing.knee[1] -= 10 * Math.sin(Math.PI * p);
    return {support: leg(front, rear, p, supportFoot), swing: swing,
      camera: [delta[0] * p, delta[1] * p], clearance: clearance};
  }
  function create() { return {active: false, pending: 0, elapsed: 0, duration: 0.20,
    distance: 0, start: 0, frame: 0, completed: 0}; }
  function begin(state, offset, distance) {
    state.active = true; state.elapsed = 0; state.frame = 0;
    state.start = offset; state.distance = distance;
    state.duration = state.pending > 0 ? 0.16 : 0.20;
  }
  function hit(state, offset, distance) {
    if (state.active) state.pending += 1;
    else begin(state, offset, distance);
  }
  function advance(state, dt, offset, distance) {
    var remaining = dt;
    while (state.active && remaining > 0) {
      var consume = Math.min(remaining, state.duration - state.elapsed);
      state.elapsed += consume; remaining -= consume;
      var p = Math.min(1, state.elapsed / state.duration);
      state.frame = Math.round(p * (FRAMES - 1));
      // Ground and planted foot use exactly the same sampled progress.
      offset = state.start + state.distance * state.frame / (FRAMES - 1);
      if (p >= 1 - 1e-8) {
        offset = state.start + state.distance;
        state.completed += 1; state.active = false; state.frame = 0;
        if (state.pending > 0) { state.pending -= 1; begin(state, offset, distance); }
      }
    }
    return offset;
  }
  root.SisyphusStep = {frames: FRAMES, columns: 5, rear: rear, front: front,
    delta: delta, stride: stride, sample: sample, create: create, hit: hit, advance: advance};
})(globalThis);
