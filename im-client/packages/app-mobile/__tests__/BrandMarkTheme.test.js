const { readFileSync } = require('fs');
const { resolve } = require('path');

describe('BrandMark theme support', () => {
  it('selects the light asset through the app theme', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/components/BrandMark.tsx'),
      'utf8',
    );

    expect(source).toContain("useAppTheme");
    expect(source).toContain("rayim-signal-ribbon-light.png");
  });
});
