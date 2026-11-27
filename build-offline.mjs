import { mkdir, readFile, writeFile } from 'node:fs/promises';

const project = new URL('./', import.meta.url);
const dist = new URL('dist/', project);
const read = file => readFile(new URL(file, dist), 'utf8');
const moduleNames = ['world', 'volcano', 'renderer', 'flight', 'cockpit', 'mission', 'radar', 'crew', 'game'];
const scripts = [];
for (const name of moduleNames) {
  const exports = [];
  let source = await read(name + '.js');
  source = source.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/(\w+)\.js['"];?$/gm,
    (_statement, bindings, dependency) => 'const {' + bindings + '} = modules.' + dependency + ';');
  source = source.replace(/^export (const|function|class) (\w+)/gm,
    (_statement, kind, symbol) => { exports.push(symbol); return kind + ' ' + symbol; });
  scripts.push('modules.' + name + ' = (() => {\n' + source +
    '\nreturn {' + exports.join(', ') + '};\n})();');
}

const styles = (await read('style.css')).replace(/^@import[^\n]+\n/gm, '');
const script = ('const modules = {};\n' + scripts.join('\n')).replace(/<\/(script)/gi, '<\\/$1');
const html = (await read('index.html'))
  .replace('<link rel="stylesheet" href="style.css">', () => '<style>\n' + styles + '\n</style>')
  .replace('<script type="module" src="game.js"></script>', () => '<script type="module">\n' + script + '\n</script>');
await mkdir(new URL('play/', project), { recursive: true });
await writeFile(new URL('play/Legends%20of%20Jets.html', project), html);
