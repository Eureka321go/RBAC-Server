export {};

const fs = require('fs') as {
  readFileSync(path: string, encoding: string): string;
};
const resolveModule = (require as unknown as { resolve(id: string): string })
  .resolve;

function sourceOf(id: string): string {
  return fs.readFileSync(resolveModule(id), 'utf8');
}

test('shared surfaces and navigation contain no native shadow styles', () => {
  const files = [
    '../src/components/Surface',
    '../src/components/ChatComposerSurface',
    '../src/navigation/RootTabs',
  ];

  for (const id of files) {
    expect(sourceOf(id)).not.toMatch(
      /shadow(?:Color|Offset|Opacity|Radius)\s*:|elevation\s*:/,
    );
  }
});

test('contacts directory fills the remaining tab space', () => {
  const source = sourceOf('../src/screens/ContactsScreen');
  expect(source).toMatch(/directorySection:\s*{\s*flex:\s*1/);
  expect(source).toMatch(/directory:\s*{\s*flex:\s*1/);
  expect(source).not.toMatch(/directory:\s*{[^}]*height:/s);
  expect(source).not.toContain('<ScrollView');
});

test('root stack registers the appearance settings route', () => {
  const source = fs.readFileSync(resolveModule('../App'), 'utf8');
  expect(source).toContain('name="AppearanceSettings"');
});
