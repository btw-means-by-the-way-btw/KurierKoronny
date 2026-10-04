import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { useShallow } from 'zustand/react/shallow';

import { Avatar } from '../components/Avatar';
import { NetworkStatusBar } from '../components/NetworkStatusBar';
import { SignalBars } from '../components/SignalBars';
import { TrustBadge } from '../components/TrustBadge';
import { Card, ListRow, Notice, SectionHeader, TabRoot, Tag } from '../components/ui';
import type { NearbyDevice } from '../services/ble/LinkManager';
import type { MeshNode } from '../services/mesh/MeshRouter';
import { MeshService } from '../services/mesh/MeshService';
import { authorityName, trustLevel, useContactsStore } from '../store/contactsStore';
import { useMeshStore } from '../store/meshStore';
import { size, useAppTheme } from '../theme';
import { formatRelative } from '../utils/time';

type Row = { kind: 'nearby'; item: NearbyDevice } | { kind: 'node'; item: MeshNode };

export default function NetworkScreen() {
  const theme = useAppTheme();
  const { radio, links, nearby, nodes } = useMeshStore(
    useShallow((s) => ({ radio: s.radio, links: s.links, nearby: s.nearby, nodes: s.nodes }))
  );
  const trust = useContactsStore(useShallow((s) => ({ contacts: s.contacts, authorities: s.authorities })));
  const [refreshing, setRefreshing] = useState(false);

  const openDm = async (nodeId: string, nick: string) => {
    const id = await MeshService.openDirectConversation(nodeId, nick);
    router.push({ pathname: '/chat/[id]', params: { id } });
  };

  const refresh = () => {
    setRefreshing(true);
    MeshService.rescan();
    setTimeout(() => setRefreshing(false), 1500);
  };

  const sections: { title: string; subtitle: string; data: Row[] }[] = [
    {
      title: 'W zasięgu Bluetooth',
      subtitle: 'Urządzenia wykryte bezpośrednio przez skanowanie BLE',
      data: nearby.map((item) => ({ kind: 'nearby' as const, item })),
    },
    {
      title: 'Węzły w sieci mesh',
      subtitle: 'Wszyscy osiągalni, także przez inne telefony',
      data: nodes.map((item) => ({ kind: 'node' as const, item })),
    },
  ];

  const nodeById = new Map(nodes.map((n) => [n.nodeId, n]));
  const line = { backgroundColor: theme.colors.outlineVariant };

  return (
    <TabRoot title="Sieć mesh">
      <NetworkStatusBar />
      <SectionList
        sections={sections}
        keyExtractor={(row) => (row.kind === 'nearby' ? `n:${row.item.shortId}` : `m:${row.item.nodeId}`)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            colors={[theme.colors.primary]}
            progressBackgroundColor={theme.colors.surface}
          />
        }
        ListHeaderComponent={
          <Card style={styles.card}>
            <View style={styles.stats}>
              <Stat label="Połączenia" value={links.length} />
              <View style={[styles.rule, line]} />
              <Stat label="W zasięgu" value={nearby.length} />
              <View style={[styles.rule, line]} />
              <Stat label="Węzły w mesh" value={nodes.length} />
            </View>
            <View style={[styles.hairline, line]} />
            <View style={styles.tags}>
              <Tag
                icon={radio.scanning ? 'radar' : 'pause-circle-outline'}
                label={radio.scanning ? 'Skanowanie' : 'Pauza skanu'}
              />
              <Tag
                icon={radio.advertising ? 'broadcast' : 'broadcast-off'}
                label={radio.advertising ? 'Rozgłaszanie' : 'Brak rozgłaszania'}
              />
              <Tag
                icon="swap-horizontal"
                label={`Central + ${radio.peripheralSupported ? 'Peripheral' : 'bez Peripheral'}`}
              />
            </View>
            {radio.error && (
              <Notice tone="error" icon="alert-circle-outline">
                {radio.error}
              </Notice>
            )}
          </Card>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <SectionHeader
              title={section.title}
              subtitle={
                section.data.length === 0
                  ? section.title.startsWith('W zasięgu')
                    ? 'Nikogo w pobliżu – poczekaj chwilę lub przeciągnij w dół.'
                    : 'Brak znanych węzłów.'
                  : section.subtitle
              }
            />
          </View>
        )}
        renderItem={({ item: row }) => {
          if (row.kind === 'nearby') {
            const d = row.item;
            const node = d.nodeId ? nodeById.get(d.nodeId) : undefined;
            // An office name comes from a certificate only – a nick can claim anything.
            const name = authorityName(trust, d.nodeId) ?? (d.nick || node?.nick || `Węzeł ${d.shortId}`);
            const level = trustLevel(trust, d.nodeId);
            return (
              <Card
                radius="md"
                padding={0}
                onPress={d.nodeId ? () => openDm(d.nodeId!, name) : undefined}
                style={styles.item}
              >
                <ListRow
                  title={name}
                  description={
                    d.linkId
                      ? `Połączono (${d.linkId.startsWith('c:') ? 'central' : 'peripheral'})`
                      : `Widziany ${formatRelative(d.lastSeen)}`
                  }
                  leading={<Avatar id={d.nodeId ?? d.shortId} label={name} size={size.avatar} />}
                  trailing={
                    <View style={styles.right}>
                      {level !== 'unverified' && <TrustBadge level={level} compact />}
                      {d.linkId && <Icon source="link-variant" size={18} color={theme.colors.primary} />}
                      <SignalBars rssi={d.rssi} />
                    </View>
                  }
                />
              </Card>
            );
          }
          const n = row.item;
          const name = authorityName(trust, n.nodeId) ?? n.nick;
          const level = trustLevel(trust, n.nodeId);
          return (
            <Card radius="md" padding={0} onPress={() => openDm(n.nodeId, n.nick)} style={styles.item}>
              <ListRow
                title={name}
                description={n.hops <= 1 ? 'Bezpośrednio · dotknij, aby napisać' : `${n.hops} skoki · przez mesh`}
                leading={<Avatar id={n.nodeId} label={name} size={size.avatar} />}
                trailing={
                  <View style={styles.right}>
                    {level !== 'unverified' && <TrustBadge level={level} compact />}
                    <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                      {n.hops <= 1 ? '1 skok' : `${n.hops} skoki`}
                    </Text>
                  </View>
                }
              />
            </Card>
          );
        }}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
      />
    </TabRoot>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const theme = useAppTheme();
  return (
    <View style={styles.stat}>
      <Text variant="headlineLarge" style={[styles.value, { color: theme.colors.onSurface }]}>
        {value}
      </Text>
      <Text variant="labelMedium" numberOfLines={2} style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 24 },
  card: { marginHorizontal: 16, marginTop: 4, gap: 16 },
  stats: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  value: { fontVariant: ['tabular-nums'] },
  label: { textAlign: 'center' },
  rule: { width: 1 },
  hairline: { height: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectionHeader: { paddingHorizontal: 16 },
  item: { marginHorizontal: 16, marginBottom: 8 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
