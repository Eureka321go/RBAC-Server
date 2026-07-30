import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { AnimatedMessageBubble } from '../src/components/AnimatedMessageBubble';

test('always renders message content with reduced motion', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <AnimatedMessageBubble
        messageId="m-1"
        isMine
        animateOnMount
        reducedMotionOverride
      >
        <Text>你好</Text>
      </AnimatedMessageBubble>,
    );
  });

  expect(renderer.root.findByProps({ children: '你好' })).toBeTruthy();
});
