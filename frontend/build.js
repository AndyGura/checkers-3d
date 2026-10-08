// Bundle src/app.js (the 3D scene, the checkers plugin, the vendored
// duel-game-core sources under src/duel-game-core/, three.js and
// @icp-sdk/*) into dist/app.js, then copy the static assets. icp.yaml
// deploys dist/ only.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const buildOptions = {
  entryPoints: ['src/app.js'],
  bundle: true,
  outfile: `${outdir}/app.js`,
  format: 'esm',
  target: 'es2022',
  minify: !watch,
  sourcemap: true,
  logLevel: 'info',
};

for (const [from, to] of [
  ['src/index.html', `${outdir}/index.html`],
  ['src/style.css', `${outdir}/style.css`],
  ['src/_headers', `${outdir}/_headers`],
]) {
  cpSync(from, to, { recursive: true });
}

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('watching for changes...');
} else {
  await esbuild.build(buildOptions);
}
