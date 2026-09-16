(function () {
  "use strict";

  var BEAT = 60 / 170;
  var BAR = BEAT * 4;
  var PHRASE = BAR * 16;
  // The first 96 bars play exactly as before. Thereafter, whole phrases from
  // the same recording form new arrangements on a single unbroken beat grid.
  var INTRO_BARS = 96;
  var BLEND = BAR * 2;
  var LOOK_AHEAD = 2.2;
  var TRACK = {url: "./salsa-latin-party.mp3?v=6", bpm: 170, start: BAR, end: BAR * 65};
  var FORMS = [
    [0, 1, 2, 3],
    [0, 1, 0, 3],
    [0, 3, 2, 3],
    [2, 3, 0, 3],
    [0, 1, 2, 1]
  ];

  function create(audio, outputs, fetcher, random) {
    random = random || Math.random;
    var prepared = null;
    var buffer = null;
    var voices = [];
    var voice = null;
    var patternStart = 0;
    var switchAt = Infinity;
    var pending = null;
    var current = 0;
    var form = 1;
    var phrase = 0;
    var bag = [];

    function pickForm() {
      if (!bag.length) {
        bag = FORMS.map(function (_, index) { return index; });
        for (var i = bag.length - 1; i > 0; i -= 1) {
          var j = Math.floor(random() * (i + 1));
          var swap = bag[i]; bag[i] = bag[j]; bag[j] = swap;
        }
      }
      if (bag[bag.length - 1] === form && bag.length > 1) {
        var first = bag[0]; bag[0] = bag[bag.length - 1]; bag[bag.length - 1] = first;
      }
      var next = bag.pop();
      // A one-item bag can also finish on the current form.
      return next === form ? (form + 1 + Math.floor(random() * (FORMS.length - 1))) % FORMS.length : next;
    }

    function positionAt(item, when) {
      var position = item.offset + when - item.startAt;
      return position < TRACK.end ? position :
        TRACK.start + (position - TRACK.start) % (TRACK.end - TRACK.start);
    }

    function fade(param, when, incoming) {
      // Complementary smooth fades preserve the level of correlated percussion.
      // Equal-power fades would boost it while both phrases are audible.
      param.setValueAtTime(incoming ? 0 : 1, when);
      for (var i = 1; i <= 32; i += 1) {
        var p = i / 32;
        var mix = p * p * (3 - 2 * p);
        param.linearRampToValueAtTime(incoming ? mix : 1 - mix, when + BLEND * p);
      }
    }

    function play(when, offset, blending) {
      var source = audio.createBufferSource();
      var gain = audio.createGain();
      source.buffer = buffer;
      // Every source can continue the whole song if the scheduler is delayed.
      // A missed callback must never leave a hole in the backing track.
      source.loop = true;
      source.loopStart = TRACK.start;
      source.loopEnd = Math.min(TRACK.end, buffer.duration);
      source.connect(gain);
      outputs.forEach(function (output) { gain.connect(output); });
      if (blending) fade(gain.gain, when, true);
      else gain.gain.setValueAtTime(1, when);
      source.start(when, offset);
      var result = {source: source, gain: gain, startAt: when, offset: offset};
      voices.push(result);
      source.onended = function () {
        source.disconnect(); gain.disconnect();
        voices = voices.filter(function (item) { return item !== result; });
      };
      return result;
    }

    return {
      prepare: function () {
        if (!prepared) {
          prepared = fetcher(TRACK.url).then(function (response) {
            if (!response.ok) throw new Error("Could not load soundtrack");
            return response.arrayBuffer();
          }).then(function (bytes) { return audio.decodeAudioData(bytes); })
            .then(function (decoded) {
              // MP3 decoding/resampling can round the final frame down slightly.
              if (decoded.duration + 0.001 < TRACK.end) throw new Error("Soundtrack is incomplete");
              return decoded;
            }).catch(function (error) { prepared = null; throw error; });
        }
        return prepared;
      },
      start: function (start, firstBuffer) {
        patternStart = start;
        buffer = firstBuffer;
        current = 0;
        form = 1;
        phrase = 0;
        bag = [];
        voice = play(patternStart - TRACK.start, 0, false);
        switchAt = patternStart + INTRO_BARS * BAR;
      },
      tick: function (now) {
        if (!voice) return;
        if (pending && now >= pending.at) {
          voice = pending.voice;
          current = pending.form;
          switchAt = pending.at + PHRASE;
          pending = null;
          phrase += 1;
          if (phrase === FORMS[form].length) {
            form = pickForm();
            phrase = 0;
          }
        }
        if (pending) return;
        if (now >= switchAt) {
          // Recover on a future phrase boundary without restarting the pulse.
          switchAt = patternStart + (INTRO_BARS +
            Math.ceil((now + 0.1 - patternStart - INTRO_BARS * BAR) / PHRASE) * 16) * BAR;
        }
        if (now + LOOK_AHEAD < switchAt) return;
        var offset = TRACK.start + FORMS[form][phrase] * PHRASE;
        var nextVoice = voice;
        if (Math.abs(positionAt(voice, switchAt) - offset) > 0.00001) {
          nextVoice = play(switchAt, offset, true);
          fade(voice.gain.gain, switchAt, false);
          voice.source.stop(switchAt + BLEND);
        }
        // Natural neighbouring phrases use the existing source uninterrupted.
        pending = {at: switchAt, form: form, voice: nextVoice};
      },
      timelineAt: function () {
        // Rearranging the music never resets notes or changes the tap cadence.
        return {index: 0, start: patternStart, end: Infinity, beat: BEAT};
      },
      transition: function () { return null; },
      inspect: function () {
        return {current: current, next: form, phrase: phrase,
          pending: pending ? pending.form : null, switchAt: switchAt,
          cached: prepared ? 1 : 0, voices: voices.length};
      }
    };
  }

  globalThis.SisyphusMusic = {create: create, tracks: [TRACK],
    forms: FORMS, phraseDuration: PHRASE, blendDuration: BLEND, introDuration: INTRO_BARS * BAR};
}());
