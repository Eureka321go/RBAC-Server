import React from 'react';
import renderer from 'react-test-renderer';

jest.mock('../src/ui/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: { isDark: true } }),
}));

import { BrandMark } from '../src/components/BrandMark';

describe('BrandMark', () => {
  it('presents the RayIM logo as an accessible image', async () => {
    let tree: renderer.ReactTestRenderer;
    await renderer.act(async () => {
      tree = renderer.create(<BrandMark size={72} />);
    });

    expect(tree!.root.findByProps({ accessibilityLabel: 'RayIM 标志' })).toBeTruthy();
  });
});
