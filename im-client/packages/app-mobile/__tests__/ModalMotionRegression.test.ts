export {};

declare const __dirname: string;

const fs = require('fs') as {
  readFileSync(path: string, encoding: string): string;
  readdirSync(path: string, options: { withFileTypes: true }): Array<{
    isDirectory(): boolean;
    name: string;
  }>;
};
const path = require('path') as {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
  resolve(...parts: string[]): string;
};

const sourceRoot = path.resolve(__dirname, '../src');

function typescriptSources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return typescriptSources(entryPath);
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

test('transparent modals never slide the full-screen scrim with the sheet', () => {
  const offenders = typescriptSources(sourceRoot).filter((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return /<Modal\b(?=[^>]*\btransparent\b)(?=[^>]*animationType=["']slide["'])[^>]*>/s.test(
      source,
    );
  });

  expect(offenders.map((file) => path.relative(sourceRoot, file))).toEqual([]);
});
