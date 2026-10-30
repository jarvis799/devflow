import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { AppStateProvider } from './src/state/AppState';
import { ToastProvider } from './src/components/Toast';
import { colors } from './src/theme';

import HomeScreen from './src/screens/HomeScreen';
import ProjectsScreen from './src/screens/ProjectsScreen';
import BuildsScreen from './src/screens/BuildsScreen';
import DeploymentsScreen from './src/screens/DeploymentsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ZipFlowScreen from './src/screens/ZipFlowScreen';
import BuildMonitorScreen from './src/screens/BuildMonitorScreen';
import CustomizeScreen from './src/screens/CustomizeScreen';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.limeDeep,
  },
};

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'sparkles-outline',
  Projects: 'folder-outline',
  Builds: 'construct-outline',
  Deployments: 'rocket-outline',
  Settings: 'settings-outline',
};

function TabsNavigator() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.limeDeep,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.88)',
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
          shadowColor: '#0F172A',
          shadowOpacity: 0.06,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -6 },
          elevation: 4,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '700' },
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={ICONS[route.name] || 'ellipse-outline'} size={size - 2} color={color} />
        ),
      })}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Projects" component={ProjectsScreen} />
      <Tabs.Screen name="Builds" component={BuildsScreen} />
      <Tabs.Screen name="Deployments" component={DeploymentsScreen} />
      <Tabs.Screen name="Settings" component={SettingsScreen} />
    </Tabs.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <ToastProvider>
          <NavigationContainer theme={navTheme}>
            <StatusBar style="dark" />
            <Stack.Navigator
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="Tabs" component={TabsNavigator} />
              <Stack.Screen name="ZipFlow" component={ZipFlowScreen} options={{ presentation: 'card' }} />
              <Stack.Screen name="BuildMonitor" component={BuildMonitorScreen} />
              <Stack.Screen name="Customize" component={CustomizeScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </ToastProvider>
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
