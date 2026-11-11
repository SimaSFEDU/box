/**
 * Minimal Reanimated stand-in for component tests. The official mock in this Reanimated
 * version initialises native worklets under Jest; we only need the APIs our UI uses.
 * Animations themselves are not under test.
 */
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const anim = { duration: () => anim, delay: () => anim };
  const shared = (v: unknown) => {
    let value = v;
    return { get: () => value, set: (n: unknown) => (value = n), value };
  };
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c: unknown) => c },
    useSharedValue: shared,
    useAnimatedStyle: (fn: () => object) => fn(),
    withTiming: (v: unknown) => v,
    FadeIn: anim,
    SlideInDown: anim,
  };
});
