import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { RootScreenBackground } from '../src/components/RootScreenBackground';

jest.mock('../src/ui/ThemeProvider', () => ({
  useAppTheme: () => ({
    theme: {
      colors: { surface: '#ffffff', pageAccent: '#eef3ff', page: '#f3f6ff' },
    },
  }),
}));

jest.mock('react-native-linear-gradient', () => {
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: (props: React.PropsWithChildren<{ colors: string[] }>) =>
      ReactModule.createElement('LinearGradient', props, props.children),
  };
});

test('provides one continuous background for a root tab screen', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <RootScreenBackground>
        <Text>页面内容</Text>
      </RootScreenBackground>,
    );
  });

  const gradients = renderer.root.findAll(node =>
    Array.isArray(node.props.colors),
  );
  expect(gradients.length).toBeGreaterThan(0);
  expect(gradients[0].props.colors).toEqual(['#ffffff', '#eef3ff', '#f3f6ff']);
  expect(renderer.root.findByProps({ children: '页面内容' })).toBeTruthy();
});
