import { ScrollView } from "react-native";
import { Text, useTheme } from "react-native-paper";

export default function RAGScreen() {
  const theme = useTheme();

  return (
    <ScrollView style={{ backgroundColor: theme.colors.background }}>
      <Text>test</Text>
    </ScrollView>
  );
}
