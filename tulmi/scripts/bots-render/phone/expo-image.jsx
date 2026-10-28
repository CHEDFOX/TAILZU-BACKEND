// expo-image for the render check: react-native-web's Image, with contentFit as resizeMode.
import React from "react";
import { Image as RNImage } from "react-native";
export const Image = ({ source, contentFit, style }) => (
  <RNImage source={source} resizeMode={contentFit === "contain" ? "contain" : contentFit === "fill" ? "stretch" : "cover"} style={style} />
);
export default Image;
