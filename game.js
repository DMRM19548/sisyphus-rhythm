(function () {
  "use strict";

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d", { alpha: false });
  var startCard = document.getElementById("startCard");
  var startButton = document.getElementById("startButton");
  var soundButton = document.getElementById("soundButton");
  var pauseButton = document.getElementById("pauseButton");
  var gameControls = document.getElementById("gameControls");
  var liveScore = document.getElementById("liveScore");

  var PAPER = "#ffffff";
  var INK = "#111111";
  var FADED = "#777777";
  var BPM = 170;
  var BEAT = 60 / BPM;
  var RHYTHM_PATTERNS = [
    [0, 3, 5, 7, 10, 12, 14],
    [0, 2, 4, 6, 8, 10, 13, 14],
    [0, 2, 5, 7, 9, 12, 14],
    [0, 2, 3, 6, 8, 10, 12, 14]
  ];
  var PATTERN_CYCLES = 2;
  var HIT_WINDOW = 0.175;
  var PERFECT_WINDOW = 0.09;
  var NOTE_TRAVEL = 1.72;
  var LOOK_AHEAD = NOTE_TRAVEL + 0.48;
  var MUSIC_INTRO = BEAT * 4;
  var DPR = 1;
  var width = 0;
  var height = 0;
  var rhythmBottom = 52;
  var state = "idle";
  var soundOn = true;
  var audio = null;
  var master = null;
  var backingFilter = null;
  var backingGain = null;
  var melodyFilter = null;
  var melodyGain = null;
  var musicBuffer = null;
  var musicPreparation = null;
  var musicPlayer = null;
  var musicStarted = false;
  var stateBeforePause = "playing";
  var resuming = false;
  var schedulerId = null;
  var patternStart = 0;
  var nextStepTime = 0;
  var nextStepIndex = 0;
  var chartStart = 0;
  var chartTransition = null;
  var targetEvents = [];
  var score = 0;
  var streak = 0;
  var best = readBest();
  var pushPulse = 0;
  var feedback = null;
  var lastFrame = performance.now();
  var sceneTime = 0;
  var worldOffset = 0;
  var playTime = 0;
  var ambientEvent = null;
  var ambientCooldownUntil = 0;
  var nextRabbitAt = Infinity;
  var nextUfoAt = Infinity;
  var nextCometAt = Infinity;
  var nextHeliosAt = Infinity;
  var nextPlantAt = Infinity;
  var plants = [];
  var skyBirds = [];
  var clouds = [];
  var nextBirdAt = Infinity;
  var nextCloudAt = Infinity;
  var nextRainAt = Infinity;
  var rain = null;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var heroSprite = new Image();
  var stepSprite = new Image();
  var ambientSprite = new Image();
  var heliosSprite = new Image();
  var walk = SisyphusStep.create();

  heroSprite.src = "./sisyphus-clean-v30.png?v=30";
  stepSprite.src = "./sisyphus-step-v30.png?v=30";
  ambientSprite.src = "./ambient-sprites-v4.png?v=20";
  heliosSprite.src = "./helios-chariot.png?v=27";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mod(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function smoothstep(value) {
    var amount = clamp(value, 0, 1);
    return amount * amount * (3 - 2 * amount);
  }

  function resetAmbientEvents() {
    playTime = 0;
    ambientEvent = null;
    ambientCooldownUntil = 0;
    nextRabbitAt = randomBetween(35, 55);
    nextUfoAt = randomBetween(55, 66);
    nextCometAt = randomBetween(34, 46);
    nextHeliosAt = randomBetween(85, 110);
    nextPlantAt = randomBetween(4, 8);
    plants = [];
    skyBirds = [];
    clouds = [];
    rain = null;
    nextBirdAt = randomBetween(3, 8);
    nextCloudAt = randomBetween(4, 10);
    nextRainAt = randomBetween(85, 115);
  }

  function beginAmbientEvent(type) {
    if (type === "comet") {
      ambientEvent = {type: type, elapsed: 0, duration: randomBetween(1.4, 1.9),
        xRatio: randomBetween(0.12, 0.34), yRatio: randomBetween(0.08, 0.13)};
      nextCometAt = playTime + randomBetween(62, 98);
      return;
    }
    if (type === "helios") {
      ambientEvent = {type: type, elapsed: 0, duration: randomBetween(10, 13),
        yRatio: randomBetween(0.13, 0.20)};
      nextHeliosAt = playTime + randomBetween(145, 210);
      return;
    }
    if (type === "ufo") {
      ambientEvent = {
        type: type,
        elapsed: 0,
        duration: randomBetween(7, 8.5),
        direction: Math.random() < 0.5 ? 1 : -1,
        yRatio: randomBetween(0.13, 0.24)
      };
      nextUfoAt = playTime + randomBetween(55, 78);
      return;
    }
    ambientEvent = {
      type: type,
      elapsed: 0,
      startWorldOffset: worldOffset,
      spawnRatio: randomBetween(0.84, 0.91),
      behind: false,
      underground: 0,
      riseDuration: 0.58,
      hideDuration: 0.46,
      hideElapsed: null
    };
    nextRabbitAt = Infinity;
  }

  function updateAmbientEvents(dt) {
    playTime += dt;
    if (ambientEvent) {
      ambientEvent.elapsed += dt;
      if (ambientEvent.type === "rabbit") {
        if (ambientEvent.underground > 0) {
          ambientEvent.underground = Math.max(0, ambientEvent.underground - dt);
          if (ambientEvent.underground === 0) {
            // A second burrow opens behind the rear foot, clear of the step.
            ambientEvent.spawnRatio = Math.max(24, heroLayout().drawX - 42) / width;
            ambientEvent.startWorldOffset = worldOffset;
            ambientEvent.elapsed = 0;
            ambientEvent.hideElapsed = null;
          }
          return;
        }
        if (ambientEvent.hideElapsed !== null) {
          ambientEvent.hideElapsed += dt;
          if (ambientEvent.hideElapsed >= ambientEvent.hideDuration) {
            if (!ambientEvent.behind) {
              ambientEvent.behind = true;
              ambientEvent.underground = 0.75;
            } else {
              ambientEvent = null;
              ambientCooldownUntil = playTime + 4;
              nextRabbitAt = playTime + randomBetween(70, 110);
            }
          }
          return;
        }
        if (ambientEvent.elapsed < ambientEvent.riseDuration) {
          ambientEvent.startWorldOffset = worldOffset;
          return;
        }
        var rabbitDistance = rabbitScreenX(ambientEvent) - heroLayout().boulderX;
        var hideDistance = clamp(width * 0.17, 58, 110);
        var shouldHide = ambientEvent.behind
          ? ambientEvent.elapsed > 3.4 || rabbitScreenX(ambientEvent) < 12
          : rabbitDistance <= hideDistance || ambientEvent.elapsed > 10;
        if (ambientEvent.elapsed >= ambientEvent.riseDuration && shouldHide) {
          ambientEvent.hideElapsed = 0;
        }
        return;
      }
      if (ambientEvent.elapsed >= ambientEvent.duration) {
        ambientEvent = null;
        ambientCooldownUntil = playTime + 4;
      }
      return;
    }
    if (playTime < ambientCooldownUntil || rain) {
      return;
    }
    var due = [
      {type: "comet", at: nextCometAt}, {type: "ufo", at: nextUfoAt},
      {type: "helios", at: nextHeliosAt}, {type: "rabbit", at: nextRabbitAt}
    ].filter(function (event) { return event.at <= playTime; });
    due.sort(function (a, b) { return a.at - b.at; });
    if (due.length) beginAmbientEvent(due[0].type);
  }

  function updatePlants() {
    plants = plants.filter(function (plant) { return plant.worldX - worldOffset > -60; });
    if (playTime < nextPlantAt) return;
    nextPlantAt = playTime + randomBetween(9, 19);
    var spawnX = worldOffset + width + 40;
    if (plants.length >= 3 || plants.some(function (plant) {
      return Math.abs(plant.worldX - spawnX) < clamp(width * 0.3, 130, 240);
    })) return;
    plants.push({worldX: spawnX, kind: Math.random() < 0.6 ? Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 2),
      size: randomBetween(0.85, 1.15)});
  }

  function updateSky(dt) {
    skyBirds = skyBirds.filter(function (bird) { bird.elapsed += dt; return bird.elapsed < bird.duration; });
    clouds = clouds.filter(function (cloud) { cloud.elapsed += dt; return cloud.elapsed < cloud.duration; });
    if (playTime >= nextBirdAt) {
      nextBirdAt = playTime + randomBetween(9, 21);
      if (!rain && skyBirds.length < 3) {
        var direction = Math.random() < 0.5 ? -1 : 1;
        var flock = Math.random() < 0.3 ? 2 : 1;
        var altitude = randomBetween(0.19, 0.42);
        for (var b = 0; b < flock && skyBirds.length < 3; b += 1) {
          skyBirds.push({elapsed: -b * 0.7, duration: randomBetween(12, 21), direction: direction,
            yRatio: altitude + b * 0.025, wave: randomBetween(3, 10), phase: randomBetween(0, 4)});
        }
      }
    }
    if (playTime >= nextCloudAt) {
      nextCloudAt = playTime + randomBetween(18, 33);
      if (clouds.length < 2) clouds.push({elapsed: 0, duration: randomBetween(35, 60),
        direction: Math.random() < 0.5 ? -1 : 1, yRatio: randomBetween(0.12, 0.30),
        kind: Math.floor(Math.random() * 2), scale: randomBetween(1.1, 1.7)});
    }
    if (rain) {
      rain.elapsed += dt;
      if (rain.elapsed >= rain.duration) {
        rain = null;
        nextRainAt = playTime + randomBetween(140, 210);
        ambientCooldownUntil = playTime + 3;
      }
    } else if (playTime >= nextRainAt && !ambientEvent && playTime >= ambientCooldownUntil) {
      rain = {elapsed: 0, duration: randomBetween(9, 14), drops: []};
      for (var d = 0; d < 42; d += 1) {
        rain.drops.push({x: Math.random(), y: Math.random(), speed: randomBetween(0.8, 1.3)});
      }
    }
  }

  function readBest() {
    try {
      return Number(localStorage.getItem("sisyphus-best")) || 0;
    } catch (error) {
      return 0;
    }
  }

  function saveBest() {
    try {
      localStorage.setItem("sisyphus-best", String(best));
    } catch (error) {
      return;
    }
  }

  function resize() {
    width = Math.max(320, window.innerWidth);
    height = Math.max(360, window.innerHeight);
    rhythmBottom = Math.max(52, 32 + parseFloat(getComputedStyle(document.documentElement).fontSize));
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * DPR);
    canvas.height = Math.floor(height * DPR);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function prepareAudio() {
    if (!audio) {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        return Promise.reject(new Error("Web Audio is not supported."));
      }
      audio = new AudioContext();
      master = audio.createGain();
      master.gain.value = soundOn ? 0.72 : 0;
      master.connect(audio.destination);

      backingFilter = audio.createBiquadFilter();
      backingFilter.type = "lowpass";
      backingFilter.frequency.value = 620;
      backingFilter.Q.value = 0.55;
      backingGain = audio.createGain();
      backingGain.gain.value = 0.66;
      backingFilter.connect(backingGain);
      backingGain.connect(master);

      melodyFilter = audio.createBiquadFilter();
      melodyFilter.type = "highpass";
      melodyFilter.frequency.value = 650;
      melodyFilter.Q.value = 0.45;
      melodyGain = audio.createGain();
      melodyGain.gain.value = 0.015;
      melodyFilter.connect(melodyGain);
      melodyGain.connect(master);
      musicPlayer = SisyphusMusic.create(audio, [backingFilter, melodyFilter], window.fetch.bind(window));
    }
    if (musicStarted) return Promise.resolve(null);
    if (!musicPreparation) {
      musicPreparation = musicPlayer.prepare().then(function (decoded) {
        musicBuffer = decoded;
        return decoded;
      }).catch(function (error) {
        musicPreparation = null;
        throw error;
      });
    }
    return musicPreparation;
  }

  function ensureAudio() {
    var ready = prepareAudio();
    if (!audio) return ready;
    // Resume is invoked immediately inside the tap/keyboard gesture.
    return Promise.all([audio.resume(), ready]);
  }

  function audibleLatency() {
    if (!audio) {
      return 0;
    }
    return clamp((audio.baseLatency || 0) + (audio.outputLatency || 0), 0, 0.12);
  }

  function holdAudioParam(param, when) {
    if (typeof param.cancelAndHoldAtTime === "function") {
      param.cancelAndHoldAtTime(when);
      return;
    }
    var currentValue = param.value;
    param.cancelScheduledValues(when);
    param.setValueAtTime(currentValue, when);
  }

  function resetMelody() {
    if (!audio || !melodyGain) {
      return;
    }
    melodyGain.gain.cancelScheduledValues(audio.currentTime);
    melodyGain.gain.setValueAtTime(0.015, audio.currentTime);
  }

  function openMelody(distance) {
    if (!audio || !melodyGain) {
      return;
    }
    var now = audio.currentTime;
    var peak = distance <= PERFECT_WINDOW ? 0.86 : 0.68;
    holdAudioParam(melodyGain.gain, now);
    melodyGain.gain.setTargetAtTime(peak, now, 0.022);
    var beat = musicPlayer ? musicPlayer.timelineAt(now).beat : BEAT;
    melodyGain.gain.setTargetAtTime(0.015, now + beat * 1.25, 0.14);
  }

  function closeMelody() {
    if (!audio || !melodyGain) {
      return;
    }
    var now = audio.currentTime;
    holdAudioParam(melodyGain.gain, now);
    melodyGain.gain.setTargetAtTime(0.015, now, 0.035);
  }

  function beginSequence() {
    if (!audio || !musicBuffer) {
      return;
    }
    stopScheduler();
    resetMelody();
    targetEvents = [];
    var musicStart = audio.currentTime + 0.12;
    patternStart = musicStart + MUSIC_INTRO;
    musicPlayer.start(patternStart, musicBuffer);
    musicStarted = true;
    musicBuffer = null;
    musicPreparation = null;
    nextStepTime = patternStart;
    nextStepIndex = 0;
    chartStart = patternStart;
    chartTransition = null;
    state = "counting";
    updatePauseButton();
    schedulerId = window.setInterval(scheduleAhead, 25);
    scheduleAhead();
  }

  function rhythmPatternForCycle(cycleIndex) {
    var patternIndex = Math.floor(cycleIndex / PATTERN_CYCLES) % RHYTHM_PATTERNS.length;
    return RHYTHM_PATTERNS[patternIndex];
  }

  function scheduleAhead() {
    if (!audio || (state !== "counting" && state !== "playing")) {
      return;
    }
    musicPlayer.tick(audio.currentTime);
    var transition = musicPlayer.transition();
    if (transition !== null && transition !== chartTransition) {
      chartTransition = transition;
      targetEvents = targetEvents.filter(function (target) { return target.time < transition - 0.000001; });
      if (nextStepTime > transition) nextStepTime = transition;
    }
    while (nextStepTime < audio.currentTime + LOOK_AHEAD) {
      var segment = musicPlayer.timelineAt(nextStepTime);
      if (segment.start !== chartStart) {
        chartStart = segment.start;
        nextStepIndex = 0;
        nextStepTime = segment.start;
      }
      var localStep = mod(nextStepIndex, 16);
      var cycleIndex = Math.floor(nextStepIndex / 16);
      var pattern = rhythmPatternForCycle(cycleIndex);
      var isTarget = pattern.indexOf(localStep) !== -1;
      if (isTarget) {
        targetEvents.push({
          time: nextStepTime,
          step: localStep,
          judged: false
        });
      }
      nextStepIndex += 1;
      nextStepTime = Math.min(chartStart + nextStepIndex * segment.beat / 2, segment.end);
    }
  }

  function stopScheduler() {
    if (schedulerId !== null) {
      window.clearInterval(schedulerId);
      schedulerId = null;
    }
  }

  function startGame() {
    if (state !== "idle") {
      return;
    }
    state = "loading";
    startButton.disabled = true;
    startButton.textContent = "START";
    startButton.setAttribute("aria-busy", "true");
    ensureAudio().then(function () {
      startCard.classList.add("is-hidden");
      gameControls.classList.add("is-visible");
      startButton.disabled = false;
      startButton.setAttribute("aria-busy", "false");
      startButton.textContent = "START";
      score = 0;
      streak = 0;
      walk = SisyphusStep.create();
      worldOffset = 0;
      resetAmbientEvents();
      updateLiveScore();
      beginSequence();
      if (document.hidden) pauseGame();
    }).catch(function () {
      state = "idle";
      startButton.disabled = false;
      startButton.setAttribute("aria-busy", "false");
      startButton.textContent = "RETRY";
    });
  }

  function pauseGame() {
    if (state !== "counting" && state !== "playing") {
      return;
    }
    stopScheduler();
    stateBeforePause = state;
    state = "paused";
    // Suspending the audio clock freezes both the song and scheduled notes.
    audio.suspend();
    updatePauseButton();
  }

  function resumeGame() {
    if (state !== "paused" || resuming) {
      return;
    }
    resuming = true;
    pauseButton.disabled = true;
    ensureAudio().then(function () {
      if (state !== "paused" || document.hidden) {
        audio.suspend();
        return;
      }
      state = stateBeforePause;
      schedulerId = window.setInterval(scheduleAhead, 25);
      scheduleAhead();
    }).catch(function () {
      state = "paused";
    }).then(function () {
      resuming = false;
      pauseButton.disabled = false;
      updatePauseButton();
    });
  }

  function updatePauseButton() {
    var paused = state === "paused";
    pauseButton.setAttribute("data-paused", String(paused));
    pauseButton.setAttribute("aria-pressed", String(paused));
    pauseButton.setAttribute("aria-label", paused ? "Resume game" : "Pause game");
    pauseButton.setAttribute("title", paused ? "Play" : "Pause");
  }

  function togglePause(event) {
    event.stopPropagation();
    if (state === "paused") resumeGame();
    else pauseGame();
  }

  function handleAction(event) {
    if (event) {
      event.preventDefault();
    }
    if (state === "idle") {
      startGame();
      return;
    }
    if (state === "paused") {
      resumeGame();
      return;
    }
    if (state === "counting" && audio && audio.currentTime >= patternStart - HIT_WINDOW) {
      state = "playing";
    }
    if (state !== "playing" || !audio) {
      return;
    }

    var now = audio.currentTime;
    var latency = audibleLatency();
    var closest = null;
    var closestDistance = Infinity;
    for (var i = 0; i < targetEvents.length; i += 1) {
      var target = targetEvents[i];
      if (target.judged) {
        continue;
      }
      var distance = Math.abs(now - (target.time + latency));
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = target;
      }
    }

    if (closest && closestDistance <= HIT_WINDOW) {
      closest.judged = true;
      registerHit(closestDistance);
    } else {
      registerMiss(true);
    }
  }

  function registerHit(distance) {
    var label = distance <= PERFECT_WINDOW ? "PERFECT" : "GOOD";
    score += 1;
    streak += 1;
    best = Math.max(best, score);
    saveBest();
    SisyphusStep.hit(walk, worldOffset, heroLayout().stepDistance);
    openMelody(distance);
    pushPulse = 1;
    feedback = { text: label, life: 1, positive: true };
    if (navigator.vibrate && !reducedMotion) {
      navigator.vibrate(label === "PERFECT" ? 12 : 7);
    }
    updateLiveScore();
  }

  function registerMiss(fromInput) {
    if (streak > 0 || fromInput) {
      feedback = { text: "MISS", life: 1, positive: false };
    }
    streak = 0;
    closeMelody();
  }

  function judgeExpiredTargets() {
    if (!audio || state !== "playing") {
      return;
    }
    var now = audio.currentTime;
    var latency = audibleLatency();
    for (var i = 0; i < targetEvents.length; i += 1) {
      var target = targetEvents[i];
      if (!target.judged && now > target.time + latency + HIT_WINDOW) {
        target.judged = true;
        registerMiss(false);
      }
    }
    targetEvents = targetEvents.filter(function (target) {
      return !target.judged || now - target.time < 1.2;
    });
  }

  function updateLiveScore() {
    liveScore.textContent = "Score " + score + ".";
  }

  function toggleSound(event) {
    event.stopPropagation();
    soundOn = !soundOn;
    if (master && audio) {
      master.gain.cancelScheduledValues(audio.currentTime);
      master.gain.setTargetAtTime(soundOn ? 0.72 : 0, audio.currentTime, 0.015);
    }
    updateSoundButton();
  }

  function updateSoundButton() {
    soundButton.textContent = soundOn ? "MUSIC ON" : "MUSIC OFF";
    soundButton.setAttribute("aria-pressed", String(soundOn));
    soundButton.setAttribute("aria-label", soundOn ? "Mute sound" : "Turn sound on");
  }

  function slopeValue() {
    return width < 640 ? 0.42 : 0.34;
  }

  function groundAt(x) {
    var strikeX = Math.max(52, width * (width < 640 ? 0.16 : 0.12));
    // Reserve dark ground behind the entire strike marker and note lane,
    // including wide desktop windows where the slope formerly hid its left end.
    var laneTop = height - rhythmBottom - 46;
    var originY = Math.min(height * 0.73, laneTop - (width * 0.5 - strikeX) * slopeValue());
    return originY - (x - width * 0.5) * slopeValue();
  }

  function heroLayout() {
    var frameWidth = 512;
    var frameHeight = 448;
    var targetWidth = width < 640
      ? Math.min(width * 0.39, height * 0.34 * frameWidth / frameHeight)
      : Math.min(width * 0.22, height * 0.36 * frameWidth / frameHeight);
    var drawWidth = clamp(targetWidth, 128, 280);
    if (width >= 640) drawWidth *= 0.9;
    var drawHeight = drawWidth * frameHeight / frameWidth;
    var drawX = width < 640 ? width * 0.3 : (width - drawWidth) * 0.5;
    drawX = Math.min(drawX, width - drawWidth - 10);
    var anchorX = drawX + drawWidth * 0.08;
    var angle = Math.atan2(-SisyphusStep.delta[1], SisyphusStep.delta[0]) - Math.atan(slopeValue());
    var scale = drawWidth / frameWidth;
    var rearX = (SisyphusStep.rear.foot[0] - frameWidth * 0.08) * scale;
    var rearY = (SisyphusStep.rear.foot[1] - frameHeight * 0.82) * scale;
    var footX = anchorX + Math.cos(angle) * rearX - Math.sin(angle) * rearY;
    var anchorY = groundAt(footX) - Math.sin(angle) * rearX - Math.cos(angle) * rearY;
    var localBoulderX = drawWidth * 0.623;
    var localBoulderY = -drawHeight * 0.407;

    return {
      drawWidth: drawWidth,
      drawHeight: drawHeight,
      drawX: drawX,
      anchorX: anchorX,
      anchorY: anchorY,
      angle: angle,
      stepDistance: scale * (Math.cos(angle) * SisyphusStep.delta[0] - Math.sin(angle) * SisyphusStep.delta[1]),
      boulderX: anchorX + Math.cos(angle) * localBoulderX - Math.sin(angle) * localBoulderY
    };
  }

  function rabbitScreenX(event) {
    return width * event.spawnRatio - (worldOffset - event.startWorldOffset);
  }

  function update(dt) {
    if (state === "paused") return;
    sceneTime += dt;
    if (state === "counting" && audio && audio.currentTime >= patternStart) {
      state = "playing";
    }
    if (state === "playing") {
      judgeExpiredTargets();
      worldOffset = SisyphusStep.advance(walk, dt, worldOffset, heroLayout().stepDistance);
    }
    if (state === "counting" || state === "playing") {
      updateAmbientEvents(dt);
      updatePlants();
      updateSky(dt);
    }

    pushPulse = Math.max(0, pushPulse - dt * 4.4);
    if (feedback) {
      feedback.life -= dt * 1.75;
      if (feedback.life <= 0) {
        feedback = null;
      }
    }
  }

  function pixelRect(x, y, w, h, color) {
    ctx.fillStyle = color || INK;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function drawTerrain() {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(-20, groundAt(-20));
    ctx.lineTo(width + 20, groundAt(width + 20));
    ctx.lineTo(width + 20, height + 20);
    ctx.lineTo(-20, height + 20);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = INK;
    ctx.lineWidth = width < 640 ? 4 : 5;
    ctx.beginPath();
    ctx.moveTo(-20, groundAt(-20));
    ctx.lineTo(width + 20, groundAt(width + 20));
    ctx.stroke();
  }

  var birdPixels = [
    [".........##......", "........###......", ".......###.......", "...##.####.......", ".##########......", "######.########..", "...#########.###.", ".....######......", ".......###......."],
    [".................", ".................", "...##............", ".########........", "#################", "...###########...", ".....####........", "......###........", ".......##........"],
    [".................", ".................", "...##............", ".########........", "###############..", "...########..###.", "......#####......", ".......####......", "........###......", ".........##......"]
  ];
  function drawPixels(rows, x, y, size) {
    ctx.fillStyle = INK;
    ctx.beginPath();
    rows.forEach(function (row, rowIndex) {
      for (var col = 0; col < row.length; col += 1) {
        if (row[col] === "#") ctx.rect(x + col * size, y + rowIndex * size, size, size);
      }
    });
    ctx.fill();
  }
  function drawBird(x, y, phase, direction) {
    var pose = Math.floor(mod(sceneTime * 4 + phase, 4));
    var rows = birdPixels[pose === 3 ? 1 : pose];
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (direction > 0) ctx.scale(-1, 1);
    drawPixels(rows, -8, -4, 1);
    ctx.restore();
  }

  var cloudPixels = [
    ["..........#####...............", "........##.....##.............", ".......#.........#..####......", "....###...........##....##....", "..##......................#...", ".#.........................##.", "#............................#", "#............................#", ".############################."],
    ["...........######.............", ".........##......##...........", "........#..........#..........", "...#####............####......", "..#.....................##....", ".#........................###.", "#............................#", ".############################."]
  ];

  function drawSkyDetails() {
    clouds.forEach(function (cloud) {
      var size = cloud.scale * (width < 640 ? 1 : 1.3);
      var cloudWidth = 30 * size;
      var x = -cloudWidth + cloud.elapsed / cloud.duration * (width + 2 * cloudWidth);
      if (cloud.direction < 0) x = width - x;
      drawPixels(cloudPixels[cloud.kind], Math.round(x), Math.round(Math.max(64, height * cloud.yRatio)), size);
    });
    skyBirds.forEach(function (bird) {
      if (bird.elapsed < 0) return;
      var p = bird.elapsed / bird.duration;
      var x = -24 + p * (width + 48);
      if (bird.direction < 0) x = width - x;
      var y = height * bird.yRatio + Math.sin(p * Math.PI * 2 + bird.phase) * bird.wave;
      drawBird(x, y, bird.phase, bird.direction);
    });
  }

  function drawRain() {
    if (!rain || reducedMotion) return;
    var intensity = Math.min(smoothstep(rain.elapsed / 2), smoothstep((rain.duration - rain.elapsed) / 2));
    var count = Math.floor((width < 640 ? 22 : 42) * intensity);
    var top = Math.max(66, height * 0.12);
    for (var i = 0; i < count; i += 1) {
      var drop = rain.drops[i];
      var progress = mod(drop.y + rain.elapsed * 0.8 * drop.speed, 1);
      var x = mod(drop.x * width + progress * 24, width);
      var y = top + progress * height;
      pixelRect(x, y, 1, 4, INK);
      pixelRect(x + 1, y + 4, 1, 3, INK);
    }
  }

  function drawComet() {
    if (!ambientEvent || ambientEvent.type !== "comet") return;
    var p = clamp(ambientEvent.elapsed / ambientEvent.duration, 0, 1);
    var dx = clamp(width * 0.56, 180, 360);
    var dy = height * 0.24;
    var length = Math.hypot(dx, dy);
    var x = width * ambientEvent.xRatio + p * dx;
    var y = height * ambientEvent.yRatio + p * dy;
    if (reducedMotion) { x = width * 0.63; y = height * 0.2; }
    var trail = clamp(width * 0.20, 65, 150) * Math.sin(p * Math.PI);
    // A continuous tapered trail follows a small four-point star.
    for (var distance = trail; distance >= 3; distance -= 1) {
      var size = distance < trail * 0.22 ? 3 : distance < trail * 0.6 ? 2 : 1;
      pixelRect(x - dx / length * distance - size / 2,
        y - dy / length * distance - size / 2, size, size, INK);
    }
    drawPixels(["...#...", "...#...", "..###..", "###.###", "..###..", "...#...", "...#..."],
      Math.round(x) - 3, Math.round(y) - 3, 1);
  }

  function drawHelios() {
    if (!ambientEvent || ambientEvent.type !== "helios" || !heliosSprite.complete || !heliosSprite.naturalWidth) return;
    var p = clamp(ambientEvent.elapsed / ambientEvent.duration, 0, 1);
    var spriteWidth = width < 640 ? 126 : 176;
    var spriteHeight = spriteWidth * heliosSprite.naturalHeight / heliosSprite.naturalWidth;
    var x = -spriteWidth + p * (width + spriteWidth * 2);
    var y = height * ambientEvent.yRatio - Math.sin(p * Math.PI) * height * 0.035;
    if (reducedMotion) x = (width - spriteWidth) / 2;
    else y += Math.sin(ambientEvent.elapsed * 4.2) * 1.5;
    ctx.drawImage(heliosSprite, Math.round(x), Math.round(y), Math.round(spriteWidth), Math.round(spriteHeight));
  }

  function drawUfo() {
    if (!ambientEvent || ambientEvent.type !== "ufo" || !ambientSprite.complete || ambientSprite.naturalWidth === 0) {
      return;
    }
    var progress = clamp(ambientEvent.elapsed / ambientEvent.duration, 0, 1);
    var ufoWidth = clamp(width * 0.13, 54, 82);
    var ufoHeight = ufoWidth * 64 / 142;
    var travel = width + ufoWidth * 2;
    var x = -ufoWidth + progress * travel;
    if (ambientEvent.direction < 0) {
      x = width + ufoWidth - progress * travel;
    }
    if (reducedMotion) {
      x = width * 0.5 - ufoWidth * 0.5;
    }
    var y = height * ambientEvent.yRatio;
    if (!reducedMotion) {
      y += Math.sin(progress * Math.PI * 4) * 3;
    }
    ctx.drawImage(
      ambientSprite,
      313,
      106,
      142,
      64,
      Math.round(x),
      Math.round(y),
      Math.round(ufoWidth),
      Math.round(ufoHeight)
    );
  }

  function drawRabbit() {
    if (!ambientEvent || ambientEvent.type !== "rabbit" || !ambientSprite.complete || ambientSprite.naturalWidth === 0) {
      return;
    }
    if (ambientEvent.underground > 0) return;
    var rise = smoothstep(ambientEvent.elapsed / ambientEvent.riseDuration);
    var hide = ambientEvent.hideElapsed === null
      ? 1
      : 1 - smoothstep(ambientEvent.hideElapsed / ambientEvent.hideDuration);
    var reveal = reducedMotion ? (ambientEvent.hideElapsed === null ? 1 : 0) : rise * hide;
    var rabbitWidth = clamp(width * 0.055, 18, 23);
    var rabbitHeight = rabbitWidth * 104 / 72;
    var centerX = rabbitScreenX(ambientEvent);
    var contactX = centerX + rabbitWidth * 0.06;
    var groundY = groundAt(contactX);
    var visibleY = groundY - rabbitHeight;
    var hiddenY = groundY + 2;
    var y = hiddenY + (visibleY - hiddenY) * reveal;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-20, -20);
    ctx.lineTo(width + 20, -20);
    ctx.lineTo(width + 20, groundAt(width + 20));
    ctx.lineTo(-20, groundAt(-20));
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(
      ambientSprite,
      90,
      82,
      72,
      104,
      Math.round(centerX - rabbitWidth * 0.5),
      Math.round(y),
      Math.round(rabbitWidth),
      Math.round(rabbitHeight)
    );
    ctx.restore();
  }

  function drawGroundDetails() {
    var spacing = width < 640 ? 118 : 165;
    var span = width + spacing * 2;
    var count = Math.ceil(span / spacing) + 1;
    var stones = [
      ["....###....", "..#######..", ".#########.", "###########"],
      ["...##...", "..####..", ".######.", ".######.", "########"],
      ["......###......", "...#########...", ".#############.", "###############"],
      ["..####....", ".######...", "########..", "##########"]
    ];
    ctx.save();
    for (var i = 0; i < count; i += 1) {
      var x = mod(i * spacing - worldOffset, span) - spacing;
      if (ambientEvent && ambientEvent.type === "rabbit") {
        var rabbitX = rabbitScreenX(ambientEvent);
        if (Math.abs(x - rabbitX) < 34) {
          continue;
        }
      }
      var y = groundAt(x);
      var rows = stones[i % stones.length];
      var scale = width < 640 ? 1.5 : 2;
      ctx.save();
      ctx.translate(x, y - 0.75);
      ctx.rotate(-Math.atan(slopeValue()));
      drawPixels(rows, -rows[0].length * scale / 2, -rows.length * scale, scale);
      ctx.restore();
    }
    ctx.restore();
  }

  var plantPixels = [
    ["...###.......", "..#####.###..", ".###########.", "#############", ".###########.", "..#########..", "....#####...."],
    ["......###......", "..###.####.....", ".#########.##..", "##############.", ".##############", "..############.", "....########...", ".....#####....."],
    [".......###.......", "....#########....", "..#############..", ".###############.", "#################", "#################", ".###############.", "..#############..", "....#########....", ".....##.##.##....", "......#####......", ".......###.......", ".......###.......", ".......###.......", ".......###.......", ".......###.......", ".......###.......", "......#####......"],
    ["....#....", "...###...", "...###...", "..#####..", "..#####..", ".#######.", ".#######.", ".#######.", "#########", "#########", ".#######.", ".#######.", "..#####..", "..#####..", "...###...", "...###...", "....#....", "....#....", "....#....", "...###..."]
  ];

  function drawPlants() {
    plants.forEach(function (plant) {
      var x = plant.worldX - worldOffset;
      if (x < -45 || x > width + 45) return;
      var rows = plantPixels[plant.kind];
      var scale = (width < 640 ? 1.5 : 2) * plant.size;
      drawPixels(rows, Math.round(x - rows[0].length * scale / 2),
        Math.round(groundAt(x) + 2 - rows.length * scale), scale);
    });
  }

  function drawHero() {
    var frameWidth = 512;
    var frameHeight = 448;
    var layout = heroLayout();
    var drawWidth = layout.drawWidth;
    var drawHeight = layout.drawHeight;
    var anchorX = layout.anchorX;
    var anchorY = layout.anchorY;
    var angle = layout.angle;
    var frame = reducedMotion ? 0 : walk.frame;
    var rockPhase = (walk.completed + (walk.frame >= 8 ? 1 : 0)) % 4;
    if (stepSprite.complete && stepSprite.naturalWidth > 0) {
      ctx.save();
      // Smooth the scaled/rotated artwork while keeping its pose and anchors.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.translate(anchorX, anchorY);
      ctx.rotate(angle);
      ctx.drawImage(
        stepSprite,
        (frame % SisyphusStep.columns) * frameWidth,
        Math.floor(frame / SisyphusStep.columns) * frameHeight,
        frameWidth,
        frameHeight,
        -drawWidth * 0.08,
        -drawHeight * 0.82,
        drawWidth,
        drawHeight
      );
      // The shared rock silhouette retains the four established turning marks.
      if (heroSprite.complete && heroSprite.naturalWidth > 0) {
        var scale = drawWidth / frameWidth;
        ctx.drawImage(heroSprite, rockPhase * frameWidth + 268, 0, 244, frameHeight,
          -drawWidth * 0.08 + 268 * scale, -drawHeight * 0.82, 244 * scale, drawHeight);
      }
      ctx.restore();
    }

    if (feedback) {
      var localX = drawWidth * 0.64;
      var localY = -drawHeight * 0.75;
      var cosine = Math.cos(angle);
      var sine = Math.sin(angle);
      var boulderX = anchorX + cosine * localX - sine * localY;
      var boulderTop = anchorY + sine * localX + cosine * localY;
      ctx.save();
      ctx.globalAlpha = clamp(feedback.life, 0, 1);
      ctx.fillStyle = feedback.positive ? INK : FADED;
      ctx.font = "700 " + clamp(width * 0.012, 11, 16) + "px Courier New, monospace";
      ctx.textAlign = "center";
      ctx.fillText(feedback.text, boulderX, boulderTop - 18 - (1 - feedback.life) * 8);
      ctx.restore();
    }
  }

  function formatScore(value) {
    return String(value).padStart(6, "0");
  }

  function drawHud() {
    if (state === "idle" || state === "loading") {
      return;
    }
    var right = width - Math.max(18, width * 0.035);
    var top = Math.max(30, height * 0.05);
    ctx.fillStyle = INK;
    ctx.textAlign = "right";
    ctx.font = "700 " + clamp(width * 0.02, 15, 22) + "px Courier New, monospace";
    ctx.fillText(formatScore(score), right, top);
  }

  function drawRhythmLane() {
    if (state === "idle" || state === "loading") {
      return;
    }
    var edge = Math.max(24, width * 0.05);
    var strikeX = Math.max(52, width * (width < 640 ? 0.16 : 0.12));
    var endX = width - edge;
    var y = height - rhythmBottom;
    var now = audio ? audio.currentTime : 0;
    var latency = audibleLatency();

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(strikeX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = PAPER;
    ctx.fillRect(Math.round(strikeX - 2), Math.round(y - 22), 4, 44);

    for (var i = 0; i < targetEvents.length; i += 1) {
      var target = targetEvents[i];
      if (target.judged) {
        continue;
      }
      var untilHit = target.time + latency - now;
      if (untilHit > NOTE_TRAVEL || untilHit < -HIT_WINDOW) {
        continue;
      }
      var progress = 1 - untilHit / NOTE_TRAVEL;
      var noteX = endX - progress * (endX - strikeX);
      if (noteX < strikeX - 16) {
        continue;
      }
      var isReady = Math.abs(untilHit) <= HIT_WINDOW;
      var radius = isReady ? (width < 640 ? 7 : 8) : (width < 640 ? 5 : 6);
      ctx.beginPath();
      ctx.arc(Math.round(noteX), Math.round(y), radius, 0, Math.PI * 2);
      ctx.fill();
    }

    if (pushPulse > 0) {
      ctx.save();
      ctx.globalAlpha = pushPulse;
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(strikeX, y, 8 + (1 - pushPulse) * 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawCountIn() {
    if (state !== "counting" || !audio) {
      return;
    }
    var remaining = Math.max(1, Math.ceil((patternStart - audio.currentTime) / BEAT));
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.font = "700 " + clamp(width * 0.07, 36, 64) + "px Courier New, monospace";
    ctx.fillText(String(remaining), width / 2, height * 0.34);
  }

  function drawPaused() {
    if (state !== "paused") {
      return;
    }
    ctx.fillStyle = PAPER;
    ctx.globalAlpha = 0.86;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.font = "700 " + clamp(width * 0.055, 32, 68) + "px Courier New, monospace";
    ctx.fillText("PAUSED", width / 2, height * 0.45);
    ctx.fillStyle = FADED;
    ctx.font = "700 14px Courier New, monospace";
    ctx.fillText("TAP / SPACE", width / 2, height * 0.45 + 34);
  }

  function draw() {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);
    drawSkyDetails();
    drawRain();
    drawUfo();
    drawComet();
    drawHelios();
    drawTerrain();
    drawGroundDetails();
    drawPlants();
    drawRabbit();
    drawHero();
    drawHud();
    drawRhythmLane();
    drawCountIn();
    drawPaused();
  }

  function frame(now) {
    var dt = clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;
    update(dt);
    draw();
    window.requestAnimationFrame(frame);
  }

  startButton.addEventListener("click", function (event) {
    event.stopPropagation();
    startGame();
  });

  startCard.addEventListener("pointerdown", function (event) {
    if (event.target !== startButton && !event.target.closest("a")) {
      handleAction(event);
    }
  });

  canvas.addEventListener("pointerdown", handleAction);
  soundButton.addEventListener("click", toggleSound);
  pauseButton.addEventListener("click", togglePause);
  [soundButton, pauseButton].forEach(function (button) {
    button.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
  });

  window.addEventListener("keydown", function (event) {
    if (event.code !== "Space" || event.repeat) {
      return;
    }
    if (event.target && event.target.closest && event.target.closest("button, a")) return;
    handleAction(event);
  }, { passive: false });

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      pauseGame();
    }
  });

  resize();
  updateSoundButton();
  updatePauseButton();
  // Fetch and decode silently while the player sees the start screen.
  // Playback itself is still unlocked only by START / tap / space.
  prepareAudio().catch(function () {});
  window.requestAnimationFrame(frame);
}());
