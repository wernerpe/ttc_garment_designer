// Loads the design packs: the public samples, then the private pack in js/designs/local/ if this
// copy of the app has one. The private pack's motifs are added to the tray and its layout is what
// a fresh session starts with.

import samples from './samples.js';
import { registerMotifs } from '../art/motifs.js';
import { setDefaultDesigns } from '../state.js';

export async function loadDesignPacks() {
  let local = null;
  const url = new URL('./local/index.js', import.meta.url);
  try {
    // check first so a copy without private designs doesn't log a failed module load
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) local = (await import(url.href)).default;
  } catch (err) {
    console.warn('Private design pack failed to load, using the samples instead.', err);
  }
  registerMotifs(samples.motifs);
  if (local) registerMotifs(local.motifs || {});
  setDefaultDesigns(local?.defaultDesigns || samples.defaultDesigns);
  return local ? local.name : samples.name;
}
