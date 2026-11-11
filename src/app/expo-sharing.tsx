import { Redirect } from 'expo-router';

/** expo-sharing opens `clipbox://expo-sharing` for incoming Android Share intents. */
export default function ShareEntry() {
  return <Redirect href="/share" />;
}
