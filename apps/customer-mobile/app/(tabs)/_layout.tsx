/** التنقل السفلي — الرئيسية / طلباتي / حسابي (البقية مؤجلة عن نطاق الطيار) */
import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors, fs, light } from "../../src/theme";

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.lime900,
        tabBarInactiveTintColor: colors.gray,
        tabBarLabelStyle: { fontSize: fs.fs12, fontWeight: "700" },
        tabBarStyle: {
          backgroundColor: light.surface,
          borderTopColor: light.border,
          height: 62,
          paddingTop: 6,
          paddingBottom: 8
        }
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "الرئيسية",
          tabBarIcon: ({ color }) => <TabIcon glyph="⌂" color={color} />
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "طلباتي",
          tabBarIcon: ({ color }) => <TabIcon glyph="≣" color={color} />
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "حسابي",
          tabBarIcon: ({ color }) => <TabIcon glyph="◉" color={color} />
        }}
      />
    </Tabs>
  );
}
