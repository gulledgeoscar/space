// CASE-9 voice selection: natural voices beat robotic ones, characters differ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreVoice, Voice } from '../src/audio/voice.js';

const V = (name, lang = 'en-US', localService = true) => ({ name, lang, localService });
const VOICES = [
  V('eSpeak English', 'en-GB'), V('Microsoft David - English (United States)'), V('Google UK English Male', 'en-GB', false),
  V('Microsoft Ryan Online (Natural) - English (United Kingdom)', 'en-GB', false), V('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', false),
  V('Google US English', 'en-US', false), V('Samantha'),
];

test('natural voices rank above standard and robotic ones', () => {
  const ranked = [...VOICES].sort((a, b) => scoreVoice(b) - scoreVoice(a)).map((v) => v.name);
  assert.match(ranked[0], /Natural/);
  assert.equal(ranked[ranked.length - 1], 'eSpeak English');
  assert.ok(scoreVoice(V('Google UK English Male', 'en-GB', false)) > scoreVoice(V('Microsoft David - English (United States)')));
});

test('characters get distinct voices, CASE-9 a male natural one', () => {
  globalThis.window = { speechSynthesis: { getVoices: () => VOICES, speak() {}, cancel() {} } };
  const v = new Voice();
  const c = v.pick('case'), o = v.pick('okafor'), x = v.pick('vance');
  assert.match(c.name, /Ryan/);
  assert.match(o.name, /Sonia/);
  assert.notEqual(x.name, c.name);
  delete globalThis.window;
});
