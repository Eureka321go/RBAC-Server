const fs = require('fs') as {
  readFileSync(path: string, encoding: string): string;
};
const resolveModule = (require as unknown as { resolve(id: string): string })
  .resolve;

const screens: Array<[string, string]> = [
  ['ContactsScreen.tsx', resolveModule('../src/screens/ContactsScreen')],
  ['CreateGroupScreen.tsx', resolveModule('../src/screens/CreateGroupScreen')],
  [
    'GroupDetailsScreen.tsx',
    resolveModule('../src/screens/GroupDetailsScreen'),
  ],
];

test.each(screens)(
  '%s has no manual userId entry point',
  (_filename, modulePath) => {
    const source = fs.readFileSync(modulePath, 'utf8');
    expect(source).not.toMatch(
      /manual(Member)?Ids?|通过 IM ID|手工补充|输入对端 userId/,
    );
  },
);
