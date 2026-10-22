import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';
import App from './App';

// The native flows (`npx sabeel-ci native-e2e`) start Metro with EXPO_PUBLIC_E2E=1:
// a debug build's warning toast sits over the tab bar and takes their taps. The
// warnings still reach Metro's log, which the flows keep.
if (__DEV__ && process.env.EXPO_PUBLIC_E2E === '1') LogBox.ignoreAllLogs();

registerRootComponent(App);
