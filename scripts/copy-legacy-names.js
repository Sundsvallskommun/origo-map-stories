// Byte-copies the built plugin to its legacy StructureMapHelper file names, so
// installations that still load structure-map-helper.min.js / .css keep
// working without changes. Runs as the last step of `npm run build`.
const fs = require('fs');
const path = require('path');

const build = path.join(__dirname, '..', 'build');

const COPIES = [
  ['js/origo-map-stories.min.js', 'js/structure-map-helper.min.js'],
  ['css/origo-map-stories.min.css', 'css/structure-map-helper.css']
];

for (const [src, dest] of COPIES) {
  const from = path.join(build, src);
  const to = path.join(build, dest);
  if (!fs.existsSync(from)) {
    console.error(`copy-legacy-names: ${path.relative(process.cwd(), from)} is missing; run the build first.`);
    process.exit(1);
  }
  fs.copyFileSync(from, to);
  if (!fs.readFileSync(from).equals(fs.readFileSync(to))) {
    console.error(`copy-legacy-names: ${dest} differs from ${src} after copying.`);
    process.exit(1);
  }
  console.log(`copied build/${src} → build/${dest}`);
}
