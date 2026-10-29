/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { AnnoKitProvider } from '@joinearlybird/annokit';
import { NewAppScreen } from '@react-native/new-app-screen';
import {
  Platform,
  StatusBar,
  StyleSheet,
  useColorScheme,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

// Without Expo there is no EXPO_PUBLIC_* to read, so the server is named
// here. Inside an Android emulator `localhost` is the emulator itself;
// 10.0.2.2 is your machine.
const ANNOTATE_ENDPOINT = Platform.select({
  android: 'http://10.0.2.2:4788',
  default: 'http://localhost:4788',
});

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <AnnoKitProvider endpoint={ANNOTATE_ENDPOINT} sessionId="example-session">
      <SafeAreaProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <AppContent />
      </SafeAreaProvider>
    </AnnoKitProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <NewAppScreen
        templateFileName="App.tsx"
        safeAreaInsets={safeAreaInsets}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
