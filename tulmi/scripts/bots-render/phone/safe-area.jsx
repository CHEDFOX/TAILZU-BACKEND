// react-native-safe-area-context for the render check: the insets the page sets (a 390 x 844 phone's status bar).
import React from "react";
import { View } from "react-native";
const insets = () => window.__INSETS__ || { top: 0, bottom: 0, left: 0, right: 0 };
export const useSafeAreaInsets = () => insets();
export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
export const SafeAreaProvider = ({ children }) => <>{children}</>;
export const SafeAreaView = ({ style, children }) => <View style={style}>{children}</View>;
export const initialWindowMetrics = { insets: insets(), frame: { x: 0, y: 0, width: 390, height: 844 } };
