import VS_FULLSCREEN from '../shaders/fullscreen.vert.glsl';
import FS_PATHTRACE from '../shaders/pathtrace.frag.glsl';
import FS_DENOISE from '../shaders/denoise.frag.glsl';
import FS_COMPOSITE from '../shaders/composite.frag.glsl';
import FS_BLOOM_BRIGHT from '../shaders/bloom-bright.frag.glsl';
import FS_BLOOM_BLUR from '../shaders/bloom-blur.frag.glsl';
import FS_TONEMAP from '../shaders/tonemap.frag.glsl';
import FS_FINAL from '../shaders/final.frag.glsl';

const FS_PATHTRACE_COLOR_ONLY = FS_PATHTRACE.replace(
  '#version 300 es\n', '#version 300 es\n#define PTR_COLOR_ONLY 1\n'
);

export { VS_FULLSCREEN, FS_PATHTRACE, FS_DENOISE, FS_COMPOSITE, FS_BLOOM_BRIGHT, FS_BLOOM_BLUR, FS_TONEMAP, FS_FINAL, FS_PATHTRACE_COLOR_ONLY };
