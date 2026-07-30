import React from 'react';
import { StyleSheet, View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { AppButton } from '../src/components/AppButton';
import { Surface } from '../src/components/Surface';
import { ThemeProvider } from '../src/ui/ThemeProvider';
import { DARK_THEME } from '../src/ui/theme';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => 'dark'),
    setItem: jest.fn(async () => undefined),
  },
}));

jest.mock('react-native-linear-gradient', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => children,
}));

jest.mock('@react-native-vector-icons/ionicons/static', () => ({
  Ionicons: () => null,
}));

test('renders shared primitives from the resolved dark theme', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeProvider>
        <Surface>
          <AppButton label="继续" onPress={jest.fn()} />
        </Surface>
      </ThemeProvider>,
    );
  });

  const surfaceView = renderer.root.findByType(Surface).findByType(View);
  expect(StyleSheet.flatten(surfaceView.props.style).backgroundColor)
    .toBe(DARK_THEME.colors.surface);
  expect(renderer.root.findByProps({ accessibilityLabel: '继续' })).toBeTruthy();
});
