// expo-linear-gradient / expo-blur for the render check: the box without the effect.
import React from "react";
import { View } from "react-native";
const Box = ({ style, children }) => <View style={style}>{children}</View>;
export const LinearGradient = Box;
export const BlurView = Box;
export default Box;
