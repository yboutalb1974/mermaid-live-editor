// Bundles src/ into one self-contained HTML file (no build tools needed).
//   node warehouse-sim/build.mjs
// Outputs:
//   warehouse-sim/index.html          full document, open it directly in a browser
//   warehouse-sim/dist/fragment.html  same page without <html>/<head>/<body>, for hosts that add their own skeleton
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(root, 'src', f), 'utf8');

const stripExports = (code) => code.replace(/^export (?=(function|const|let|class)\b)/gm, '');
const engine = stripExports(read('engine.js'));
const view3d = stripExports(read('view3d.js'));
const app = read('app.js').replace(/^import \{[\s\S]*?\} from '\.\/[a-z0-9]+\.js';\n/gm, '');
if (/^import /m.test(app) || /^export /m.test(engine + view3d))
  throw new Error('Unexpected module syntax left after bundling.');

const script = `(() => {\n'use strict';\n${engine}\n${view3d}\n${app}\n})();`;
if (script.includes('</script')) throw new Error('Script contains a closing script tag.');

const fragment = read('page.html')
  .replace('/*__STYLES__*/', () => read('styles.css'))
  .replace('/*__SCRIPT__*/', () => script);

const full = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</head>
<body>
${fragment}
</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'index.html'), full);
writeFileSync(join(root, 'dist', 'fragment.html'), fragment);
console.log(`index.html ${(full.length / 1024).toFixed(0)} kB`);
