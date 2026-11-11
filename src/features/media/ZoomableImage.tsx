import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const MAX = 5;

/**
 * Pinch / pan / double-tap zoom. Reports zoom state so the pager can disable horizontal swiping
 * while the image is magnified. `cachePolicy="none"`: decrypted pixels never enter the image disk cache.
 */
export function ZoomableImage({ uri, onZoomChange, accessibilityLabel }: { uri: string; onZoomChange?: (zoomed: boolean) => void; accessibilityLabel?: string }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const notify = (z: boolean) => onZoomChange?.(z);

  const reset = () => {
    'worklet';
    scale.set(withTiming(1));
    savedScale.set(1);
    tx.set(withTiming(0));
    ty.set(withTiming(0));
    savedTx.set(0);
    savedTy.set(0);
    runOnJS(notify)(false);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.set(Math.min(MAX, Math.max(0.8, savedScale.get() * e.scale)));
    })
    .onEnd(() => {
      if (scale.get() <= 1.02) reset();
      else {
        savedScale.set(scale.get());
        runOnJS(notify)(true);
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .averageTouches(true)
    .onUpdate((e) => {
      if (savedScale.get() <= 1) return;
      tx.set(savedTx.get() + e.translationX);
      ty.set(savedTy.get() + e.translationY);
    })
    .onEnd(() => {
      savedTx.set(tx.get());
      savedTy.set(ty.get());
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.get() > 1) reset();
      else {
        scale.set(withTiming(2.5));
        savedScale.set(2.5);
        runOnJS(notify)(true);
      }
    });

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }] }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, doubleTap)}>
      <AnimatedImage
        source={{ uri }}
        cachePolicy="none"
        contentFit="contain"
        recyclingKey={uri}
        accessibilityLabel={accessibilityLabel}
        style={[StyleSheet.absoluteFill, style]}
      />
    </GestureDetector>
  );
}
