import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

/**
 * Plays an encrypted video through SecureMediaProvider (decrypted on the fly, seekable).
 * textureView: renders inside the FLAG_SECURE window (a SurfaceView would be a separate surface).
 * No PiP, no background playback, no media notification — nothing escapes the private screen.
 */
export function VideoPage({ uri, active }: { uri: string; active: boolean }) {
  const player = useVideoPlayer({ uri, useCaching: false }, (p) => {
    p.loop = false;
    p.staysActiveInBackground = false;
    p.showNowPlayingNotification = false;
  });
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      surfaceType="textureView"
      allowsPictureInPicture={false}
      style={StyleSheet.absoluteFill}
    />
  );
}
