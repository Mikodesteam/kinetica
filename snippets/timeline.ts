// Excerpt from Kinetica (packages/core/src/timeline.ts). Shown for illustration only.
// The full source code is available at https://store.mikodes.com/p/kinetica/
//
// Plans how long each scene of a generated video lasts. With a voiceover, a scene lasts
// as long as its spoken words; without one, reading speed decides. When a music tempo
// is set, every cut snaps to a whole number of beats and to the 30 fps frame grid.

// Storyboard, Word, SceneVoice, TimedScene, Timing, OUTRO_SECONDS and sceneByType are defined elsewhere in the package.

export const LEAD = 0.25;     // silence before a scene's first word
export const TAIL = 0.45;     // breath after its last word

const readSeconds = (text: string) => text.split(/\s+/).filter(Boolean).length / 2.7;

function sceneText(props: Record<string, unknown>): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (!/^(asset:|https?:|#)/.test(v)) out.push(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(props);
  return out.join(' ');
}
// …
export function planTiming(board: Storyboard, voices?: (SceneVoice | null)[]): Timing {
  let t = 0;
  // without a voiceover, cuts follow the music: every scene lasts a whole number of beats
  const voiced = !!voices?.some(v => v && v.duration > 0);
  const beat = board.bpm && !voiced ? 60 / board.bpm : 0;
  let beats = 0;
  const snap = (dur: number, min: number) => {
    let n = Math.max(1, Math.round(dur / beat));
    if (n * beat < min - 1e-6) n = Math.ceil(min / beat - 1e-6);
    return n;
  };
  const at = (b: number) => Math.round(b * beat * 30) / 30;
  const scenes: TimedScene[] = board.scenes.map((sc, i) => {
    const def = sceneByType(sc.type);
    const minDur = def?.minDur ?? 2.5;
    const v = voices?.[i];
    let dur: number;
    if (v && v.duration > 0) dur = Math.max(minDur, LEAD + v.duration + TAIL);
    // without a voice the viewer only scans: base time plus a little per word, capped
    else dur = Math.min(7, Math.max(minDur, minDur * .7 + readSeconds(sceneText(sc.props)) * .45));
    if (sc.duration) dur = Math.max(sc.duration, v ? LEAD + v.duration + .1 : 0);
    let start: number;
    if (beat) {
      // cumulative beat count, so rounding to frames never drifts off the grid
      const n = snap(dur, sc.duration ? 1 : minDur);
      start = at(beats); beats += n; t = at(beats);
    } else {
      dur = Math.round(dur * 30) / 30;
      start = t;
      t += dur;
    }
    const voiceAt = start + LEAD;
    const words = (v?.words ?? []).map(w => ({ ...w, t: +(voiceAt + w.t).toFixed(3), e: +(voiceAt + w.e).toFixed(3) }));
    return { id: sc.id!, index: i, start: +start.toFixed(3), end: +t.toFixed(3), voiceAt: +voiceAt.toFixed(3), words };
  });
  let outro: Timing['outro'];
  if (board.outro && !board.loop) {
    const sec = board.outro.seconds ?? OUTRO_SECONDS;
    const start = t;
    if (beat) { beats += snap(sec, 1); t = at(beats); } else t = Math.round((t + sec) * 30) / 30;
    outro = { start: +start.toFixed(3), end: +t.toFixed(3) };
  }
  return { duration: +t.toFixed(3), scenes, ...(outro ? { outro } : {}), ...(beat ? { beat: +beat.toFixed(5) } : {}) };
